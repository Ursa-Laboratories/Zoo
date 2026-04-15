"""Deck config API endpoints — thin layer over CubOS deck loader."""

from copy import deepcopy
import logging
from typing import Any, Dict, Optional

from deck import load_deck_from_yaml
from deck.labware.well_plate import WellPlate
from deck.loader import _derive_wells_from_calibration
from deck.yaml_schema import WellPlateYamlEntry
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, ValidationError

from zoo.config import get_settings
from zoo.services.yaml_io import list_configs, read_yaml, resolve_config_path, write_yaml

log = logging.getLogger(__name__)

router = APIRouter(prefix="/api/deck", tags=["deck"])


# ── Response models (API shape only, no validation duplication) ────────


class WellPosition(BaseModel):
    x: float
    y: float
    z: float


class LabwareResponse(BaseModel):
    key: str
    config: Dict[str, Any]
    wells: Optional[Dict[str, WellPosition]] = None
    geometry: Optional[Dict[str, Optional[float]]] = None
    placement_anchor: Optional[WellPosition] = None
    render_anchor: Optional[WellPosition] = None
    default_target: Optional[WellPosition] = None
    targets: Optional[Dict[str, WellPosition]] = None
    validation_points: Optional[Dict[str, WellPosition]] = None


class DeckResponse(BaseModel):
    filename: str
    labware: list[LabwareResponse]


# ── Routes ─────────────────────────────────────────────────────────────


@router.get("/configs")
def list_deck_configs() -> list[str]:
    return list_configs(get_settings().configs_dir, "deck")


@router.get("/{filename}")
def get_deck(filename: str) -> DeckResponse:
    path = resolve_config_path(get_settings().configs_dir, "deck", filename)
    if not path.is_file():
        raise HTTPException(404, f"Config not found: {filename}")

    # Use CubOS's loader for validation + well derivation.
    try:
        deck = load_deck_from_yaml(path)
    except (ValueError, ValidationError) as e:
        raise HTTPException(400, str(e))

    raw = read_yaml(path)
    items: list[LabwareResponse] = []
    for key, labware in deck.labware.items():
        config = _normalize_labware_config(raw.get("labware", {}).get(key, {}), labware, key)
        labware_type = config.get("type") or _infer_labware_type(labware, key)
        if hasattr(labware, "iter_positions"):
            positions = _serialize_positions(labware.iter_positions())
        else:
            log.warning("Labware %s (%s) has no iter_positions — positions will be empty", key, type(labware).__name__)
            positions = {}
        placement_anchor = _serialize_config_point(config.get("location"))
        if hasattr(labware, "get_initial_position"):
            initial_position = _serialize_point(labware.get_initial_position())
        else:
            initial_position = None
        targets = _serialize_actionable_targets(positions)
        default_target = _resolve_default_target(
            labware_type=labware_type,
            initial_position=initial_position,
            positions=positions,
            targets=targets,
        )
        render_anchor = _resolve_render_anchor(
            placement_anchor=placement_anchor,
            initial_position=initial_position,
            positions=positions,
            default_target=default_target,
        )
        wells = targets if isinstance(labware, WellPlate) else None
        items.append(
            LabwareResponse(
                key=key,
                config=config,
                wells=wells,
                geometry=_serialize_geometry(getattr(labware, "geometry", None)),
                placement_anchor=placement_anchor,
                render_anchor=render_anchor,
                default_target=default_target,
                targets=targets,
                validation_points=_serialize_validation_points(
                    getattr(labware, "get_validation_points", None)
                ),
            )
        )

    return DeckResponse(filename=filename, labware=items)


@router.post("/preview-wells")
def preview_wells(body: dict) -> Dict[str, WellPosition]:
    """Compute well positions from a well plate config using CubOS's
    calibration logic, without requiring the config to be saved first."""
    try:
        entry = WellPlateYamlEntry.model_validate(body)
        resolved_z = entry.a1_point.z
        if resolved_z is None:
            raise ValueError("Calibration A1 must include z for preview.")
        wells = _derive_wells_from_calibration(entry, resolved_z=resolved_z)
        return {
            wid: WellPosition(x=round(c.x, 3), y=round(c.y, 3), z=round(c.z, 3))
            for wid, c in wells.items()
        }
    except (ValueError, ValidationError) as e:
        raise HTTPException(400, str(e))


@router.put("/{filename}")
def put_deck(filename: str, body: dict) -> DeckResponse:
    path = resolve_config_path(get_settings().configs_dir, "deck", filename)
    write_yaml(path, body)
    return get_deck(filename)


