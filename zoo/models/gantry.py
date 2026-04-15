"""Pydantic gantry models backed by CubOS gantry config semantics."""

from __future__ import annotations

import importlib.util
import sys
from pathlib import Path
from typing import Any, Optional

from pydantic import BaseModel, ConfigDict, model_validator


def _load_cubos_gantry_config_module():
    workspace_root = Path(__file__).resolve().parents[2].parent
    module_path = workspace_root / "CubOS" / "src" / "gantry" / "gantry_config.py"
    if not module_path.exists():
        raise RuntimeError(f"CubOS gantry config module not found at {module_path}")

    spec = importlib.util.spec_from_file_location("cubos_gantry_config", module_path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"Unable to load CubOS gantry config module from {module_path}")

    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


_cubos_gantry_config = _load_cubos_gantry_config_module()
CubosGantryConfig = _cubos_gantry_config.GantryConfig
CubosHomingStrategy = _cubos_gantry_config.HomingStrategy
CubosWorkingVolume = _cubos_gantry_config.WorkingVolume


class WorkingVolume(BaseModel):
    model_config = ConfigDict(extra="forbid")
    x_min: float
    x_max: float
    y_min: float
    y_max: float
    z_min: float
    z_max: float

    def to_cubos(self) -> CubosWorkingVolume:
        return CubosWorkingVolume(
            x_min=self.x_min,
            x_max=self.x_max,
            y_min=self.y_min,
            y_max=self.y_max,
            z_min=self.z_min,
            z_max=self.z_max,
        )

    @classmethod
    def from_cubos(cls, config: CubosWorkingVolume) -> "WorkingVolume":
        return cls(
            x_min=config.x_min,
            x_max=config.x_max,
            y_min=config.y_min,
            y_max=config.y_max,
            z_min=config.z_min,
            z_max=config.z_max,
        )


class CncConfig(BaseModel):
    model_config = ConfigDict(extra="allow")
    homing_strategy: str = "standard"
    y_axis_motion: str = "head"


class GantryConfig(BaseModel):
    model_config = ConfigDict(extra="allow")
    serial_port: str = ""
    cnc: Optional[CncConfig] = None
    working_volume: WorkingVolume

    def _expected_grbl_settings(self) -> Optional[dict[str, str]]:
        raw = getattr(self, "expected_grbl_settings", None)
        if raw is None and self.model_extra:
            raw = self.model_extra.get("expected_grbl_settings")
        if raw is None:
            return None
        return {str(k): str(v) for k, v in dict(raw).items()}

    def to_cubos(self) -> CubosGantryConfig:
        homing_strategy = self.cnc.homing_strategy if self.cnc else "standard"
        return CubosGantryConfig(
            serial_port=self.serial_port,
            homing_strategy=CubosHomingStrategy(homing_strategy),
            working_volume=self.working_volume.to_cubos(),
            expected_grbl_settings=self._expected_grbl_settings(),
        )

    @classmethod
    def from_cubos(cls, config: CubosGantryConfig) -> "GantryConfig":
        payload: dict[str, Any] = {
            "serial_port": config.serial_port,
            "cnc": {"homing_strategy": config.homing_strategy.value},
            "working_volume": WorkingVolume.from_cubos(config.working_volume).model_dump(),
        }
        if config.expected_grbl_settings is not None:
            payload["expected_grbl_settings"] = config.expected_grbl_settings
        return cls.model_validate(payload)

    @model_validator(mode="after")
    def _validate_with_cubos(self) -> "GantryConfig":
        self.to_cubos()
        return self


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
