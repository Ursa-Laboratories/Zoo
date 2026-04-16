"""Test protocol API endpoints."""

import tempfile
from pathlib import Path

import pytest

from tests.api_client import api_request
from zoo.app import create_app
from zoo.config import get_settings
from zoo.services.yaml_io import write_yaml


@pytest.fixture()
def tmp_configs(monkeypatch):
    """Create a temp configs dir with a sample protocol."""
    with tempfile.TemporaryDirectory() as d:
        configs = Path(d) / "configs"
        configs.mkdir()

        protocol_data = {
            "protocol": [
                {"move": {"instrument": "pipette", "position": "plate_1.A1"}},
                {"aspirate": {"position": "plate_1.A1", "volume_ul": 100.0}},
            ]
        }
        write_yaml(configs / "test_protocol.yaml", protocol_data)

        # Also add a non-protocol file to make sure it's excluded
        write_yaml(configs / "deck.yaml", {"labware": {}})

        monkeypatch.setattr(get_settings(), "config_dir", Path(d) / "configs")
        yield configs


@pytest.fixture()
def client():
    return create_app()


def test_get_commands(client):
    r = api_request(client, "GET", "/api/protocol/commands")
    assert r.status_code == 200
    commands = r.json()
    names = [c["name"] for c in commands]
    assert "move" in names
    assert "aspirate" in names
    assert "scan" in names
    # Commands come from CubOS's registry; at least the core set exists.
    assert len(names) >= 8


def test_get_single_command(client):
    r = api_request(client, "GET", "/api/protocol/commands/aspirate")
    assert r.status_code == 200
    cmd = r.json()
    assert cmd["name"] == "aspirate"
    arg_names = [a["name"] for a in cmd["args"]]
    assert "position" in arg_names
    assert "volume_ul" in arg_names
    assert "speed" in arg_names


def test_get_unknown_command(client):
    r = api_request(client, "GET", "/api/protocol/commands/nonexistent")
    assert r.status_code == 404


def test_list_protocol_configs(client, tmp_configs):
    r = api_request(client, "GET", "/api/protocol/configs")
    assert r.status_code == 200
    configs = r.json()
    assert "test_protocol.yaml" in configs
    assert "deck.yaml" not in configs


def test_get_protocol(client, tmp_configs):
    r = api_request(client, "GET", "/api/protocol/test_protocol.yaml")
    assert r.status_code == 200
    data = r.json()
    assert data["filename"] == "test_protocol.yaml"
    assert len(data["steps"]) == 2
    assert data["steps"][0]["command"] == "move"
    assert data["steps"][1]["command"] == "aspirate"
    assert data["steps"][1]["args"]["volume_ul"] == 100.0


def test_save_protocol(client, tmp_configs):
    body = {
        "protocol": [
            {"command": "move", "args": {"instrument": "uvvis", "position": "plate_1.A1"}},
        ]
    }
    r = api_request(client, "PUT", "/api/protocol/new_protocol.yaml", json=body)
    assert r.status_code == 200
    assert (tmp_configs / "new_protocol.yaml").exists()


def test_validate_protocol_ok(client):
    body = {
        "protocol": [
            {"command": "move", "args": {"instrument": "pipette", "position": "plate_1.A1"}},
            {"command": "aspirate", "args": {"position": "plate_1.A1", "volume_ul": 100.0}},
        ]
    }
    r = api_request(client, "POST", "/api/protocol/validate", json=body)
    assert r.status_code == 200
    data = r.json()
    assert data["valid"] is True
    assert data["errors"] == []


def test_validate_protocol_unknown_command(client):
    body = {
        "protocol": [
            {"command": "fly_away", "args": {}},
        ]
    }
    r = api_request(client, "POST", "/api/protocol/validate", json=body)
    assert r.status_code == 200
    data = r.json()
    assert data["valid"] is False
    assert "Unknown command" in data["errors"][0]


def test_validate_protocol_missing_args(client):
    body = {
        "protocol": [
            {"command": "aspirate", "args": {"position": "plate_1.A1"}},
        ]
    }
    r = api_request(client, "POST", "/api/protocol/validate", json=body)
    assert r.status_code == 200
    data = r.json()
    assert data["valid"] is False
    assert "volume_ul" in data["errors"][0]


def test_validate_protocol_unknown_args(client):
    body = {
        "protocol": [
            {"command": "move", "args": {"instrument": "p", "position": "a", "turbo": True}},
        ]
    }
    r = api_request(client, "POST", "/api/protocol/validate", json=body)
    assert r.status_code == 200
    data = r.json()
    assert data["valid"] is False
    assert "turbo" in data["errors"][0]


def test_run_endpoint_holds_serial_lock_for_duration(monkeypatch, tmp_configs):
    """Regression: /protocol/run must run inside ``_serial_lock`` so the
    200 ms /position poll can't race the protocol's G-code writes on the
    serial port — the race closed the port mid-run with
    ``[Errno 9] Bad file descriptor`` on real hardware.

    Also pins that ``is_healthy()`` runs INSIDE the lock: it writes ``?``
    to the serial port and would re-introduce the same race if it ran
    before the ``with _serial_lock:`` block.
    """
    import tempfile
    from unittest.mock import MagicMock
    from zoo.app import create_app
    from zoo.routers import gantry as gantry_router
    from zoo.routers import protocol as protocol_router

    observations: list[tuple[str, bool]] = []

    mock_gantry = MagicMock()

    def observe_is_healthy():
        observations.append(("is_healthy_lock_held", gantry_router._serial_lock.locked()))
        return True

    mock_gantry.is_healthy.side_effect = observe_is_healthy

    def fake_run(*_a, gantry=None, **_kw):
        observations.append(("run_lock_held", gantry_router._serial_lock.locked()))
        return []

    monkeypatch.setattr(gantry_router, "_gantry", mock_gantry)
    monkeypatch.setattr(protocol_router, "run_protocol", fake_run)

    # Minimal viable path resolution: create the four YAMLs /run checks
    # for so path validation doesn't 404 us before the lock work.
    with tempfile.TemporaryDirectory() as d:
        import pathlib
        from zoo.services.yaml_io import write_yaml as wy
        d_path = pathlib.Path(d)
        for sub in ("gantry", "deck", "board", "protocol"):
            (d_path / sub).mkdir()
            wy(d_path / sub / "test.yaml", {})
        monkeypatch.setattr(
            "zoo.config.get_settings",
            lambda: type("S", (), {"configs_dir": d_path})(),
        )

        response = api_request(
            create_app(),
            "POST",
            "/api/protocol/run",
            json={
                "gantry_file": "test.yaml",
                "deck_file": "test.yaml",
                "board_file": "test.yaml",
                "protocol_file": "test.yaml",
            },
        )

    assert response.status_code == 200
    assert ("is_healthy_lock_held", True) in observations
    assert ("run_lock_held", True) in observations
    # Lock released after the endpoint returns — no leak.
    assert gantry_router._serial_lock.locked() is False
