"""Test gantry API endpoints delegate to CubOS ``Gantry`` methods."""

from unittest.mock import MagicMock

import pytest

from tests.api_client import api_request
from zoo.app import create_app
from zoo.routers import gantry as gantry_router


@pytest.fixture(autouse=True)
def reset_gantry_router_state(monkeypatch):
    monkeypatch.setattr(gantry_router, "_gantry", None)
    monkeypatch.setattr(gantry_router, "_calibration_warning", None)
    yield


def test_home_endpoint_delegates_to_gantry_home(monkeypatch):
    """POST /api/gantry/home must call Gantry.home(), not hardcode home_xy.

    Regression: router previously invoked `_gantry.home_xy()` unconditionally,
    which ignored the `cnc.homing_strategy` set via the Zoo UI (e.g. a YAML
    with `homing_strategy: standard` still ran XY-only homing).
    Dispatch on strategy lives inside CubOS's `Gantry.home()`.
    """
    mock_gantry = MagicMock()
    mock_gantry.get_position_info.return_value = {
        "coords": {"x": 0.0, "y": 0.0, "z": 0.0},
        "work_pos": {"x": 0.0, "y": 0.0, "z": 0.0},
        "status": "Idle",
    }
    monkeypatch.setattr(gantry_router, "_gantry", mock_gantry)

    response = api_request(create_app(), "POST", "/api/gantry/home")

    assert response.status_code == 200
    mock_gantry.home.assert_called_once()
    assert not mock_gantry.home_xy.called


def test_home_endpoint_returns_400_when_not_connected(monkeypatch):
    monkeypatch.setattr(gantry_router, "_gantry", None)

    response = api_request(create_app(), "POST", "/api/gantry/home")

    assert response.status_code == 400


def test_connect_holds_serial_lock_and_defers_gantry_publication(monkeypatch):
    """Regression: /connect previously set ``_gantry`` before ``connect()``
    finished, so /position polls running every 200 ms would hit the
    half-initialized mill concurrently with /connect's own serial
    chatter (``G90`` enforcement, WCO seeding). One real-hardware log
    showed the race: ``G90`` read returned empty → ``_enforce_wpos_mode``
    warned → ``_seed_wco`` timed out → ``current_coordinates`` raised →
    ``_gantry = None`` → UI showed "Not connected" with no way to
    recover except another Connect click.

    This test pins two parts of the fix:
      1. ``_serial_lock`` is held across the full connect sequence so
         concurrent polls fall through to the cached path.
      2. The module-level ``_gantry`` stays ``None`` until connect
         succeeds, so overlapping polls see a clean "Not connected"
         instead of racing on a half-built Gantry.
    """
    from gantry import Gantry

    observations = []

    def fake_connect(self):
        # Assert the lock is held while we're chattering on serial.
        observations.append(("lock_held", gantry_router._serial_lock.locked()))
        # Assert the module-level _gantry is still None — /connect must
        # not publish us until we've fully connected.
        observations.append(("module_gantry_is_none", gantry_router._gantry is None))

    def fake_get_position_info(self):
        return {
            "coords": {"x": 0.0, "y": 0.0, "z": 0.0},
            "work_pos": {"x": 0.0, "y": 0.0, "z": 0.0},
            "status": "Idle",
        }

    monkeypatch.setattr(Gantry, "connect", fake_connect)
    monkeypatch.setattr(Gantry, "get_position_info", fake_get_position_info)
    monkeypatch.setattr(gantry_router, "_gantry", None)

    response = api_request(create_app(), "POST", "/api/gantry/connect")

    assert response.status_code == 200
    assert ("lock_held", True) in observations
    assert ("module_gantry_is_none", True) in observations
    # After connect succeeds, the module global should be set.
    assert gantry_router._gantry is not None


def test_connect_failure_keeps_module_gantry_none_and_releases_lock(monkeypatch):
    """If ``Gantry.connect()`` raises, the staged instance must not be
    published and the serial lock must be released. The old outer
    ``except Exception: _gantry = None`` wrote over a previously
    successful connection on any transient error (bad config YAML,
    FileNotFoundError); the staging pattern should leave the prior
    module global untouched — but only if the failure path is pinned.
    """
    from gantry import Gantry

    class BoomError(RuntimeError):
        pass

    def fake_connect(self):
        raise BoomError("simulated serial failure")

    monkeypatch.setattr(Gantry, "connect", fake_connect)
    # Put a sentinel in _gantry so we can confirm failure doesn't nuke it.
    sentinel = object()
    monkeypatch.setattr(gantry_router, "_gantry", sentinel)

    response = api_request(create_app(), "POST", "/api/gantry/connect")

    assert response.status_code == 500
    # Staging means a failed reconnect leaves the prior connection alone.
    assert gantry_router._gantry is sentinel
    # The lock must be released even though an exception escaped.
    assert gantry_router._serial_lock.locked() is False


