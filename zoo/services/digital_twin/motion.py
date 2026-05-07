"""Protocol-to-motion expansion for the browser digital twin."""

from __future__ import annotations

from dataclasses import dataclass
from math import ceil
from typing import Any, Iterable, Mapping

from .geometry import AABB, Point3D, instrument_envelope


@dataclass(frozen=True)
class InstrumentModel:
    name: str
    offset_x: float = 0.0
    offset_y: float = 0.0
    depth: float = 0.0
    safe_approach_height: float = 40.0
    measurement_height: float = 0.0

    @classmethod
    def from_config(cls, name: str, raw: Mapping[str, Any]) -> "InstrumentModel":
        return cls(
            name=name,
            offset_x=float(raw.get("offset_x", 0.0) or 0.0),
            offset_y=float(raw.get("offset_y", 0.0) or 0.0),
            depth=float(raw.get("depth", 0.0) or 0.0),
            safe_approach_height=float(raw.get("safe_approach_height", 40.0) or 40.0),
            measurement_height=float(raw.get("measurement_height", 0.0) or 0.0),
        )

    def gantry_from_tool(self, tool: Point3D) -> Point3D:
        return Point3D(tool.x - self.offset_x, tool.y - self.offset_y, tool.z + self.depth)

    def tool_from_gantry(self, gantry: Point3D) -> Point3D:
        return Point3D(gantry.x + self.offset_x, gantry.y + self.offset_y, gantry.z - self.depth)


def interpolate_points(start: Point3D, end: Point3D, step_mm: float) -> list[Point3D]:
    dx = end.x - start.x
    dy = end.y - start.y
    dz = end.z - start.z
    distance = (dx * dx + dy * dy + dz * dz) ** 0.5
    steps = max(1, ceil(distance / max(step_mm, 0.001)))
    return [
        Point3D(
            start.x + dx * (i / steps),
            start.y + dy * (i / steps),
            start.z + dz * (i / steps),
        )
        for i in range(1, steps + 1)
    ]


def row_major_key(location_id: str) -> tuple[str, int, str]:
    letters = "".join(ch for ch in location_id if ch.isalpha())
    digits = "".join(ch for ch in location_id if ch.isdigit())
    return (letters, int(digits or 0), location_id)


