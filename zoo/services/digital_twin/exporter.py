"""Export CubOS gantry, deck, and protocol configs to frontend JSON."""

from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Mapping

import yaml

from .geometry import AABB, Point3D, aabb_from_base_center, aabb_from_points, point_json
from .motion import InstrumentModel, MotionPlanner, collision_warnings


SCHEMA_VERSION = "digital-twin.v1"


def export_digital_twin(
    *,
    gantry_path: str | Path,
    deck_path: str | Path,
    protocol_path: str | Path,
    cubos_root: str | Path | None = None,
    sample_step_mm: float = 5.0,
) -> dict[str, Any]:
    """Load CubOS configs with CubOS loaders and emit canonical viewer JSON."""
    _ensure_cubos_imports(cubos_root)

    from deck.loader import load_deck_from_yaml
    from gantry.loader import load_gantry_from_yaml
    from protocol_engine.loader import load_protocol_from_yaml

    gantry_path = Path(gantry_path)
    deck_path = Path(deck_path)
    protocol_path = Path(protocol_path)

    gantry = load_gantry_from_yaml(gantry_path)
    deck = load_deck_from_yaml(deck_path, total_z_height=gantry.total_z_height)
    protocol = load_protocol_from_yaml(protocol_path)

    working_volume = {
        "x_min": gantry.working_volume.x_min,
        "x_max": gantry.working_volume.x_max,
        "y_min": gantry.working_volume.y_min,
        "y_max": gantry.working_volume.y_max,
        "z_min": gantry.working_volume.z_min,
        "z_max": gantry.working_volume.z_max,
    }
    instruments = {
        name: InstrumentModel.from_config(name, raw)
        for name, raw in gantry.instruments.items()
    }

    labware, labware_boxes = _serialize_deck(deck)
    motion = MotionPlanner(
        deck=deck,
        protocol=protocol,
        instruments=instruments,
        working_volume=working_volume,
        sample_step_mm=sample_step_mm,
    ).plan()
    warnings = collision_warnings(motion["path"], labware_boxes)

    return {
        "schemaVersion": SCHEMA_VERSION,
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "source": {
            "gantry": str(gantry_path),
            "deck": str(deck_path),
            "protocol": str(protocol_path),
            "cubosRoot": str(cubos_root) if cubos_root is not None else None,
        },
        "coordinateSystem": {
            "frame": "CubOS deck frame",
            "origin": "front-left-bottom reachable work volume",
            "axes": {"+x": "right", "+y": "away/back", "+z": "up"},
            "units": "millimeters",
        },
        "gantry": {
            "serialPort": gantry.serial_port,
            "homingStrategy": str(gantry.homing_strategy.value),
            "yAxisMotion": str(gantry.y_axis_motion.value),
            "totalZHeight": gantry.total_z_height,
            "structureClearanceZ": gantry.structure_clearance_z,
            "workingVolume": working_volume,
            "homePosition": {
                "x": gantry.working_volume.x_max,
                "y": gantry.working_volume.y_max,
                "z": gantry.working_volume.z_max,
            },
            "instruments": [_serialize_instrument(model, gantry.instruments[model.name]) for model in instruments.values()],
        },
        "deck": {"labware": labware},
        "protocol": {
            "positions": {name: _position_value(value) for name, value in protocol.positions.items()},
            "timeline": motion["timeline"],
        },
        "motion": motion,
        "warnings": warnings,
        "notes": [
            "Geometry uses first-pass AABB envelopes in CubOS deck coordinates.",
            "Motion is linear interpolation through CubOS protocol events; no GRBL acceleration model is included.",
        ],
    }


def write_digital_twin(
    *,
    out_path: str | Path,
    pretty: bool = True,
    **kwargs: Any,
) -> dict[str, Any]:
    data = export_digital_twin(**kwargs)
    out_path = Path(out_path)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(
        json.dumps(data, indent=2 if pretty else None, sort_keys=False) + "\n",
        encoding="utf-8",
    )
    return data


def _ensure_cubos_imports(cubos_root: str | Path | None) -> None:
    if cubos_root is not None:
        raise ValueError("Zoo uses the installed CubOS package; cubos_root is not supported.")


def _serialize_instrument(model: InstrumentModel, raw: Mapping[str, Any]) -> dict[str, Any]:
    return {
        "name": model.name,
        "type": raw.get("type", model.name),
        "vendor": raw.get("vendor"),
        "offset": {"x": model.offset_x, "y": model.offset_y, "z": 0.0},
        "depth": model.depth,
        "safeApproachHeight": model.safe_approach_height,
        "measurementHeight": model.measurement_height,
        "rawConfig": _jsonable(raw),
    }


