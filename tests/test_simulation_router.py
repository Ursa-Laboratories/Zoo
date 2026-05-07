"""Test Digital Sim API adapter endpoints."""

from tests.api_client import api_request
from zoo.app import create_app
from zoo.config import get_settings
from zoo.services.yaml_io import write_yaml


def test_build_digital_twin_uses_resolved_config_paths(monkeypatch, tmp_path):
    configs = tmp_path / "configs"
    for subdir in ("gantry", "deck", "protocol"):
        (configs / subdir).mkdir(parents=True)
        write_yaml(configs / subdir / "test.yaml", {})

    monkeypatch.setattr(get_settings(), "config_dir", configs)

    observed: dict[str, object] = {}

    def fake_export_digital_twin(**kwargs):
        observed.update(kwargs)
        return {
            "schemaVersion": "digital-twin.v1",
            "gantry": {"workingVolume": {}},
            "deck": {"labware": []},
            "protocol": {"timeline": []},
            "motion": {"path": []},
            "warnings": [],
        }

    monkeypatch.setattr("zoo.routers.simulation.export_digital_twin", fake_export_digital_twin)

    response = api_request(
        create_app(),
        "POST",
        "/api/simulation/digital-twin",
        json={
            "gantry_file": "test.yaml",
            "deck_file": "test.yaml",
            "protocol_file": "test.yaml",
            "sample_step_mm": 25,
        },
    )

    assert response.status_code == 200
    assert response.json()["schemaVersion"] == "digital-twin.v1"
    assert observed == {
        "gantry_path": configs / "gantry" / "test.yaml",
        "deck_path": configs / "deck" / "test.yaml",
        "protocol_path": configs / "protocol" / "test.yaml",
        "sample_step_mm": 25,
    }


def test_build_digital_twin_404s_missing_config(monkeypatch, tmp_path):
    configs = tmp_path / "configs"
    (configs / "gantry").mkdir(parents=True)
    (configs / "deck").mkdir()
    (configs / "protocol").mkdir()
    write_yaml(configs / "gantry" / "test.yaml", {})
    write_yaml(configs / "deck" / "test.yaml", {})
    monkeypatch.setattr(get_settings(), "config_dir", configs)

    response = api_request(
        create_app(),
        "POST",
        "/api/simulation/digital-twin",
        json={
            "gantry_file": "test.yaml",
            "deck_file": "test.yaml",
            "protocol_file": "missing.yaml",
        },
    )

    assert response.status_code == 404
    assert "Protocol file not found" in response.text
