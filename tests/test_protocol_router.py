"""Test protocol API endpoints."""

from __future__ import annotations

import tempfile
from pathlib import Path
from unittest.mock import MagicMock

import pytest
from gantry.session import (
    CalibrationBlockedError,
    GantryNotConnectedError,
    InterruptFeedHoldTimeoutError,
)

from tests.api_client import api_request
from zoo.app import create_app
from zoo.config import get_settings
from zoo.services.yaml_io import read_yaml, write_yaml


@pytest.fixture()
def tmp_configs(monkeypatch):
    """Create a temp configs dir with a sample protocol."""
    with tempfile.TemporaryDirectory() as d:
        configs = Path(d) / "configs"
        configs.mkdir()

        protocol_data = {
            "positions": {
                "park": [10.0, 20.0, 30.0],
            },
            "protocol": [
                {"move": {"instrument": "pipette", "position": "plate_1.A1"}},
                {"aspirate": {"position": "plate_1.A1", "volume_ul": 100.0}},
            ],
        }
        write_yaml(configs / "test_protocol.yaml", protocol_data)
        write_yaml(configs / "deck.yaml", {"labware": {}})

        monkeypatch.setattr(get_settings(), "config_dir", Path(d) / "configs")
        yield configs


@pytest.fixture()
def client():
    return create_app()


def test_get_commands(client):
    response = api_request(client, "GET", "/api/protocol/commands")
    assert response.status_code == 200
    commands = response.json()
    names = [command["name"] for command in commands]
    assert "move" in names
    assert "aspirate" in names
    assert "scan" in names
    assert len(names) >= 8


def test_get_single_command(client):
    response = api_request(client, "GET", "/api/protocol/commands/aspirate")
    assert response.status_code == 200
    command = response.json()
    assert command["name"] == "aspirate"
    arg_names = [arg["name"] for arg in command["args"]]
    assert "position" in arg_names
    assert "volume_ul" in arg_names
    assert "speed" in arg_names


def test_get_unknown_command(client):
    response = api_request(client, "GET", "/api/protocol/commands/nonexistent")
    assert response.status_code == 404


def test_list_protocol_configs(client, tmp_configs):
    response = api_request(client, "GET", "/api/protocol/configs")
    assert response.status_code == 200
    configs = response.json()
    assert "test_protocol.yaml" in configs
    assert "deck.yaml" not in configs


def test_get_protocol(client, tmp_configs):
    response = api_request(client, "GET", "/api/protocol/test_protocol.yaml")
    assert response.status_code == 200
    data = response.json()
    assert data["filename"] == "test_protocol.yaml"
    assert data["positions"] == {"park": [10.0, 20.0, 30.0]}
    assert len(data["steps"]) == 2
    assert data["steps"][0]["command"] == "move"
    assert data["steps"][1]["command"] == "aspirate"
    assert data["steps"][1]["args"]["volume_ul"] == 100.0


def test_save_protocol(client, tmp_configs):
    body = {
        "positions": {"park": [10.0, 20.0, 30.0]},
        "protocol": [
            {
                "command": "move",
                "args": {"instrument": "uvvis", "position": "plate_1.A1"},
            },
        ],
    }
    response = api_request(client, "PUT", "/api/protocol/new_protocol.yaml", json=body)
    assert response.status_code == 200
    assert (tmp_configs / "new_protocol.yaml").exists()
    assert read_yaml(tmp_configs / "new_protocol.yaml")["positions"] == body["positions"]


def test_validate_protocol_ok(client):
    body = {
        "protocol": [
            {"command": "move", "args": {"instrument": "pipette", "position": "plate_1.A1"}},
            {"command": "aspirate", "args": {"position": "plate_1.A1", "volume_ul": 100.0}},
        ]
    }
    response = api_request(client, "POST", "/api/protocol/validate", json=body)
    assert response.status_code == 200
    data = response.json()
    assert data["valid"] is True
    assert data["errors"] == []


def test_validate_protocol_unknown_command(client):
    body = {
        "protocol": [
            {"command": "fly_away", "args": {}},
        ]
    }
    response = api_request(client, "POST", "/api/protocol/validate", json=body)
    assert response.status_code == 200
    data = response.json()
    assert data["valid"] is False
    assert "Unknown command" in data["errors"][0]


