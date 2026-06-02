"""Test protocol API endpoints."""

import tempfile
from pathlib import Path

import pytest

from backend.tests.api_client import api_request
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
    assert data["positions"] == {"park": [10.0, 20.0, 30.0]}
    assert len(data["steps"]) == 2
    assert data["steps"][0]["command"] == "move"
    assert data["steps"][1]["command"] == "aspirate"
    assert data["steps"][1]["args"]["volume_ul"] == 100.0


def test_get_protocol_rejects_missing_file(client, tmp_configs):
    r = api_request(client, "GET", "/api/protocol/missing.yaml")

    assert r.status_code == 404
    assert "Protocol file not found: missing.yaml" in r.text


def test_get_protocol_rejects_invalid_yaml(client, tmp_configs):
    (tmp_configs / "broken.yaml").write_text("protocol: [\n", encoding="utf-8")

    r = api_request(client, "GET", "/api/protocol/broken.yaml")

    assert r.status_code == 400
    assert "Invalid YAML" in r.text


def test_get_protocol_rejects_non_protocol_yaml(client, tmp_configs):
    write_yaml(tmp_configs / "not_protocol.yaml", {"labware": {}})

    r = api_request(client, "GET", "/api/protocol/not_protocol.yaml")

    assert r.status_code == 400
    assert "not a valid protocol YAML" in r.text


def test_get_protocol_skips_malformed_steps_and_ignores_non_mapping_positions(client, tmp_configs):
    write_yaml(
        tmp_configs / "mixed.yaml",
        {
            "positions": ["park", 1, 2, 3],
            "protocol": [
                {"move": {"instrument": "pipette", "position": "plate_1.A1"}},
                {"bad": {}, "extra": {}},
                "not a step",
                {"home": None},
            ],
        },
    )

    r = api_request(client, "GET", "/api/protocol/mixed.yaml")

    assert r.status_code == 200
    data = r.json()
    assert data["positions"] is None
    assert data["steps"] == [
        {
            "command": "move",
            "args": {"instrument": "pipette", "position": "plate_1.A1"},
        },
        {"command": "home", "args": {}},
    ]


def test_save_protocol(client, tmp_configs):
    body = {
        "positions": {"park": [10.0, 20.0, 30.0]},
        "protocol": [
            {"command": "move", "args": {"instrument": "uvvis", "position": "plate_1.A1"}},
        ]
    }
    r = api_request(client, "PUT", "/api/protocol/new_protocol.yaml", json=body)
    assert r.status_code == 200
    assert (tmp_configs / "new_protocol.yaml").exists()
    assert read_yaml(tmp_configs / "new_protocol.yaml")["positions"] == body["positions"]


def test_save_protocol_omits_positions_and_writes_empty_args_as_null(client, tmp_configs):
    body = {
        "protocol": [
            {"command": "home", "args": {}},
        ]
    }

    r = api_request(client, "PUT", "/api/protocol/home.yaml", json=body)

    assert r.status_code == 200
    assert read_yaml(tmp_configs / "home.yaml") == {"protocol": [{"home": None}]}


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


def test_validate_setup_endpoint_reports_unexpected_validation_failure(monkeypatch, tmp_path):
    from zoo.routers import protocol as protocol_router

    for subdir in ("gantry", "deck", "protocol"):
        (tmp_path / subdir).mkdir()

    monkeypatch.setattr(
        protocol_router,
        "run_setup_validation",
        lambda *_args: (_ for _ in ()).throw(RuntimeError("validator crashed")),
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

    assert response.status_code == 500
    assert "validator crashed" in response.text


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

    # Minimal viable path resolution: create the YAMLs /run checks
    # for so path validation doesn't 404 us before the lock work.
    with tempfile.TemporaryDirectory() as d:
        import pathlib
        from zoo.services.yaml_io import write_yaml as wy
        d_path = pathlib.Path(d)
        for sub in ("gantry", "deck", "protocol"):
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
                "protocol_file": "test.yaml",
            },
        )

    assert response.status_code == 200
    assert ("is_healthy_lock_held", True) in observations
    assert ("run_lock_held", True) in observations
    # Lock released after the endpoint returns — no leak.
    assert gantry_router._serial_lock.locked() is False