def test_connect_uses_selected_gantry_config(monkeypatch, tmp_path):
    """Connect must honor the UI-selected gantry YAML, not the first file."""
    from zoo.config import get_settings
    from zoo.services.yaml_io import write_yaml

    config_dir = tmp_path / "configs"
    gantry_dir = config_dir / "gantry"
    gantry_dir.mkdir(parents=True)

    base = {
        "cnc": {"homing_strategy": "standard", "total_z_height": 80.0},
        "working_volume": {
            "x_min": 0.0,
            "x_max": 300.0,
            "y_min": 0.0,
            "y_max": 200.0,
            "z_min": 0.0,
            "z_max": 80.0,
        },
        "instruments": {},
    }
    write_yaml(gantry_dir / "aaa_first.yaml", {"serial_port": "/dev/wrong", **base})
    write_yaml(gantry_dir / "selected.yaml", {"serial_port": "/dev/right", **base})
    monkeypatch.setattr(get_settings(), "config_dir", config_dir)

    observed_configs = []

    class FakeGantry:
        def __init__(self, config=None):
            observed_configs.append(config)

        def connect(self):
            return None

        def get_position_info(self):
            return {
                "coords": {"x": 0.0, "y": 0.0, "z": 0.0},
                "work_pos": {"x": 0.0, "y": 0.0, "z": 0.0},
                "status": "Idle",
            }

    monkeypatch.setattr(gantry_router, "Gantry", FakeGantry)
    monkeypatch.setattr(gantry_router, "_gantry", None)

    response = api_request(
        create_app(),
        "POST",
        "/api/gantry/connect",
        json={"filename": "selected.yaml"},
    )

    assert response.status_code == 200
    assert observed_configs[0]["serial_port"] == "/dev/right"


def test_connect_warns_but_does_not_fail_on_grbl_setting_mismatch(monkeypatch, tmp_path):
    """GRBL-setting drift should connect and tell the operator to recalibrate."""
    from zoo.config import get_settings
    from zoo.services.yaml_io import write_yaml

    config_dir = tmp_path / "configs"
    gantry_dir = config_dir / "gantry"
    gantry_dir.mkdir(parents=True)
    write_yaml(
        gantry_dir / "sterling.yaml",
        {
            "serial_port": "/dev/ttyUSB0",
            "cnc": {
                "homing_strategy": "standard",
                "total_z_height": 115.0,
                "structure_clearance_z": 115.0,
            },
            "working_volume": {
                "x_min": 0.0,
                "x_max": 306.0,
                "y_min": 0.0,
                "y_max": 300.0,
                "z_min": 0.0,
                "z_max": 115.0,
            },
            "grbl_settings": {
                "soft_limits": True,
                "max_travel_x": 306.0,
                "max_travel_y": 300.0,
                "max_travel_z": 115.0,
            },
            "instruments": {},
        },
    )
    monkeypatch.setattr(get_settings(), "config_dir", config_dir)

    observed_configs = []

    class FakeGantry:
        def __init__(self, config=None):
            observed_configs.append(config)

        def connect(self):
            return None

        def read_grbl_settings(self):
            return {
                "$20": "0",
                "$130": "393",
                "$131": "293",
                "$132": "108",
            }

        def get_position_info(self):
            return {
                "coords": {"x": 0.0, "y": 0.0, "z": 0.0},
                "work_pos": {"x": 0.0, "y": 0.0, "z": 0.0},
                "status": "Idle",
            }

    monkeypatch.setattr(gantry_router, "Gantry", FakeGantry)

    response = api_request(
        create_app(),
        "POST",
        "/api/gantry/connect",
        json={"filename": "sterling.yaml"},
    )

    assert response.status_code == 200
    body = response.json()
    assert body["connected"] is True
    assert "Calibration needed" in body["calibration_warning"]
    assert "$20: expected 1" in body["calibration_warning"]
    assert "$130: expected 306" in body["calibration_warning"]
    assert "grbl_settings" not in observed_configs[0]


def test_get_gantry_normalizes_legacy_config_for_editing(monkeypatch, tmp_path):
    """Older Zoo gantry YAMLs should load into CubOS staging's required shape."""
    from zoo.config import get_settings
    from zoo.services.yaml_io import write_yaml

    config_dir = tmp_path / "configs"
    gantry_dir = config_dir / "gantry"
    gantry_dir.mkdir(parents=True)
    write_yaml(
        gantry_dir / "legacy.yaml",
        {
            "serial_port": "",
            "cnc": {},
            "working_volume": {
                "x_min": 0.0,
                "x_max": 300.0,
                "y_min": 0.0,
                "y_max": 200.0,
                "z_min": 0.0,
                "z_max": 80.0,
            },
        },
    )
    monkeypatch.setattr(get_settings(), "config_dir", config_dir)

    response = api_request(create_app(), "GET", "/api/gantry/legacy.yaml")

    assert response.status_code == 200
    config = response.json()["config"]
    assert config["cnc"]["homing_strategy"] == "standard"
    assert config["cnc"]["total_z_height"] == 80.0
    assert config["cnc"]["structure_clearance_z"] == 80.0
    assert config["instruments"] == {}


def test_gantry_exposes_instrument_registry_endpoints():
    response = api_request(create_app(), "GET", "/api/gantry/instrument-types")

    assert response.status_code == 200
    types = {entry["type"]: entry for entry in response.json()}
    assert "asmi" in types
    assert "vernier" in types["asmi"]["vendors"]


def test_disconnect_clears_module_gantry_inside_lock(monkeypatch):
    """/disconnect must null ``_gantry`` while still holding the lock so a
    concurrent /position poll can't observe a mill object that's
    mid-disconnect. Regression guard for the mirror-race of the /connect
    staging fix.
    """
    observations = []
    mock_gantry = MagicMock()

    def observe_disconnect():
        observations.append(("lock_held", gantry_router._serial_lock.locked()))
        observations.append(("module_gantry_still_set", gantry_router._gantry is mock_gantry))

    mock_gantry.disconnect.side_effect = observe_disconnect
    monkeypatch.setattr(gantry_router, "_gantry", mock_gantry)

    response = api_request(create_app(), "POST", "/api/gantry/disconnect")

    assert response.status_code == 200
    assert ("lock_held", True) in observations
    # Inside disconnect(), _gantry is still the mock — we clear it only
    # after disconnect returns, which is the point at which any newly
    # arriving /position poll is guaranteed to see the clean None state.
    assert ("module_gantry_still_set", True) in observations
    assert gantry_router._gantry is None
    assert gantry_router._serial_lock.locked() is False
