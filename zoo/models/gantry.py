"""API response shapes for gantry endpoints. The YAML schema itself comes
from CubOS (gantry.yaml_schema.GantryYamlSchema) — Zoo must not duplicate it."""

from __future__ import annotations

from typing import Optional

from gantry.yaml_schema import GantryYamlSchema
from pydantic import BaseModel


class GantryResponse(BaseModel):
    filename: str
    config: GantryYamlSchema


class GantryPosition(BaseModel):
    x: float = 0.0
    y: float = 0.0
    z: float = 0.0
    work_x: Optional[float] = None
    work_y: Optional[float] = None
    work_z: Optional[float] = None
    status: str = "Unknown"
    connected: bool = False
