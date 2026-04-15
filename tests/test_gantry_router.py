"""Test gantry API endpoints against CubOS gantry schema semantics."""

from __future__ import annotations

from pathlib import Path

import pytest
from fastapi import HTTPException

from zoo.config import get_settings
from zoo.routers.gantry import get_gantry, put_gantry
from zoo.services.yaml_io import read_yaml


@pytest.fixture(autouse=True)
def restore_config_dir():
    original = get_settings().config_dir
    yield
    get_settings().config_dir = original


def test_get_gantry_uses_cubos_yaml_schema(monkeypatch, tmp_path: Path):
    config_dir = tmp_path / "configs"
    gantry_dir = config_dir / "gantry"
    gantry_dir.mkdir(parents=True)
    (gantry_dir / "panda_gantry.yaml").write_text(
        """\
serial_port: /dev/ttyUSB0
cnc:
  homing_strategy: xy_hard_limits
  y_axis_motion: bed
  total_z_height: 120
working_volume:
  x_min: 0
  x_max: 300
  y_min: 0
  y_max: 200
  z_min: 0
  z_max: 80
""",
        encoding="utf-8",
    )
    monkeypatch.setattr(get_settings(), "config_dir", config_dir)
    payload = get_gantry("panda_gantry.yaml").model_dump(mode="json")

    assert payload == {
        "filename": "panda_gantry.yaml",
        "config": {
            "serial_port": "/dev/ttyUSB0",
            "cnc": {
                "homing_strategy": "xy_hard_limits",
                "y_axis_motion": "bed",
                "total_z_height": 120.0,
            },
            "working_volume": {
                "x_min": 0.0,
                "x_max": 300.0,
                "y_min": 0.0,
                "y_max": 200.0,
                "z_min": 0.0,
                "z_max": 80.0,
            },
        },
    }


def test_put_gantry_validates_with_cubos_schema_before_writing(monkeypatch, tmp_path: Path):
    config_dir = tmp_path / "configs"
    (config_dir / "gantry").mkdir(parents=True)
    monkeypatch.setattr(get_settings(), "config_dir", config_dir)
    body = {
        "serial_port": "/dev/ttyUSB0",
        "cnc": {
            "homing_strategy": "xy_hard_limits",
            "y_axis_motion": "head",
            "total_z_height": 90,
        },
        "working_volume": {
            "x_min": 0,
            "x_max": 300,
            "y_min": 0,
            "y_max": 200,
            "z_min": 0,
            "z_max": 80,
        },
    }

    response = put_gantry("new_gantry.yaml", body).model_dump(mode="json")

    assert response["config"]["cnc"]["total_z_height"] == 90.0
    assert read_yaml(config_dir / "gantry" / "new_gantry.yaml") == {
        "serial_port": "/dev/ttyUSB0",
        "cnc": {
            "homing_strategy": "xy_hard_limits",
            "y_axis_motion": "head",
            "total_z_height": 90.0,
        },
        "working_volume": {
            "x_min": 0.0,
            "x_max": 300.0,
            "y_min": 0.0,
            "y_max": 200.0,
            "z_min": 0.0,
            "z_max": 80.0,
        },
    }


def test_put_gantry_rejects_configs_that_fail_cubos_validation(monkeypatch, tmp_path: Path):
    config_dir = tmp_path / "configs"
    (config_dir / "gantry").mkdir(parents=True)
    monkeypatch.setattr(get_settings(), "config_dir", config_dir)
    body = {
        "serial_port": "/dev/ttyUSB0",
        "cnc": {
            "homing_strategy": "xy_hard_limits",
            "y_axis_motion": "head",
        },
        "working_volume": {
            "x_min": 0,
            "x_max": 300,
            "y_min": 0,
            "y_max": 200,
            "z_min": 0,
            "z_max": 80,
        },
    }

    with pytest.raises(HTTPException) as exc_info:
        put_gantry("invalid.yaml", body)

    assert exc_info.value.status_code == 400
    assert "cnc.total_z_height" in exc_info.value.detail
    assert not (config_dir / "gantry" / "invalid.yaml").exists()
