"""Test deck API endpoints against CubOS deck loader behavior."""

from __future__ import annotations

from pathlib import Path

import pytest

from tests.api_client import api_request
from zoo.app import create_app
from zoo.config import get_settings


@pytest.fixture(autouse=True)
def restore_config_dir():
    original = get_settings().config_dir
    yield
    get_settings().config_dir = original


def test_get_deck_exposes_explicit_target_and_anchor_semantics(monkeypatch, tmp_path: Path):
    config_dir = tmp_path / "configs"
    deck_dir = config_dir / "deck"
    deck_dir.mkdir(parents=True)
    (deck_dir / "panda_deck.yaml").write_text(
        """\
labware:
  rack_a:
    type: tip_rack
    name: Rack A
    model_name: panda_2x2_tip_rack
    rows: 2
    columns: 2
    z_pickup: 30.0
    z_drop: 24.0
    calibration:
      a1: { x: 10.0, y: 20.0 }
      a2: { x: 19.0, y: 20.0 }
    x_offset_mm: 9.0
    y_offset_mm: 9.0

  plate_a:
    type: well_plate
    name: Deck Plate
    model_name: panda_96_wellplate
    rows: 2
    columns: 2
    calibration:
      a1: { x: 200.0, y: 20.0, z: 12.0 }
      a2: { x: 209.0, y: 20.0, z: 12.0 }
    x_offset_mm: 9.0
    y_offset_mm: 9.0

  vial_a:
    type: vial
    name: Deck Vial
    model_name: 20ml_vial
    height_mm: 57.0
    diameter_mm: 28.0
    location:
      x: 230.0
      y: 60.0
      z: 31.0
    capacity_ul: 20000.0
    working_volume_ul: 15000.0

  well_plate_holder:
    type: well_plate_holder
    name: Plate Holder
    location:
      x: 100.0
      y: 120.0
      z: 40.0
    well_plate:
      name: Panda Plate
      model_name: panda_96_wellplate
      rows: 2
      columns: 2
      calibration:
        a1:
          x: 100.0
          y: 120.0
        a2:
          x: 109.0
          y: 120.0
      x_offset_mm: 9.0
      y_offset_mm: 9.0

  vial_holder:
    type: vial_holder
    name: Panda Vials
    location:
      x: 30.0
      y: 60.0
      z: 8.0
    vials:
      vial_1:
        name: Sample 1
        model_name: 20ml_vial
        height_mm: 57.0
        diameter_mm: 28.0
        location:
          x: 30.0
          y: 60.0
        capacity_ul: 20000.0
        working_volume_ul: 15000.0
""",
        encoding="utf-8",
    )
    monkeypatch.setattr(get_settings(), "config_dir", config_dir)
    app = create_app()

    response = api_request(app, "GET", "/api/deck/panda_deck.yaml")

    assert response.status_code == 200
    payload = response.json()
    items = {item["key"]: item for item in payload["labware"]}

    rack = items["rack_a"]
    assert rack["geometry"] == {"length_mm": 9.0, "width_mm": 9.0, "height_mm": 6.0}
    assert rack["default_target"] == {"x": 10.0, "y": 20.0, "z": 30.0}
    assert rack["targets"]["A1"] == {"x": 10.0, "y": 20.0, "z": 30.0}
    assert rack["targets"]["B2"] == {"x": 19.0, "y": 29.0, "z": 30.0}

    plate = items["plate_a"]
    assert plate["default_target"] == {"x": 200.0, "y": 20.0, "z": 12.0}
    assert plate["targets"]["A1"] == {"x": 200.0, "y": 20.0, "z": 12.0}
    assert plate["targets"]["B2"] == {"x": 209.0, "y": 29.0, "z": 12.0}
    assert plate["wells"] == plate["targets"]

    vial = items["vial_a"]
    assert vial["placement_anchor"] == {"x": 230.0, "y": 60.0, "z": 31.0}
    assert vial["render_anchor"] == {"x": 230.0, "y": 60.0, "z": 31.0}
    assert vial["default_target"] == {"x": 230.0, "y": 60.0, "z": 31.0}
    assert vial["targets"] is None

    plate_holder = items["well_plate_holder"]
    assert plate_holder["geometry"] == {"length_mm": 100.0, "width_mm": 155.0, "height_mm": 14.8}
    assert plate_holder["placement_anchor"] == {"x": 100.0, "y": 120.0, "z": 40.0}
    assert plate_holder["render_anchor"] == {"x": 100.0, "y": 120.0, "z": 40.0}
    assert plate_holder["default_target"] == {"x": 100.0, "y": 120.0, "z": 45.0}
    assert plate_holder["targets"]["plate"] == {"x": 100.0, "y": 120.0, "z": 45.0}
    assert plate_holder["targets"]["plate.B2"] == {"x": 109.0, "y": 129.0, "z": 45.0}

    vial_holder = items["vial_holder"]
    assert vial_holder["geometry"] == {"length_mm": 36.2, "width_mm": 300.2, "height_mm": 35.1}
    assert vial_holder["placement_anchor"] == {"x": 30.0, "y": 60.0, "z": 8.0}
    assert vial_holder["render_anchor"] == {"x": 30.0, "y": 60.0, "z": 8.0}
    assert vial_holder["default_target"] is None
    assert vial_holder["targets"]["vial_1"] == {"x": 30.0, "y": 60.0, "z": 26.0}
