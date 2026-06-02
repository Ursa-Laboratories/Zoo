"""Test deck API endpoints against CubOS deck loader behavior."""

from __future__ import annotations

from pathlib import Path
from types import SimpleNamespace

import pytest

from backend.tests.api_client import api_request
from zoo.app import create_app
from zoo.config import get_settings
from zoo.routers import deck as deck_router


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
    tip_length: 59.3
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
    assert rack["geometry"] == {"length": 9.0, "width": 9.0, "height": 6.0}
    assert rack["positions"]["A1"] == {"x": 10.0, "y": 20.0, "z": 30.0}
    assert rack["positions"]["B2"] == {"x": 19.0, "y": 11.0, "z": 30.0}

    plate_holder = items["well_plate_holder"]
    assert plate_holder["geometry"] == {"length": 100.0, "width": 155.0, "height": 14.8}
    assert plate_holder["location"] == {"x": 100.0, "y": 120.0, "z": 40.0}
    assert plate_holder["positions"]["plate"] == {"x": 100.0, "y": 120.0, "z": 45.0}
    assert plate_holder["positions"]["plate.B2"] == {"x": 109.0, "y": 111.0, "z": 45.0}

    vial_holder = items["vial_holder"]
    assert vial_holder["geometry"] == {"length": 36.2, "width": 300.2, "height": 35.1}
    assert vial_holder["location"] == {"x": 30.0, "y": 60.0, "z": 8.0}
    assert vial_holder["positions"]["vial_1"] == {"x": 30.0, "y": 60.0, "z": 26.0}


def test_list_deck_configs_uses_backend_config_dir(monkeypatch, tmp_path: Path):
    config_dir = tmp_path / "configs"
    deck_dir = config_dir / "deck"
    deck_dir.mkdir(parents=True)
    (deck_dir / "b.yaml").write_text("labware: {}\n", encoding="utf-8")
    (deck_dir / "a.yaml").write_text("labware: {}\n", encoding="utf-8")
    monkeypatch.setattr(get_settings(), "config_dir", config_dir)

    response = api_request(create_app(), "GET", "/api/deck/configs")

    assert response.status_code == 200
    assert response.json() == ["a.yaml", "b.yaml"]


def test_get_deck_rejects_missing_file(monkeypatch, tmp_path: Path):
    config_dir = tmp_path / "configs"
    (config_dir / "deck").mkdir(parents=True)
    monkeypatch.setattr(get_settings(), "config_dir", config_dir)

    response = api_request(create_app(), "GET", "/api/deck/missing.yaml")

    assert response.status_code == 404
    assert "Config not found: missing.yaml" in response.text


def test_get_deck_serializes_labware_fallbacks(monkeypatch, tmp_path: Path):
    config_dir = tmp_path / "configs"
    deck_dir = config_dir / "deck"
    deck_dir.mkdir(parents=True)
    (deck_dir / "fallbacks.yaml").write_text("labware:\n  mystery: []\n", encoding="utf-8")

    class MysteryLabware:
        pass

    fake_deck = SimpleNamespace(labware={"mystery": MysteryLabware()})
    monkeypatch.setattr(get_settings(), "config_dir", config_dir)
    monkeypatch.setattr(deck_router, "load_deck_from_yaml", lambda _path: fake_deck)

    response = api_request(create_app(), "GET", "/api/deck/fallbacks.yaml")

    assert response.status_code == 200
    item = response.json()["labware"][0]
    assert item["key"] == "mystery"
    assert item["config"] == {"name": "mystery"}
    assert item["location"] is None
    assert item["geometry"] is None
    assert item["positions"] is None


def test_serialize_point_returns_none_for_missing_point():
    assert deck_router._serialize_point(None) is None


def test_get_deck_normalizes_current_well_plate_editor_fields(monkeypatch, tmp_path: Path):
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
    assert plate["length"] == 127.76
    assert plate["width"] == 85.47
    assert plate["x_offset"] == 9.0
    assert plate["y_offset"] == 9.0


def test_preview_wells_rejects_missing_a1_z():
    response = api_request(
        create_app(),
        "POST",
        "/api/deck/preview-wells",
        json={
            "type": "well_plate",
            "name": "Preview Plate",
            "model_name": "preview_plate",
            "rows": 2,
            "columns": 2,
            "calibration": {
                "a1": {"x": 0.0, "y": 0.0},
                "a2": {"x": 9.0, "y": 0.0},
            },
            "x_offset": 9.0,
            "y_offset": 9.0,
        },
    )

    assert response.status_code == 400


def test_preview_wells_returns_rounded_positions(monkeypatch):
    fake_entry = SimpleNamespace(a1_point=SimpleNamespace(z=3.3333))
    fake_wells = {
        "A1": SimpleNamespace(x=1.23456, y=2.34567, z=3.3333),
    }
    monkeypatch.setattr(
        deck_router.WellPlateYamlEntry,
        "model_validate",
        lambda _body: fake_entry,
    )
    monkeypatch.setattr(
        deck_router,
        "_derive_wells_from_calibration",
        lambda entry, resolved_z: fake_wells,
    )

    response = api_request(
        create_app(),
        "POST",
        "/api/deck/preview-wells",
        json={"name": "preview"},
    )

    assert response.status_code == 200
    assert response.json() == {"A1": {"x": 1.235, "y": 2.346, "z": 3.333}}


def test_normalize_labware_config_uses_labware_name_when_raw_name_is_missing():
    config = deck_router._normalize_labware_config(
        {},
        SimpleNamespace(name="Named Labware"),
        "deck_key",
    )

    assert config["name"] == "Named Labware"


def test_get_deck_returns_400_for_invalid_yaml(monkeypatch, tmp_path: Path):
    config_dir = tmp_path / "configs"
    deck_dir = config_dir / "deck"
    deck_dir.mkdir(parents=True)
    (deck_dir / "broken.yaml").write_text("labware: [\n", encoding="utf-8")
    monkeypatch.setattr(get_settings(), "config_dir", config_dir)

    response = api_request(create_app(), "GET", "/api/deck/broken.yaml")

    assert response.status_code == 400
    assert "Invalid YAML" in response.text


def test_put_deck_validates_current_vial_fields_before_overwriting(monkeypatch, tmp_path: Path):
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
                    "height": 66.75,
                    "diameter": 28.0,
                    "location": {"x": 30.0, "y": 40.0, "z": 20.0},
                    "capacity_ul": 1500.0,
                    "working_volume_ul": 1200.0,
                }
            }
        },
    )

    assert response.status_code == 200
    vial = response.json()["labware"][0]["config"]
    assert vial["height"] == 66.75
    assert vial["diameter"] == 28.0

    saved = read_yaml(deck_dir / "qa_vial.yaml")
    assert saved["labware"]["vial_1"]["height"] == 66.75
    assert saved["labware"]["vial_1"]["diameter"] == 28.0


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
                    "height": 20.0,
                    "diameter": 10.0,
                    "location": {"x": 1.0, "y": 2.0, "z": 3.0},
                    "capacity_ul": 100.0,
                    "working_volume_ul": 150.0,
                }
            }
        },
    )

    assert response.status_code == 400
    assert path.read_text(encoding="utf-8") == original