def _serialize_point(point: Any) -> Optional[WellPosition]:
    if point is None:
        return None
    return WellPosition(x=point.x, y=point.y, z=point.z)


def _serialize_positions(positions: Dict[str, Any]) -> Dict[str, WellPosition]:
    return {
        name: WellPosition(x=coord.x, y=coord.y, z=coord.z)
        for name, coord in positions.items()
        if coord is not None
    }


def _serialize_config_point(point: Any) -> Optional[WellPosition]:
    if point is None:
        return None
    if isinstance(point, dict):
        x = point.get("x")
        y = point.get("y")
        z = point.get("z")
    else:
        x = getattr(point, "x", None)
        y = getattr(point, "y", None)
        z = getattr(point, "z", None)
    if x is None or y is None or z is None:
        return None
    return WellPosition(x=x, y=y, z=z)


def _serialize_actionable_targets(
    positions: Dict[str, WellPosition],
) -> Optional[Dict[str, WellPosition]]:
    targets = {name: point for name, point in positions.items() if name != "location"}
    return targets or None


def _serialize_validation_points(
    validation_points_getter: Any,
) -> Optional[Dict[str, WellPosition]]:
    if not callable(validation_points_getter):
        return None

    raw_points = validation_points_getter()
    if isinstance(raw_points, dict):
        return _serialize_positions(raw_points) or None
    if isinstance(raw_points, (list, tuple)):
        return _serialize_positions({str(index): point for index, point in enumerate(raw_points)}) or None
    return None


def _resolve_default_target(
    *,
    labware_type: Optional[str],
    initial_position: Optional[WellPosition],
    positions: Dict[str, WellPosition],
    targets: Optional[Dict[str, WellPosition]],
) -> Optional[WellPosition]:
    if labware_type == "well_plate_holder":
        return (targets or {}).get("plate")
    if labware_type == "vial_holder":
        return None
    if labware_type in {"vial", "tip_disposal"}:
        return positions.get("location") or initial_position
    if labware_type in {"well_plate", "tip_rack"}:
        return initial_position or _first_target(targets)
    return initial_position or positions.get("location") or _first_target(targets)


def _resolve_render_anchor(
    *,
    placement_anchor: Optional[WellPosition],
    initial_position: Optional[WellPosition],
    positions: Dict[str, WellPosition],
    default_target: Optional[WellPosition],
) -> Optional[WellPosition]:
    return placement_anchor or positions.get("location") or initial_position or default_target


def _first_target(targets: Optional[Dict[str, WellPosition]]) -> Optional[WellPosition]:
    if not targets:
        return None
    return next(iter(targets.values()))


def _serialize_geometry(geometry: Any) -> Optional[Dict[str, Optional[float]]]:
    if geometry is None:
        return None
    return {
        "length_mm": getattr(geometry, "length_mm", None),
        "width_mm": getattr(geometry, "width_mm", None),
        "height_mm": getattr(geometry, "height_mm", None),
    }


_LABWARE_TYPE_MAP: Dict[str, str] = {
    "WellPlate": "well_plate",
    "Vial": "vial",
    "TipRack": "tip_rack",
    "WellPlateHolder": "well_plate_holder",
    "VialHolder": "vial_holder",
    "TipDisposal": "tip_disposal",
}


def _normalize_labware_config(raw_config: Any, labware: Any, deck_key: str) -> Dict[str, Any]:
    if not isinstance(raw_config, dict):
        log.warning("Labware %s has non-dict raw config (%r) — using empty config", deck_key, type(raw_config).__name__)
        config: Dict[str, Any] = {}
    else:
        config = deepcopy(raw_config)

    inferred_type = config.get("type") or _infer_labware_type(labware, deck_key)
    if inferred_type:
        config["type"] = inferred_type

    if "name" not in config and hasattr(labware, "name"):
        config["name"] = getattr(labware, "name")
    if "model_name" not in config and hasattr(labware, "model_name"):
        config["model_name"] = getattr(labware, "model_name")
    if "name" not in config:
        config["name"] = deck_key

    return config


def _infer_labware_type(labware: Any, deck_key: str) -> Optional[str]:
    class_name = labware.__class__.__name__
    labware_type = _LABWARE_TYPE_MAP.get(class_name)
    if labware_type is None:
        log.warning("Unknown labware class %r for key %s — type will not be inferred", class_name, deck_key)
    return labware_type