def test_validate_protocol_missing_args(client):
    body = {
        "protocol": [
            {"command": "aspirate", "args": {"position": "plate_1.A1"}},
        ]
    }
    response = api_request(client, "POST", "/api/protocol/validate", json=body)
    assert response.status_code == 200
    data = response.json()
    assert data["valid"] is False
    assert "volume_ul" in data["errors"][0]


def test_validate_protocol_unknown_args(client):
    body = {
        "protocol": [
            {"command": "move", "args": {"instrument": "p", "position": "a", "turbo": True}},
        ]
    }
    response = api_request(client, "POST", "/api/protocol/validate", json=body)
    assert response.status_code == 200
    data = response.json()
    assert data["valid"] is False
    assert "turbo" in data["errors"][0]


def test_validate_setup_endpoint_calls_cubos_validation(monkeypatch, tmp_path):
    from zoo.routers import protocol as protocol_router

    for subdir in ("gantry", "deck", "protocol"):
        (tmp_path / subdir).mkdir()

    observed: dict[str, tuple[str, str, str]] = {}

    class FakeResult:
        passed = True
        errors = ()
        output = "RESULT: PASS"

    def fake_run_setup_validation(gantry_path: str, deck_path: str, protocol_path: str):
        observed["paths"] = (gantry_path, deck_path, protocol_path)
        return FakeResult()

    monkeypatch.setattr(protocol_router, "run_setup_validation", fake_run_setup_validation)
    monkeypatch.setattr(
        protocol_router,
        "get_settings",
        lambda: type("S", (), {"configs_dir": tmp_path})(),
    )

    response = api_request(
        create_app(),
        "POST",
        "/api/protocol/validate-setup",
        json={
            "gantry_file": "gantry.yaml",
            "deck_file": "deck.yaml",
            "protocol_file": "protocol.yaml",
        },
    )

    assert response.status_code == 200
    assert response.json() == {
        "valid": True,
        "errors": [],
        "output": "RESULT: PASS",
    }
    assert observed["paths"] == (
        str(tmp_path / "gantry" / "gantry.yaml"),
        str(tmp_path / "deck" / "deck.yaml"),
        str(tmp_path / "protocol" / "protocol.yaml"),
    )


def test_validate_setup_endpoint_returns_validation_errors(monkeypatch, tmp_path):
    from zoo.routers import protocol as protocol_router

    for subdir in ("gantry", "deck", "protocol"):
        (tmp_path / subdir).mkdir()

    class FakeResult:
        passed = False
        errors = ("park.location.target: gantry (-3.0, 50.0, 30.0) violates x_min=0.0",)
        output = "RESULT: FAIL"

    monkeypatch.setattr(
        protocol_router,
        "run_setup_validation",
        lambda *_args: FakeResult(),
    )
    monkeypatch.setattr(
        protocol_router,
        "get_settings",
        lambda: type("S", (), {"configs_dir": tmp_path})(),
    )

    response = api_request(
        create_app(),
        "POST",
        "/api/protocol/validate-setup",
        json={
            "gantry_file": "gantry.yaml",
            "deck_file": "deck.yaml",
            "protocol_file": "protocol.yaml",
        },
    )

    assert response.status_code == 200
    data = response.json()
    assert data["valid"] is False
    assert "park.location.target" in data["errors"][0]
    assert data["output"] == "RESULT: FAIL"