def test_run_endpoint_blocks_active_calibration_warning(monkeypatch, tmp_path):
    from unittest.mock import MagicMock

    from zoo.routers import gantry as gantry_router
    from zoo.routers import protocol as protocol_router

    for subdir in ("gantry", "deck", "protocol"):
        (tmp_path / subdir).mkdir()

    mock_gantry = MagicMock()
    monkeypatch.setattr(gantry_router, "_gantry", mock_gantry)
    monkeypatch.setattr(
        gantry_router,
        "_calibration_warning",
        "Calibration needed: $20 expected 1, got 0",
    )
    monkeypatch.setattr(
        protocol_router,
        "get_settings",
        lambda: type("S", (), {"configs_dir": tmp_path})(),
    )
    monkeypatch.setattr(
        protocol_router,
        "run_protocol",
        lambda *_args, **_kwargs: pytest.fail("run_protocol should be blocked"),
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
    mock_gantry.is_healthy.assert_not_called()


def test_run_endpoint_requires_connected_gantry(monkeypatch, tmp_path):
    from zoo.routers import gantry as gantry_router
    from zoo.routers import protocol as protocol_router

    monkeypatch.setattr(gantry_router, "_gantry", None)
    monkeypatch.setattr(
        protocol_router,
        "get_settings",
        lambda: type("S", (), {"configs_dir": tmp_path})(),
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


def test_run_endpoint_rejects_unhealthy_connected_gantry(monkeypatch, tmp_path):
    from unittest.mock import MagicMock

    from zoo.routers import gantry as gantry_router
    from zoo.routers import protocol as protocol_router

    mock_gantry = MagicMock()
    mock_gantry.is_healthy.return_value = False
    monkeypatch.setattr(gantry_router, "_gantry", mock_gantry)
    monkeypatch.setattr(gantry_router, "_calibration_warning", None)
    monkeypatch.setattr(
        protocol_router,
        "get_settings",
        lambda: type("S", (), {"configs_dir": tmp_path})(),
    )
    monkeypatch.setattr(
        protocol_router,
        "run_protocol",
        lambda *_args, **_kwargs: pytest.fail("run_protocol should not run"),
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


def test_run_endpoint_returns_setup_validation_errors(monkeypatch, tmp_path):
    from unittest.mock import MagicMock

    from zoo.routers import gantry as gantry_router
    from zoo.routers import protocol as protocol_router

    class FakeSetupValidationError(Exception):
        pass

    mock_gantry = MagicMock()
    mock_gantry.is_healthy.return_value = True
    monkeypatch.setattr(gantry_router, "_gantry", mock_gantry)
    monkeypatch.setattr(gantry_router, "_calibration_warning", None)
    monkeypatch.setattr(protocol_router, "SetupValidationError", FakeSetupValidationError)
    monkeypatch.setattr(
        protocol_router,
        "get_settings",
        lambda: type("S", (), {"configs_dir": tmp_path})(),
    )
    monkeypatch.setattr(
        protocol_router,
        "run_protocol",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(FakeSetupValidationError("bad setup")),
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
    assert "bad setup" in response.text


def test_run_endpoint_reports_unexpected_execution_failure(monkeypatch, tmp_path):
    from unittest.mock import MagicMock

    from zoo.routers import gantry as gantry_router
    from zoo.routers import protocol as protocol_router

    mock_gantry = MagicMock()
    mock_gantry.is_healthy.return_value = True
    monkeypatch.setattr(gantry_router, "_gantry", mock_gantry)
    monkeypatch.setattr(gantry_router, "_calibration_warning", None)
    monkeypatch.setattr(
        protocol_router,
        "get_settings",
        lambda: type("S", (), {"configs_dir": tmp_path})(),
    )
    monkeypatch.setattr(
        protocol_router,
        "run_protocol",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(RuntimeError("boom")),
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

    assert response.status_code == 500
    assert "Execution failed: boom" in response.text