def _serialize_deck(deck: Any) -> tuple[list[dict[str, Any]], list[AABB]]:
    labware_rows: list[dict[str, Any]] = []
    boxes: list[AABB] = []
    for key, obj in deck.labware.items():
        row, row_boxes = _serialize_labware(key, obj, parent_key=None)
        labware_rows.append(row)
        boxes.extend(row_boxes)
    return labware_rows, boxes


def _serialize_labware(key: str, obj: Any, parent_key: str | None) -> tuple[dict[str, Any], list[AABB]]:
    kind = _labware_kind(obj)
    positions = {name: point_json(coord) for name, coord in obj.iter_positions().items()}
    geometry = _geometry(obj)
    aabb = _labware_aabb(key, kind, obj, positions, geometry)
    children: list[dict[str, Any]] = []
    boxes: list[AABB] = []
    if aabb is not None:
        boxes.append(aabb)
    for child_key, child in getattr(obj, "contained_labware", {}).items():
        child_row, child_boxes = _serialize_labware(f"{key}.{child_key}", child, parent_key=key)
        children.append(child_row)
        boxes.extend(child_boxes)

    row: dict[str, Any] = {
        "key": key,
        "parentKey": parent_key,
        "name": getattr(obj, "name", key),
        "kind": kind,
        "modelName": getattr(obj, "model_name", ""),
        "anchor": point_json(obj.get_initial_position()),
        "geometry": geometry,
        "aabb": aabb.to_json() if aabb else None,
        "positions": positions,
        "children": children,
    }
    if hasattr(obj, "wells"):
        row["wells"] = [
            {"id": well_id, "center": point_json(coord)}
            for well_id, coord in sorted(obj.wells.items(), key=lambda item: _well_sort_key(item[0]))
        ]
        row["rows"] = getattr(obj, "rows", None)
        row["columns"] = getattr(obj, "columns", None)
    if hasattr(obj, "tips"):
        row["tips"] = [
            {"id": tip_id, "center": point_json(coord), "present": bool(getattr(obj, "tip_present", {}).get(tip_id, True))}
            for tip_id, coord in sorted(obj.tips.items(), key=lambda item: _well_sort_key(item[0]))
        ]
        row["rows"] = getattr(obj, "rows", None)
        row["columns"] = getattr(obj, "columns", None)
    return row, boxes


def _geometry(obj: Any) -> dict[str, float | None]:
    geometry = getattr(obj, "geometry", None)
    return {
        "lengthMm": _number(getattr(geometry, "length_mm", getattr(obj, "length_mm", None))),
        "widthMm": _number(getattr(geometry, "width_mm", getattr(obj, "width_mm", None))),
        "heightMm": _number(getattr(geometry, "height_mm", getattr(obj, "height_mm", None))),
        "diameterMm": _number(getattr(obj, "diameter_mm", None)),
    }


def _labware_aabb(
    key: str,
    kind: str,
    obj: Any,
    positions: Mapping[str, Mapping[str, float]],
    geometry: Mapping[str, float | None],
) -> AABB | None:
    length = geometry.get("lengthMm") or geometry.get("diameterMm")
    width = geometry.get("widthMm") or geometry.get("diameterMm")
    height = geometry.get("heightMm")
    points = [Point3D.from_any(value) for value in positions.values()]
    if kind in {"well_plate", "tip_rack"}:
        return aabb_from_points(points, length_mm=length, width_mm=width, height_mm=height, label=key, kind=kind)
    if length is not None and width is not None and height is not None:
        location = Point3D.from_any(getattr(obj, "location", obj.get_initial_position()))
        return aabb_from_base_center(location, length_mm=length, width_mm=width, height_mm=height, label=key, kind=kind)
    return aabb_from_points(points, length_mm=length, width_mm=width, height_mm=height, label=key, kind=kind)


def _labware_kind(obj: Any) -> str:
    name = type(obj).__name__
    out = []
    for char in name:
        if char.isupper() and out:
            out.append("_")
        out.append(char.lower())
    return "".join(out)


def _position_value(value: Any) -> Any:
    if isinstance(value, (list, tuple)) and len(value) == 3:
        return {"x": float(value[0]), "y": float(value[1]), "z": float(value[2])}
    return _jsonable(value)


def _well_sort_key(value: str) -> tuple[str, int, str]:
    letters = "".join(ch for ch in value if ch.isalpha())
    digits = "".join(ch for ch in value if ch.isdigit())
    return letters, int(digits or 0), value


def _number(value: Any) -> float | None:
    return None if value is None else float(value)


def _jsonable(value: Any) -> Any:
    if isinstance(value, Mapping):
        return {str(key): _jsonable(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [_jsonable(item) for item in value]
    if hasattr(value, "model_dump"):
        return _jsonable(value.model_dump())
    if hasattr(value, "value"):
        return value.value
    return value


def load_raw_yaml(path: str | Path) -> dict[str, Any]:
    with Path(path).open(encoding="utf-8") as handle:
        return yaml.safe_load(handle) or {}