def test_run_endpoint_delegates_to_gantry_session(monkeypatch, tmp_path):
    from zoo.routers import gantry as gantry_router
    from zoo.routers import protocol as protocol_router

    observed: dict[str, object] = {}

    def fake_run_protocol_on_session(**kwargs):
        observed.update(kwargs)
        return type(
            "Result",
            (),
            {"status": "ok", "steps_executed": 2, "campaign_id": 123},
        )()

    monkeypatch.setattr(gantry_router, "run_protocol_on_session", fake_run_protocol_on_session)
    for subdir in ("gantry", "deck", "protocol"):
        (tmp_path / subdir).mkdir()
    monkeypatch.setattr(
        protocol_router,
        "get_settings",
        lambda: type(
            "S",
            (),
            {"configs_dir": tmp_path, "data_db_path": tmp_path / "data.db"},
        )(),
    )

    response = api_request(
        create_app(),
        "POST",
        "/api/protocol/run",
        json={
            "gantry_file": "gantry.yaml",
            "deck_file": "deck.yaml",
            "protocol_file": "protocol.yaml",
        },
    )

    assert response.status_code == 200
    assert response.json() == {
        "status": "ok",
        "steps_executed": 2,
        "campaign_id": 123,
    }
    assert observed["gantry_path"] == str(tmp_path / "gantry" / "gantry.yaml")
    assert observed["deck_path"] == str(tmp_path / "deck" / "deck.yaml")
    assert observed["protocol_path"] == str(tmp_path / "protocol" / "protocol.yaml")
    assert observed["db_path"] == tmp_path / "data.db"


def test_run_endpoint_maps_session_connection_errors(monkeypatch, tmp_path):
    from zoo.routers import gantry as gantry_router
    from zoo.routers import protocol as protocol_router

    monkeypatch.setattr(
        gantry_router,
        "run_protocol_on_session",
        lambda **_kwargs: (_ for _ in ()).throw(GantryNotConnectedError("nope")),
    )
    monkeypatch.setattr(
        protocol_router,
        "get_settings",
        lambda: type("S", (), {"configs_dir": tmp_path, "data_db_path": tmp_path / "data.db"})(),
    )

    response = api_request(
        create_app(),
        "POST",
        "/api/protocol/run",
        json={
            "gantry_file": "gantry.yaml",
            "deck_file": "deck.yaml",
            "protocol_file": "protocol.yaml",
        },
    )

    assert response.status_code == 400
    assert "Gantry is not connected" in response.text


def test_run_endpoint_blocks_active_calibration_warning(monkeypatch, tmp_path):
    from zoo.routers import gantry as gantry_router
    from zoo.routers import protocol as protocol_router

    monkeypatch.setattr(
        gantry_router,
        "run_protocol_on_session",
        lambda **_kwargs: (_ for _ in ()).throw(
            CalibrationBlockedError("calibration warning is active")
        ),
    )
    monkeypatch.setattr(
        protocol_router,
        "get_settings",
        lambda: type("S", (), {"configs_dir": tmp_path, "data_db_path": tmp_path / "data.db"})(),
    )

    response = api_request(
        create_app(),
        "POST",
        "/api/protocol/run",
        json={
            "gantry_file": "gantry.yaml",
            "deck_file": "deck.yaml",
            "protocol_file": "protocol.yaml",
        },
    )

    assert response.status_code == 400
    assert "calibration warning is active" in response.text


def test_cancel_endpoint_requests_session_interrupt(monkeypatch):
    from zoo.routers import gantry as gantry_router

    interrupt = MagicMock()
    monkeypatch.setattr(gantry_router, "request_feed_hold_interrupt", interrupt)

    response = api_request(create_app(), "POST", "/api/protocol/cancel")

    assert response.status_code == 200
    assert response.json() == {"status": "cancel_requested"}
    interrupt.assert_called_once()


def test_cancel_endpoint_treats_feed_hold_timeout_as_requested(monkeypatch):
    from zoo.routers import gantry as gantry_router

    def timeout():
        raise InterruptFeedHoldTimeoutError("sent but not acknowledged")

    monkeypatch.setattr(gantry_router, "request_feed_hold_interrupt", timeout)

    response = api_request(create_app(), "POST", "/api/protocol/cancel")

    assert response.status_code == 200
    assert response.json() == {
        "status": "cancel_requested",
        "warning": "sent but not acknowledged",
    }


def test_cancel_endpoint_requires_connected_gantry(monkeypatch):
    from zoo.routers import gantry as gantry_router

    def fail():
        raise GantryNotConnectedError("Gantry not connected")

    monkeypatch.setattr(gantry_router, "request_feed_hold_interrupt", fail)

    response = api_request(create_app(), "POST", "/api/protocol/cancel")

    assert response.status_code == 400
    assert "Gantry is not connected" in response.text
