"""Geometry primitives for CubOS digital twin export and collision checks."""

from __future__ import annotations

from dataclasses import dataclass
from math import sqrt
from typing import Iterable, Mapping


@dataclass(frozen=True)
class Point3D:
    x: float
    y: float
    z: float

    @classmethod
    def from_any(cls, value: object) -> "Point3D":
        if isinstance(value, Mapping):
            return cls(float(value["x"]), float(value["y"]), float(value["z"]))
        if isinstance(value, (list, tuple)):
            return cls(float(value[0]), float(value[1]), float(value[2]))
        return cls(float(getattr(value, "x")), float(getattr(value, "y")), float(getattr(value, "z")))

    def to_json(self) -> dict[str, float]:
        return {"x": self.x, "y": self.y, "z": self.z}


@dataclass(frozen=True)
class AABB:
    min: Point3D
    max: Point3D
    label: str = ""
    kind: str = "object"

    def intersects(self, other: "AABB", tolerance_mm: float = 0.0) -> bool:
        return (
            self.min.x <= other.max.x + tolerance_mm
            and self.max.x >= other.min.x - tolerance_mm
            and self.min.y <= other.max.y + tolerance_mm
            and self.max.y >= other.min.y - tolerance_mm
            and self.min.z <= other.max.z + tolerance_mm
            and self.max.z >= other.min.z - tolerance_mm
        )

    def separation_mm(self, other: "AABB") -> float:
        dx = max(other.min.x - self.max.x, self.min.x - other.max.x, 0.0)
        dy = max(other.min.y - self.max.y, self.min.y - other.max.y, 0.0)
        dz = max(other.min.z - self.max.z, self.min.z - other.max.z, 0.0)
        return sqrt(dx * dx + dy * dy + dz * dz)

    def expanded(self, padding_mm: float) -> "AABB":
        return AABB(
            Point3D(self.min.x - padding_mm, self.min.y - padding_mm, self.min.z - padding_mm),
            Point3D(self.max.x + padding_mm, self.max.y + padding_mm, self.max.z + padding_mm),
            self.label,
            self.kind,
        )

    def to_json(self) -> dict[str, object]:
        return {
            "label": self.label,
            "kind": self.kind,
            "min": self.min.to_json(),
            "max": self.max.to_json(),
            "size": {
                "x": round(self.max.x - self.min.x, 6),
                "y": round(self.max.y - self.min.y, 6),
                "z": round(self.max.z - self.min.z, 6),
            },
            "center": {
                "x": round((self.min.x + self.max.x) / 2.0, 6),
                "y": round((self.min.y + self.max.y) / 2.0, 6),
                "z": round((self.min.z + self.max.z) / 2.0, 6),
            },
        }


def point_json(value: object) -> dict[str, float]:
    return Point3D.from_any(value).to_json()


def aabb_from_base_center(
    center: Point3D,
    *,
    length_mm: float,
    width_mm: float,
    height_mm: float,
    label: str,
    kind: str,
) -> AABB:
    """Create an AABB from CubOS-style XY center and bottom/reference Z."""
    return AABB(
        Point3D(center.x - length_mm / 2.0, center.y - width_mm / 2.0, center.z),
        Point3D(center.x + length_mm / 2.0, center.y + width_mm / 2.0, center.z + height_mm),
        label=label,
        kind=kind,
    )


def aabb_from_points(
    points: Iterable[Point3D],
    *,
    length_mm: float | None,
    width_mm: float | None,
    height_mm: float | None,
    label: str,
    kind: str,
) -> AABB | None:
    pts = list(points)
    if not pts:
        return None

    min_x = min(p.x for p in pts)
    max_x = max(p.x for p in pts)
    min_y = min(p.y for p in pts)
    max_y = max(p.y for p in pts)
    min_z = min(p.z for p in pts)

    if length_mm is not None:
        cx = (min_x + max_x) / 2.0
        min_x = min(min_x, cx - length_mm / 2.0)
        max_x = max(max_x, cx + length_mm / 2.0)
    if width_mm is not None:
        cy = (min_y + max_y) / 2.0
        min_y = min(min_y, cy - width_mm / 2.0)
        max_y = max(max_y, cy + width_mm / 2.0)

    z_size = height_mm if height_mm is not None else 1.0
    return AABB(Point3D(min_x, min_y, min_z), Point3D(max_x, max_y, min_z + z_size), label, kind)


def instrument_envelope(
    tool_position: Point3D,
    *,
    depth_mm: float,
    width_mm: float = 18.0,
    label: str = "instrument",
) -> AABB:
    """Approximate the attached instrument as a vertical box above the TCP."""
    height = max(abs(depth_mm), 20.0)
    return aabb_from_base_center(
        tool_position,
        length_mm=width_mm,
        width_mm=width_mm,
        height_mm=height,
        label=label,
        kind="instrument_envelope",
    )