class MotionPlanner:
    def __init__(
        self,
        *,
        deck: Any,
        protocol: Any,
        instruments: Mapping[str, InstrumentModel],
        working_volume: Mapping[str, float],
        sample_step_mm: float = 5.0,
    ) -> None:
        self.deck = deck
        self.protocol = protocol
        self.instruments = dict(instruments)
        self.working_volume = dict(working_volume)
        self.sample_step_mm = sample_step_mm
        self._active_instrument = next(iter(self.instruments.values()), InstrumentModel("instrument"))
        self._current_tool = self._active_instrument.tool_from_gantry(
            Point3D(
                float(self.working_volume["x_max"]),
                float(self.working_volume["y_max"]),
                float(self.working_volume["z_max"]),
            )
        )
        self.path: list[dict[str, Any]] = []
        self.segments: list[dict[str, Any]] = []
        self.timeline: list[dict[str, Any]] = []
        self._point_index = 0

    def plan(self) -> dict[str, Any]:
        self._add_path_point(
            self._current_tool,
            self._active_instrument,
            phase="home",
            step_index=-1,
            command="home",
            target_ref="home",
            note="Initial homed pose at working-volume maxima.",
        )

        for step in self.protocol.steps:
            args = dict(step.args)
            self.timeline.append(
                {
                    "index": step.index,
                    "command": step.command_name,
                    "args": _jsonable(args),
                    "pathStart": len(self.path),
                }
            )
            self._plan_step(step.index, step.command_name, args)
            self.timeline[-1]["pathEnd"] = max(len(self.path) - 1, self.timeline[-1]["pathStart"])

        return {"timeline": self.timeline, "segments": self.segments, "path": self.path}

    def _plan_step(self, step_index: int, command: str, args: Mapping[str, Any]) -> None:
        if command == "home":
            instr = self._active_instrument
            target_tool = instr.tool_from_gantry(
                Point3D(
                    float(self.working_volume["x_max"]),
                    float(self.working_volume["y_max"]),
                    float(self.working_volume["z_max"]),
                )
            )
            self._move_tool(target_tool, instr, step_index, command, "home", "home")
            return

        if command == "move":
            self._plan_move(step_index, args)
            return

        if command == "measure":
            self._plan_measure(step_index, command, args)
            return

        if command == "scan":
            self._plan_scan(step_index, args)
            return

        position = args.get("position") or args.get("source") or args.get("dest") or args.get("destination")
        instrument = args.get("instrument") or args.get("pipette")
        if position is not None and instrument is not None:
            self._plan_move(step_index, {"instrument": instrument, "position": position})

    def _plan_move(self, step_index: int, args: Mapping[str, Any]) -> None:
        instr = self._instrument(str(args["instrument"]))
        position = args["position"]
        target_ref, target = self._resolve_position(position)
        if target_ref.startswith("deck:"):
            approach_z = instr.safe_approach_height
            self._move_with_travel(
                Point3D(target.x, target.y, approach_z),
                instr,
                approach_z,
                step_index,
                "move",
                target_ref,
            )
        else:
            travel_z = args.get("travel_z")
            self._move_with_travel(target, instr, None if travel_z is None else float(travel_z), step_index, "move", target_ref)

    def _plan_measure(self, step_index: int, command: str, args: Mapping[str, Any]) -> None:
        instr = self._instrument(str(args["instrument"]))
        target_ref, target = self._resolve_position(args["position"])
        approach_z = float(args.get("safe_approach_height") or instr.safe_approach_height)
        action_z = float(args.get("measurement_height") or instr.measurement_height)
        self._move_with_travel(Point3D(target.x, target.y, approach_z), instr, approach_z, step_index, command, target_ref)
        self._move_tool(Point3D(target.x, target.y, action_z), instr, step_index, command, target_ref, "descend")

    def _plan_scan(self, step_index: int, args: Mapping[str, Any]) -> None:
        instr = self._instrument(str(args["instrument"]))
        plate_key = str(args["plate"])
        plate = self.deck[plate_key]
        wells = getattr(plate, "wells", {})
        measurement_z = float(args.get("measurement_height") or instr.measurement_height)
        interwell_z = float(args.get("interwell_travel_height") or measurement_z)
        entry_z = float(args.get("entry_travel_height") or interwell_z)
        for i, well_id in enumerate(sorted(wells, key=row_major_key)):
            well = Point3D.from_any(wells[well_id])
            approach_z = entry_z if i == 0 else interwell_z
            target_ref = f"deck:{plate_key}.{well_id}"
            self._move_with_travel(Point3D(well.x, well.y, approach_z), instr, approach_z, step_index, "scan", target_ref)
            self._move_tool(Point3D(well.x, well.y, measurement_z), instr, step_index, "scan", target_ref, "measure")
        if wells:
            last = Point3D.from_any(wells[sorted(wells, key=row_major_key)[-1]])
            self._move_tool(Point3D(last.x, last.y, interwell_z), instr, step_index, "scan", f"deck:{plate_key}", "final_retract")

    def _resolve_position(self, position: Any) -> tuple[str, Point3D]:
        if isinstance(position, str) and position in getattr(self.protocol, "positions", {}):
            return f"position:{position}", Point3D.from_any(self.protocol.positions[position])
        if isinstance(position, str):
            return f"deck:{position}", Point3D.from_any(self.deck.resolve(position))
        return "literal", Point3D.from_any(position)

    def _move_with_travel(
        self,
        target: Point3D,
        instr: InstrumentModel,
        travel_z: float | None,
        step_index: int,
        command: str,
        target_ref: str,
    ) -> None:
        if travel_z is not None:
            self._move_tool(
                Point3D(self._current_tool.x, self._current_tool.y, travel_z),
                instr,
                step_index,
                command,
                target_ref,
                "lift_to_travel_z",
            )
            self._move_tool(
                Point3D(target.x, target.y, travel_z),
                instr,
                step_index,
                command,
                target_ref,
                "xy_travel",
            )
        self._move_tool(target, instr, step_index, command, target_ref, "target")

    def _move_tool(
        self,
        target: Point3D,
        instr: InstrumentModel,
        step_index: int,
        command: str,
        target_ref: str,
        phase: str,
    ) -> None:
        start = self._current_tool
        segment_start = len(self.path) - 1
        for point in interpolate_points(start, target, self.sample_step_mm):
            self._add_path_point(point, instr, phase=phase, step_index=step_index, command=command, target_ref=target_ref)
        self.segments.append(
            {
                "stepIndex": step_index,
                "command": command,
                "phase": phase,
                "targetRef": target_ref,
                "pathStart": max(segment_start, 0),
                "pathEnd": len(self.path) - 1,
                "start": start.to_json(),
                "end": target.to_json(),
            }
        )
        self._current_tool = target
        self._active_instrument = instr

    def _add_path_point(
        self,
        tool: Point3D,
        instr: InstrumentModel,
        *,
        phase: str,
        step_index: int,
        command: str,
        target_ref: str,
        note: str | None = None,
    ) -> None:
        gantry = instr.gantry_from_tool(tool)
        row: dict[str, Any] = {
            "index": self._point_index,
            "stepIndex": step_index,
            "command": command,
            "phase": phase,
            "targetRef": target_ref,
            "instrument": instr.name,
            "tool": tool.to_json(),
            "gantry": gantry.to_json(),
            "envelope": instrument_envelope(tool, depth_mm=instr.depth, label=instr.name).to_json(),
        }
        if note:
            row["note"] = note
        self.path.append(row)
        self._point_index += 1

    def _instrument(self, name: str) -> InstrumentModel:
        try:
            return self.instruments[name]
        except KeyError as exc:
            raise KeyError(f"Unknown instrument {name!r}; available: {sorted(self.instruments)}") from exc


