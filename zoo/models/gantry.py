"""Pydantic models for gantry config."""

from __future__ import annotations

from typing import Optional

from pydantic import BaseModel, ConfigDict


class WorkingVolume(BaseModel):
    model_config = ConfigDict(extra="forbid")
    x_min: float
    x_max: float
    y_min: float
    y_max: float
    z_min: float
    z_max: float


class CncConfig(BaseModel):
    model_config = ConfigDict(extra="allow")
    homing_strategy: str = "standard"
    y_axis_motion: str = "head"


class GantryConfig(BaseModel):
    model_config = ConfigDict(extra="allow")
    serial_port: str = ""
    cnc: Optional[CncConfig] = None
    working_volume: WorkingVolume


class GantryResponse(BaseModel):
    filename: str
    config: GantryConfig


class GantryPosition(BaseModel):
    x: float = 0.0
    y: float = 0.0
    z: float = 0.0
    work_x: Optional[float] = None
    work_y: Optional[float] = None
    work_z: Optional[float] = None
    status: str = "Unknown"
    connected: bool = False
