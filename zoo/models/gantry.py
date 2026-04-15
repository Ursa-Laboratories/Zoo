"""Pydantic models for gantry API responses."""

from __future__ import annotations

from typing import Any, Optional

from pydantic import BaseModel


class GantryResponse(BaseModel):
    filename: str
    config: dict[str, Any]


class GantryPosition(BaseModel):
    x: float = 0.0
    y: float = 0.0
    z: float = 0.0
    work_x: Optional[float] = None
    work_y: Optional[float] = None
    work_z: Optional[float] = None
    status: str = "Unknown"
    connected: bool = False