def collision_warnings(
    path: Iterable[Mapping[str, Any]],
    labware_boxes: Iterable[AABB],
    *,
    proximity_mm: float = 2.0,
) -> list[dict[str, Any]]:
    warnings: list[dict[str, Any]] = []
    seen: set[tuple[int, str, str]] = set()
    boxes = list(labware_boxes)
    for sample in path:
        envelope = _aabb_from_json(sample["envelope"])
        target_ref = str(sample.get("targetRef", ""))
        target_labware = _target_labware_name(target_ref)
        for labware in boxes:
            if labware.label == target_labware:
                continue
            relation = None
            distance = envelope.separation_mm(labware)
            if envelope.intersects(labware):
                relation = "collision"
            elif distance <= proximity_mm:
                relation = "proximity"
            if relation is None:
                continue
            key = (int(sample["stepIndex"]), str(labware.label), relation)
            if key in seen:
                continue
            seen.add(key)
            warnings.append(
                {
                    "severity": "warning" if relation == "proximity" else "error",
                    "type": relation,
                    "stepIndex": sample["stepIndex"],
                    "pathIndex": sample["index"],
                    "instrument": sample.get("instrument"),
                    "targetRef": target_ref,
                    "object": labware.label,
                    "distanceMm": round(distance, 3),
                    "message": f"{relation}: {sample.get('instrument')} envelope near {labware.label}",
                }
            )
    return warnings


def _aabb_from_json(raw: Mapping[str, Any]) -> AABB:
    return AABB(Point3D.from_any(raw["min"]), Point3D.from_any(raw["max"]), str(raw.get("label", "")), str(raw.get("kind", "")))


def _target_labware_name(target_ref: str) -> str:
    if not target_ref.startswith("deck:"):
        return ""
    name = target_ref.removeprefix("deck:").split(".", 1)[0]
    return name


def _jsonable(value: Any) -> Any:
    if isinstance(value, Mapping):
        return {str(k): _jsonable(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [_jsonable(v) for v in value]
    if hasattr(value, "model_dump"):
        return _jsonable(value.model_dump())
    return value
