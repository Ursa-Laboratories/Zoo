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


def test_get_deck_returns_holder_geometry_and_nested_positions(monkeypatch, tmp_path: Path):
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
    pickup_z: 30.0
    drop_z: 24.0
    calibration:
      a1: { x: 10.0, y: 20.0 }
      a2: { x: 19.0, y: 20.0 }
    x_offset: 9.0
    y_offset: 9.0

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
      x_offset: 9.0
      y_offset: 9.0

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
        height: 57.0
        diameter: 28.0
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
    assert rack["positions"]["A1"] == {"x": 10.0, "y": 20.0, "z": 30.0}
    assert rack["positions"]["B2"] == {"x": 19.0, "y": 11.0, "z": 30.0}

    plate_holder = items["well_plate_holder"]
    assert plate_holder["geometry"] == {"length_mm": 100.0, "width_mm": 155.0, "height_mm": 14.8}
    assert plate_holder["location"] == {"x": 100.0, "y": 120.0, "z": 40.0}
    assert plate_holder["positions"]["plate"] == {"x": 100.0, "y": 120.0, "z": 45.0}
    assert plate_holder["positions"]["plate.B2"] == {"x": 109.0, "y": 111.0, "z": 45.0}

    vial_holder = items["vial_holder"]
    assert vial_holder["geometry"] == {"length_mm": 36.2, "width_mm": 300.2, "height_mm": 35.1}
    assert vial_holder["location"] == {"x": 30.0, "y": 60.0, "z": 8.0}
    assert vial_holder["positions"]["vial_1"] == {"x": 30.0, "y": 60.0, "z": 26.0}


def test_get_deck_normalizes_well_plate_editor_fields(monkeypatch, tmp_path: Path):
    config_dir = tmp_path / "configs"
    deck_dir = config_dir / "deck"
    deck_dir.mkdir(parents=True)
    (deck_dir / "asmi_deck.yaml").write_text(
        """\
labware:
  plate:
    load_name: sbs_96_wellplate
    name: asmi_96_well_deck_origin
    model_name: asmi_96_well_deck_origin
    calibration:
      a1: {x: 347.0, y: 42.0, z: 30.0}
      a2: {x: 338.0, y: 42.0, z: 30.0}
    x_offset: 9.0
    y_offset: 9.0
""",
        encoding="utf-8",
    )
    monkeypatch.setattr(get_settings(), "config_dir", config_dir)
    app = create_app()

    response = api_request(app, "GET", "/api/deck/asmi_deck.yaml")

    assert response.status_code == 200
    plate = response.json()["labware"][0]["config"]
    assert plate["rows"] == 8
    assert plate["columns"] == 12
    assert plate["length_mm"] == 127.76
    assert plate["width_mm"] == 85.47
    assert plate["x_offset_mm"] == 9.0
    assert plate["y_offset_mm"] == 9.0


def test_get_deck_returns_400_for_invalid_yaml(monkeypatch, tmp_path: Path):
    config_dir = tmp_path / "configs"
    deck_dir = config_dir / "deck"
    deck_dir.mkdir(parents=True)
    (deck_dir / "broken.yaml").write_text("labware: [\n", encoding="utf-8")
    monkeypatch.setattr(get_settings(), "config_dir", config_dir)

    response = api_request(create_app(), "GET", "/api/deck/broken.yaml")

    assert response.status_code == 400
    assert "Invalid YAML" in response.text


def test_put_deck_coerces_frontend_vial_fields_before_cubos_validation(monkeypatch, tmp_path: Path):
    from zoo.services.yaml_io import read_yaml

    config_dir = tmp_path / "configs"
    deck_dir = config_dir / "deck"
    deck_dir.mkdir(parents=True)
    monkeypatch.setattr(get_settings(), "config_dir", config_dir)

    response = api_request(
        create_app(),
        "PUT",
        "/api/deck/qa_vial.yaml",
        json={
            "labware": {
                "vial_1": {
                    "type": "vial",
                    "name": "QA vial",
                    "model_name": "",
                    "height_mm": 66.75,
                    "diameter_mm": 28.0,
                    "location": {"x": 30.0, "y": 40.0, "z": 20.0},
                    "capacity_ul": 1500.0,
                    "working_volume_ul": 1200.0,
                }
            }
        },
    )

    assert response.status_code == 200
    vial = response.json()["labware"][0]["config"]
    assert vial["height_mm"] == 66.75
    assert vial["diameter_mm"] == 28.0

    saved = read_yaml(deck_dir / "qa_vial.yaml")
    assert saved["labware"]["vial_1"]["height"] == 66.75
    assert saved["labware"]["vial_1"]["diameter"] == 28.0
    assert "height_mm" not in saved["labware"]["vial_1"]
    assert "diameter_mm" not in saved["labware"]["vial_1"]


def test_put_deck_validates_before_overwriting_existing_file(monkeypatch, tmp_path: Path):
    config_dir = tmp_path / "configs"
    deck_dir = config_dir / "deck"
    deck_dir.mkdir(parents=True)
    path = deck_dir / "existing.yaml"
    path.write_text(
        """\
labware:
  vial_1:
    type: vial
    name: Existing vial
    model_name: ''
    height: 20.0
    diameter: 10.0
    location: {x: 1.0, y: 2.0, z: 3.0}
    capacity_ul: 100.0
    working_volume_ul: 50.0
""",
        encoding="utf-8",
    )
    original = path.read_text(encoding="utf-8")
    monkeypatch.setattr(get_settings(), "config_dir", config_dir)

    response = api_request(
        create_app(),
        "PUT",
        "/api/deck/existing.yaml",
        json={
            "labware": {
                "vial_1": {
                    "type": "vial",
                    "name": "Invalid vial",
                    "model_name": "",
                    "height_mm": 20.0,
                    "diameter_mm": 10.0,
                    "location": {"x": 1.0, "y": 2.0, "z": 3.0},
                    "capacity_ul": 100.0,
                    "working_volume_ul": 150.0,
                }
            }
        },
    )

    assert response.status_code == 400
    assert path.read_text(encoding="utf-8") == original
