"""Test gantry API endpoints delegate to CubOS ``Gantry`` methods."""

from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest

from gantry.gantry_driver.exceptions import StatusReturnError
from gantry.limit_recovery import LimitRecoveryResult
from backend.tests.api_client import api_request
from zoo.app import create_app
from zoo.routers import gantry as gantry_router


def idle_position_info(x=0.0, y=0.0, z=0.0):
    return {
        "coords": {"x": x, "y": y, "z": z},
        "work_pos": {"x": x, "y": y, "z": z},
        "status": "Idle",
    }


def configure_joggable_gantry(mock_gantry, *, x=10.0, y=10.0, z=40.0):
    mock_gantry.config = {
        "working_volume": {
            "x_min": 0.0,
            "x_max": 300.0,
            "y_min": 0.0,
            "y_max": 200.0,
            "z_min": 0.0,
            "z_max": 80.0,
        }
    }
    mock_gantry.get_position_info.return_value = idle_position_info(x=x, y=y, z=z)
    return mock_gantry


@pytest.fixture(autouse=True)
def reset_gantry_router_state(monkeypatch):
    monkeypatch.setattr(gantry_router, "_gantry", None)
    monkeypatch.setattr(gantry_router, "_calibration_warning", None)
    monkeypatch.setattr(gantry_router, "_connected_gantry_config", None)
    monkeypatch.setattr(gantry_router, "_connected_gantry_filename", None)
    monkeypatch.setattr(gantry_router, "_calibration_restore_soft_limits", False)
    monkeypatch.setattr(gantry_router, "_calibration_jog_bypass_working_volume", False)
    monkeypatch.setattr(gantry_router, "_last_position", None)
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
    observations = []

    class FakeGantry:
        def __init__(self, config=None):
            self.config = config

        def connect(self):
            # Assert the lock is held while we're chattering on serial.
            observations.append(("lock_held", gantry_router._serial_lock.locked()))
            # Assert the module-level _gantry is still None — /connect must
            # not publish us until we've fully connected.
            observations.append(("module_gantry_is_none", gantry_router._gantry is None))

        def get_position_info(self):
            return {
                "coords": {"x": 0.0, "y": 0.0, "z": 0.0},
                "work_pos": {"x": 0.0, "y": 0.0, "z": 0.0},
                "status": "Idle",
            }

    monkeypatch.setattr(gantry_router, "Gantry", FakeGantry)
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


def test_position_surfaces_alarm_readback_errors_with_cached_coordinates(monkeypatch):
    mock_gantry = MagicMock()
    mock_gantry.get_position_info.side_effect = RuntimeError("Error in status: ALARM:1")
    monkeypatch.setattr(gantry_router, "_gantry", mock_gantry)
    monkeypatch.setattr(
        gantry_router,
        "_last_position",
        gantry_router.GantryPosition(
            x=10.0,
            y=20.0,
            z=30.0,
            work_x=10.0,
            work_y=20.0,
            work_z=30.0,
            status="Idle",
            connected=True,
        ),
    )

    response = api_request(create_app(), "GET", "/api/gantry/position")

    assert response.status_code == 200
    body = response.json()
    assert body["connected"] is True
    assert body["status"] == "ALARM:1"
    assert body["work_z"] == 30.0


def test_position_surfaces_alarm_readback_errors_without_cached_coordinates(monkeypatch):
    mock_gantry = MagicMock()
    mock_gantry.get_position_info.side_effect = RuntimeError("Error in status: ALARM:1")
    monkeypatch.setattr(gantry_router, "_gantry", mock_gantry)

    response = api_request(create_app(), "GET", "/api/gantry/position")

    assert response.status_code == 200
    body = response.json()
    assert body["connected"] is True
    assert body["status"] == "ALARM:1"


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
    assert config["cnc"]["factory_z_travel_mm"] == 80.0
    if "total_z_range" in gantry_router._cnc_schema_fields():
        assert config["cnc"]["total_z_range"] == 80.0
    assert config["gantry_type"] == "cub"
    assert config["instruments"] == {}

def test_get_gantry_preserves_factory_z_travel_for_offset_z_bounds(monkeypatch, tmp_path):
    from zoo.config import get_settings
    from zoo.services.yaml_io import write_yaml

    config_dir = tmp_path / "configs"
    gantry_dir = config_dir / "gantry"
    gantry_dir.mkdir(parents=True)
    write_yaml(
        gantry_dir / "scenario-b.yaml",
        {
            "serial_port": "",
            "gantry_type": "cub_xl",
            "cnc": {
                "homing_strategy": "standard",
                "factory_z_travel_mm": 110.0,
                "calibration_block_height_mm": 35.0,
            },
            "working_volume": {
                "x_min": 0.0,
                "x_max": 300.0,
                "y_min": 0.0,
                "y_max": 200.0,
                "z_min": 25.0,
                "z_max": 135.0,
            },
        },
    )
    monkeypatch.setattr(get_settings(), "config_dir", config_dir)

    response = api_request(create_app(), "GET", "/api/gantry/scenario-b.yaml")

    assert response.status_code == 200
    config = response.json()["config"]
    assert config["cnc"]["factory_z_travel_mm"] == 110.0
    assert config["cnc"]["calibration_block_height_mm"] == 35.0
    if "total_z_range" in gantry_router._cnc_schema_fields():
        assert config["cnc"]["total_z_range"] == 135.0
    assert config["working_volume"]["z_max"] == 135.0


def test_get_gantry_returns_400_for_invalid_yaml(monkeypatch, tmp_path):
    from zoo.config import get_settings

    config_dir = tmp_path / "configs"
    gantry_dir = config_dir / "gantry"
    gantry_dir.mkdir(parents=True)
    (gantry_dir / "broken.yaml").write_text("serial_port: [\n", encoding="utf-8")
    monkeypatch.setattr(get_settings(), "config_dir", config_dir)

    response = api_request(create_app(), "GET", "/api/gantry/broken.yaml")

    assert response.status_code == 400
    assert "Invalid YAML" in response.text


def test_connect_returns_400_for_invalid_selected_yaml(monkeypatch, tmp_path):
    from zoo.config import get_settings

    config_dir = tmp_path / "configs"
    gantry_dir = config_dir / "gantry"
    gantry_dir.mkdir(parents=True)
    (gantry_dir / "broken.yaml").write_text("serial_port: [\n", encoding="utf-8")
    monkeypatch.setattr(get_settings(), "config_dir", config_dir)

    response = api_request(
        create_app(),
        "POST",
        "/api/gantry/connect",
        json={"filename": "broken.yaml"},
    )

    assert response.status_code == 400
    assert "Invalid gantry config" in response.text


def test_position_query_failure_returns_cached_position(monkeypatch):
    from zoo.models.gantry import GantryPosition

    mock_gantry = MagicMock()
    mock_gantry.get_position_info.side_effect = RuntimeError("serial read failed")
    monkeypatch.setattr(gantry_router, "_gantry", mock_gantry)
    cached = GantryPosition(x=1, y=2, z=3, connected=True, status="Idle")
    monkeypatch.setattr(gantry_router, "_last_position", cached)
    monkeypatch.setattr(gantry_router, "_calibration_warning", "stale warning")
    monkeypatch.setattr(gantry_router, "_calibration_restore_soft_limits", True)

    response = api_request(create_app(), "GET", "/api/gantry/position")

    assert response.status_code == 200
    assert response.json()["connected"] is True
    assert response.json()["status"] == "Idle"
    assert response.json()["x"] == 1
    assert gantry_router._gantry is mock_gantry
    assert gantry_router._last_position is cached
    assert gantry_router._calibration_warning == "stale warning"
    assert gantry_router._calibration_restore_soft_limits is True


def test_move_to_blocking_allows_targets_inside_working_volume(monkeypatch):
    mock_gantry = MagicMock()
    mock_gantry.config = {
        "working_volume": {
            "x_min": 0.0,
            "x_max": 300.0,
            "y_min": 0.0,
            "y_max": 200.0,
            "z_min": 0.0,
            "z_max": 80.0,
        }
    }
    mock_gantry.get_position_info.return_value = idle_position_info(
        x=150.0, y=100.0, z=40.0,
    )
    monkeypatch.setattr(gantry_router, "_gantry", mock_gantry)

    response = api_request(
        create_app(),
        "POST",
        "/api/gantry/move-to-blocking",
        json={"x": 150, "y": 100, "z": 40},
    )

    assert response.status_code == 200
    mock_gantry.move_to.assert_called_once_with(x=150.0, y=100.0, z=40.0)


def test_move_to_rejects_targets_outside_working_volume(monkeypatch):
    mock_gantry = MagicMock()
    mock_gantry.config = {
        "working_volume": {
            "x_min": 0.0,
            "x_max": 300.0,
            "y_min": 0.0,
            "y_max": 200.0,
            "z_min": 0.0,
            "z_max": 80.0,
        }
    }
    monkeypatch.setattr(gantry_router, "_gantry", mock_gantry)

    response = api_request(
        create_app(),
        "POST",
        "/api/gantry/move-to",
        json={"x": 301, "y": 100, "z": 40},
    )

    assert response.status_code == 400
    assert "outside configured gantry working volume" in response.text
    mock_gantry.move_to.assert_not_called()


def test_move_to_blocking_rejects_targets_outside_working_volume(monkeypatch):
    mock_gantry = MagicMock()
    mock_gantry.config = {
        "working_volume": {
            "x_min": 0.0,
            "x_max": 300.0,
            "y_min": 0.0,
            "y_max": 200.0,
            "z_min": 0.0,
            "z_max": 80.0,
        }
    }
    monkeypatch.setattr(gantry_router, "_gantry", mock_gantry)

    response = api_request(
        create_app(),
        "POST",
        "/api/gantry/move-to-blocking",
        json={"x": 301, "y": 100, "z": 40},
    )

    assert response.status_code == 400
    assert "outside configured gantry working volume" in response.text
    mock_gantry.move_to.assert_not_called()


def test_move_to_requires_loaded_working_volume(monkeypatch):
    mock_gantry = MagicMock()
    mock_gantry.config = {}
    monkeypatch.setattr(gantry_router, "_gantry", mock_gantry)

    response = api_request(
        create_app(),
        "POST",
        "/api/gantry/move-to-blocking",
        json={"x": 10, "y": 10, "z": 10},
    )

    assert response.status_code == 409
    assert "working_volume" in response.text
    mock_gantry.move_to.assert_not_called()


def test_set_work_coordinates_delegates_to_gantry(monkeypatch):
    mock_gantry = MagicMock()
    mock_gantry.get_position_info.return_value = {
        "coords": {"x": 0.0, "y": 0.0, "z": 10.0},
        "work_pos": {"x": 0.0, "y": 0.0, "z": 10.0},
        "status": "Idle",
    }
    monkeypatch.setattr(gantry_router, "_gantry", mock_gantry)

    response = api_request(
        create_app(),
        "POST",
        "/api/gantry/work-coordinates",
        json={"x": 0, "y": 0, "z": 10},
    )

    assert response.status_code == 200
    mock_gantry.set_work_coordinates.assert_called_once_with(x=0.0, y=0.0, z=10.0)


def test_configure_soft_limits_delegates_to_gantry(monkeypatch):
    mock_gantry = MagicMock()
    monkeypatch.setattr(gantry_router, "_gantry", mock_gantry)
    monkeypatch.setattr(gantry_router, "_calibration_restore_soft_limits", True)
    monkeypatch.setattr(gantry_router, "_calibration_jog_bypass_working_volume", True)

    response = api_request(
        create_app(),
        "POST",
        "/api/gantry/soft-limits",
        json={
            "max_travel_x": 300,
            "max_travel_y": 200,
            "max_travel_z": 80,
            "status_report": 0,
            "homing_pull_off": 10,
            "tolerance_mm": 0.1,
        },
    )

    assert response.status_code == 200
    mock_gantry.configure_soft_limits_from_spans.assert_called_once_with(
        max_travel_x=300.0,
        max_travel_y=200.0,
        max_travel_z=80.0,
        status_report=0.0,
        homing_pull_off=10.0,
        hard_limits=None,
        tolerance_mm=0.1,
    )
    assert gantry_router._calibration_restore_soft_limits is False
    assert gantry_router._calibration_jog_bypass_working_volume is False


def test_configure_soft_limits_refreshes_calibration_warning(monkeypatch):
    mock_gantry = MagicMock()
    mock_gantry.read_grbl_settings.return_value = {
        "$10": "0",
        "$20": "1",
        "$21": "1",
        "$22": "1",
        "$27": "10",
        "$130": "300",
        "$131": "200",
        "$132": "80",
    }
    monkeypatch.setattr(gantry_router, "_gantry", mock_gantry)
    monkeypatch.setattr(
        gantry_router,
        "_calibration_warning",
        "Calibration needed: $20 expected 1, got 0",
    )
    monkeypatch.setattr(
        gantry_router,
        "_connected_gantry_config",
        {
            "grbl_settings": {
                "status_report": 0.0,
                "homing_pull_off": 10.0,
                "soft_limits": True,
                "hard_limits": True,
                "homing_enable": True,
                "max_travel_x": 300.0,
                "max_travel_y": 200.0,
                "max_travel_z": 80.0,
            }
        },
    )

    response = api_request(
        create_app(),
        "POST",
        "/api/gantry/soft-limits",
        json={
            "max_travel_x": 300,
            "max_travel_y": 200,
            "max_travel_z": 80,
            "tolerance_mm": 0.1,
        },
    )

    assert response.status_code == 200
    mock_gantry.configure_soft_limits_from_spans.assert_called_once_with(
        max_travel_x=300.0,
        max_travel_y=200.0,
        max_travel_z=80.0,
        status_report=None,
        homing_pull_off=None,
        hard_limits=True,
        tolerance_mm=0.1,
    )
    assert gantry_router._calibration_warning is None


def test_prepare_calibration_origin_homes_clears_offsets_and_disables_soft_limits(monkeypatch):
    calls = []
    mock_gantry = MagicMock()
    mock_gantry.soft_limits_enabled.return_value = True
    mock_gantry.get_position_info.return_value = idle_position_info()
    for method_name in (
        "home",
        "enforce_work_position_reporting",
        "clear_g92_offsets",
    ):
        getattr(mock_gantry, method_name).side_effect = lambda name=method_name: calls.append(name)
    mock_gantry.activate_work_coordinate_system.side_effect = (
        lambda system: calls.append(("activate_work_coordinate_system", system))
    )
    mock_gantry.set_soft_limits_enabled.side_effect = (
        lambda enabled: calls.append(("set_soft_limits_enabled", enabled))
    )
    mock_gantry.set_grbl_setting.side_effect = (
        lambda setting, value: calls.append(("set_grbl_setting", setting, value))
    )
    monkeypatch.setattr(gantry_router, "_gantry", mock_gantry)
    monkeypatch.setattr(
        gantry_router,
        "_connected_gantry_config",
        {"grbl_settings": {"status_report": 1, "homing_pull_off": 10}},
    )

    response = api_request(create_app(), "POST", "/api/gantry/calibration/prepare-origin")

    assert response.status_code == 200
    assert calls == [
        ("set_grbl_setting", "$10", 0.0),
        ("set_grbl_setting", "$27", 10.0),
        "home",
        "enforce_work_position_reporting",
        ("activate_work_coordinate_system", "G54"),
        "clear_g92_offsets",
        ("set_soft_limits_enabled", False),
    ]
    assert gantry_router._calibration_restore_soft_limits is True
    assert gantry_router._calibration_jog_bypass_working_volume is True


def test_restore_calibration_soft_limits_only_when_zoo_disabled_them(monkeypatch):
    mock_gantry = MagicMock()
    mock_gantry.get_position_info.return_value = idle_position_info()
    monkeypatch.setattr(gantry_router, "_gantry", mock_gantry)
    monkeypatch.setattr(gantry_router, "_calibration_restore_soft_limits", True)
    monkeypatch.setattr(gantry_router, "_calibration_jog_bypass_working_volume", True)

    response = api_request(create_app(), "POST", "/api/gantry/calibration/restore-soft-limits")

    assert response.status_code == 200
    mock_gantry.set_soft_limits_enabled.assert_called_once_with(True)
    assert gantry_router._calibration_restore_soft_limits is False
    assert gantry_router._calibration_jog_bypass_working_volume is False


def test_finalize_origin_returns_controller_span_and_refreshes_connected_config(monkeypatch):
    mock_gantry = MagicMock()
    mock_gantry.finalize_deck_origin_calibration.return_value = {
        "measured_volume": {"x": 386.0, "y": 250.5, "z": 91.0},
        "z_calibration": {
            "block_height": 10.0,
            "total_z_range": 100.0,
            "home_z": 91.0,
            "block_touch_z": 10.0,
            "home_to_block_travel": 81.0,
            "remaining_below_block": 19.0,
            "can_reach_deck_bottom": True,
            "z_min": 0.0,
            "z_max": 91.0,
            "max_travel_z": 91.0,
        },
        "max_travel": {"x": 396.0, "y": 260.5, "z": 101.0},
        "homing_pull_off_mm": 10.0,
        "position": {"x": 386.0, "y": 250.5, "z": 91.0},
    }
    mock_gantry.read_grbl_settings.return_value = {
        "$20": "1",
        "$21": "1",
        "$22": "1",
        "$130": "396",
        "$131": "260.5",
        "$132": "101",
    }
    monkeypatch.setattr(gantry_router, "_gantry", mock_gantry)
    monkeypatch.setattr(
        gantry_router,
        "_connected_gantry_config",
        {
            "working_volume": {
                "x_min": 0.0,
                "x_max": 386.0,
                "y_min": 0.0,
                "y_max": 250.5,
                "z_min": 0.0,
                "z_max": 91.0,
            },
            "grbl_settings": {
                "status_report": 1,
                "homing_pull_off": 10,
                "hard_limits": True,
            },
        },
    )
    monkeypatch.setattr(gantry_router, "_calibration_restore_soft_limits", True)
    monkeypatch.setattr(gantry_router, "_calibration_jog_bypass_working_volume", True)

    response = api_request(
        create_app(),
        "POST",
        "/api/gantry/calibration/finalize-origin",
        json={
            "home_z": 91.0,
            "block_touch_z": 10.0,
            "block_height": 10.0,
            "factory_z_travel": 100.0,
        },
    )

    assert response.status_code == 200
    body = response.json()
    assert body["measured_volume"]["z"] == 91.0
    assert body["z_calibration"]["z_max"] == 91.0
    assert body["max_travel"]["z"] == 101.0
    assert body["homing_pull_off_mm"] == 10.0
    grbl_settings = gantry_router._connected_gantry_config["grbl_settings"]
    assert grbl_settings["max_travel_x"] == 396.0
    assert grbl_settings["max_travel_y"] == 260.5
    assert grbl_settings["max_travel_z"] == 101.0
    assert grbl_settings["status_report"] == 0
    assert grbl_settings["homing_pull_off"] == 10.0
    assert grbl_settings["hard_limits"] is True
    mock_gantry.finalize_deck_origin_calibration.assert_called_once_with(
        home_z=91.0,
        block_touch_z=10.0,
        block_height=10.0,
        total_z_range=100.0,
        status_report=0,
        homing_pull_off=10.0,
        hard_limits=True,
        tolerance_mm=0.25,
    )
    assert gantry_router._calibration_restore_soft_limits is False
    assert gantry_router._calibration_jog_bypass_working_volume is False


def test_calibration_home_and_center_homes_captures_bounds_and_moves_to_center(monkeypatch):
    mock_gantry = MagicMock()
    mock_gantry.get_coordinates.side_effect = [
        {"x": 300.0, "y": 200.0, "z": 80.0},
        {"x": 150.0, "y": 100.0, "z": 80.0},
    ]
    monkeypatch.setattr(gantry_router, "_gantry", mock_gantry)

    response = api_request(create_app(), "POST", "/api/gantry/calibration/home-and-center")

    assert response.status_code == 200
    assert response.json() == {
        "xy_bounds": {"x": 300.0, "y": 200.0, "z": 80.0},
        "position": {"x": 150.0, "y": 100.0, "z": 80.0},
    }
    mock_gantry.home.assert_called_once()
    mock_gantry.move_to.assert_called_once_with(150.0, 100.0, 80.0)


def test_blocking_jog_waits_for_idle_before_returning(monkeypatch):
    mock_gantry = configure_joggable_gantry(MagicMock())
    mock_gantry.get_status.side_effect = ["Run", "Idle"]
    monkeypatch.setattr(gantry_router, "_gantry", mock_gantry)
    monkeypatch.setattr(gantry_router.time, "sleep", lambda _seconds: None)

    response = api_request(
        create_app(),
        "POST",
        "/api/gantry/jog-blocking",
        json={"x": 0, "y": 0, "z": 15, "timeout_s": 1},
    )

    assert response.status_code == 200
    mock_gantry.jog.assert_called_once_with(x=0.0, y=0.0, z=15.0)
    assert mock_gantry.get_status.call_count == 2


def test_jog_rejects_targets_below_working_volume(monkeypatch):
    mock_gantry = configure_joggable_gantry(MagicMock(), z=1.0)
    monkeypatch.setattr(gantry_router, "_gantry", mock_gantry)

    response = api_request(
        create_app(),
        "POST",
        "/api/gantry/jog",
        json={"x": 0, "y": 0, "z": -2},
    )

    assert response.status_code == 400
    assert "outside configured gantry working volume" in response.text
    mock_gantry.jog.assert_not_called()


def test_blocking_jog_rejects_targets_above_working_volume(monkeypatch):
    mock_gantry = configure_joggable_gantry(MagicMock(), z=79.0)
    monkeypatch.setattr(gantry_router, "_gantry", mock_gantry)

    response = api_request(
        create_app(),
        "POST",
        "/api/gantry/jog-blocking",
        json={"x": 0, "y": 0, "z": 2, "timeout_s": 1},
    )

    assert response.status_code == 400
    assert "outside configured gantry working volume" in response.text
    mock_gantry.jog.assert_not_called()
    mock_gantry.get_status.assert_not_called()


def test_calibration_jog_bypasses_working_volume_guard(monkeypatch):
    mock_gantry = configure_joggable_gantry(MagicMock(), z=1.0)
    monkeypatch.setattr(gantry_router, "_gantry", mock_gantry)
    monkeypatch.setattr(
        gantry_router,
        "_calibration_jog_bypass_working_volume",
        True,
    )

    response = api_request(
        create_app(),
        "POST",
        "/api/gantry/jog",
        json={"x": 0, "y": 0, "z": -2},
    )

    assert response.status_code == 200
    mock_gantry.jog.assert_called_once_with(x=0.0, y=0.0, z=-2.0)


def test_blocking_jog_surfaces_alarm_status_as_recoverable(monkeypatch):
    mock_gantry = configure_joggable_gantry(MagicMock())
    mock_gantry.get_status.return_value = "Alarm"
    monkeypatch.setattr(gantry_router, "_gantry", mock_gantry)
    monkeypatch.setattr(gantry_router.time, "sleep", lambda _seconds: None)

    response = api_request(
        create_app(),
        "POST",
        "/api/gantry/jog-blocking",
        json={"x": 0, "y": 0, "z": 15, "timeout_s": 1},
    )

    assert response.status_code == 409
    assert "alarm state" in response.text
    mock_gantry.jog.assert_called_once_with(x=0.0, y=0.0, z=15.0)


def test_blocking_jog_surfaces_alarm_jog_errors_as_recoverable(monkeypatch):
    mock_gantry = configure_joggable_gantry(MagicMock())
    mock_gantry.jog.side_effect = RuntimeError("ALARM:1 hard limit")
    monkeypatch.setattr(gantry_router, "_gantry", mock_gantry)

    response = api_request(
        create_app(),
        "POST",
        "/api/gantry/jog-blocking",
        json={"x": 0, "y": 0, "z": 15, "timeout_s": 1},
    )

    assert response.status_code == 409
    assert "alarm state" in response.text
    mock_gantry.get_status.assert_not_called()


def test_jog_success_does_not_probe_status_or_run_recovery(monkeypatch):
    mock_gantry = configure_joggable_gantry(MagicMock())
    mock_gantry.get_status.side_effect = AssertionError("normal jog must stay fast")
    recover = MagicMock()
    monkeypatch.setattr(gantry_router, "_gantry", mock_gantry)
    monkeypatch.setattr(gantry_router, "recover_from_limit_alarm", recover)

    response = api_request(
        create_app(),
        "POST",
        "/api/gantry/jog",
        json={"x": 1, "y": 0, "z": 0},
    )

    assert response.status_code == 200
    mock_gantry.jog.assert_called_once_with(x=1.0, y=0.0, z=0.0)
    mock_gantry.get_status.assert_not_called()
    recover.assert_not_called()


def test_jog_surfaces_alarm_errors(monkeypatch):
    mock_gantry = configure_joggable_gantry(MagicMock())
    mock_gantry.jog.side_effect = RuntimeError("ALARM:1 hard limit")
    monkeypatch.setattr(gantry_router, "_gantry", mock_gantry)

    response = api_request(
        create_app(),
        "POST",
        "/api/gantry/jog",
        json={"x": 0, "y": 0, "z": -1},
    )

    assert response.status_code == 409
    assert "alarm" in response.text.lower()
    mock_gantry.jog.assert_called_once_with(x=0.0, y=0.0, z=-1.0)


def test_jog_surfaces_reset_to_continue_as_alarm_error(monkeypatch):
    mock_gantry = configure_joggable_gantry(MagicMock())
    mock_gantry.jog.side_effect = RuntimeError("error:9 Reset to continue")
    monkeypatch.setattr(gantry_router, "_gantry", mock_gantry)

    response = api_request(
        create_app(),
        "POST",
        "/api/gantry/jog",
        json={"x": 0, "y": 0, "z": -1},
    )

    assert response.status_code == 409
    assert "alarm" in response.text.lower()


def test_jog_surfaces_active_limit_pin_as_alarm_error(monkeypatch):
    mock_gantry = configure_joggable_gantry(MagicMock())
    mock_gantry.jog.side_effect = RuntimeError("<Idle|WPos:0,0,0|Pn:X>")
    monkeypatch.setattr(gantry_router, "_gantry", mock_gantry)

    response = api_request(
        create_app(),
        "POST",
        "/api/gantry/jog",
        json={"x": 1, "y": 0, "z": 0},
    )

    assert response.status_code == 409
    assert "alarm" in response.text.lower()


def test_jog_returns_500_for_non_alarm_hardware_errors(monkeypatch):
    mock_gantry = configure_joggable_gantry(MagicMock())
    mock_gantry.jog.side_effect = RuntimeError("serial port timed out")
    monkeypatch.setattr(gantry_router, "_gantry", mock_gantry)

    response = api_request(
        create_app(),
        "POST",
        "/api/gantry/jog",
        json={"x": 1, "y": 0, "z": 0},
    )

    assert response.status_code == 500


def test_calibration_limit_recovery_delegates_to_cubos_under_serial_lock(monkeypatch):
    mock_gantry = MagicMock()
    observations = []

    def fake_recover(gantry, delta, *, pull_off_mm, feed_rate, output):
        observations.append(("gantry", gantry))
        observations.append(("delta", delta))
        observations.append(("pull_off_mm", pull_off_mm))
        observations.append(("feed_rate", feed_rate))
        observations.append(("lock_held", gantry_router._serial_lock.locked()))
        output("recovered by CubOS")
        return LimitRecoveryResult(
            failed_delta={"x": 0.0, "y": 0.0, "z": -1.0},
            pull_off_delta={"x": 0.0, "y": 0.0, "z": 5.0},
            attempts=2,
            final_status="Idle",
        )

    monkeypatch.setattr(gantry_router, "_gantry", mock_gantry)
    monkeypatch.setattr(gantry_router, "recover_from_limit_alarm", fake_recover)

    response = api_request(
        create_app(),
        "POST",
        "/api/gantry/calibration/recover-limit",
        json={"x": 0, "y": 0, "z": -1, "pull_off_mm": 3, "feed_rate": 900},
    )

    assert response.status_code == 200
    assert response.json() == {
        "status": "recovered",
        "attempts": 2,
        "pull_off": {"x": 0.0, "y": 0.0, "z": 5.0},
        "messages": ["recovered by CubOS"],
    }
    assert ("gantry", mock_gantry) in observations
    assert ("delta", {"x": 0.0, "y": 0.0, "z": -1.0}) in observations
    assert ("pull_off_mm", 3.0) in observations
    assert ("feed_rate", 900.0) in observations
    assert ("lock_held", True) in observations


def test_calibration_limit_recovery_requires_failed_delta(monkeypatch):
    mock_gantry = MagicMock()
    recover = MagicMock()
    monkeypatch.setattr(gantry_router, "_gantry", mock_gantry)
    monkeypatch.setattr(gantry_router, "recover_from_limit_alarm", recover)

    response = api_request(
        create_app(),
        "POST",
        "/api/gantry/calibration/recover-limit",
        json={"x": 0, "y": 0, "z": 0},
    )

    assert response.status_code == 400
    recover.assert_not_called()


def test_calibration_limit_recovery_returns_409_when_cubos_cannot_verify_status(monkeypatch):
    mock_gantry = MagicMock()

    def fake_recover(*args, **kwargs):
        raise StatusReturnError(
            "Limit recovery could not verify the controller cleared the alarm "
            "after repeated status read failures."
        )

    monkeypatch.setattr(gantry_router, "_gantry", mock_gantry)
    monkeypatch.setattr(gantry_router, "recover_from_limit_alarm", fake_recover)

    response = api_request(
        create_app(),
        "POST",
        "/api/gantry/calibration/recover-limit",
        json={"x": 1, "y": 0, "z": 0},
    )

    assert response.status_code == 409
    assert "did not clear the gantry alarm" in response.text
    assert "could not verify" in response.text


def test_calibration_limit_recovery_returns_500_for_non_alarm_errors(monkeypatch):
    mock_gantry = MagicMock()

    def fake_recover(*args, **kwargs):
        raise RuntimeError("serial port timed out")

    monkeypatch.setattr(gantry_router, "_gantry", mock_gantry)
    monkeypatch.setattr(gantry_router, "recover_from_limit_alarm", fake_recover)

    response = api_request(
        create_app(),
        "POST",
        "/api/gantry/calibration/recover-limit",
        json={"x": 1, "y": 0, "z": 0},
    )

    assert response.status_code == 500
    assert "serial port timed out" in response.text


def test_prepare_calibration_origin_returns_400_for_non_numeric_homing_pull_off(monkeypatch):
    mock_gantry = MagicMock()
    mock_gantry.soft_limits_enabled.return_value = False
    mock_gantry.get_position_info.return_value = idle_position_info()
    monkeypatch.setattr(gantry_router, "_gantry", mock_gantry)
    monkeypatch.setattr(
        gantry_router,
        "_connected_gantry_config",
        {"grbl_settings": {"homing_pull_off": "not_a_number"}},
    )

    response = api_request(create_app(), "POST", "/api/gantry/calibration/prepare-origin")

    assert response.status_code == 400
    assert "homing_pull_off" in response.text
    mock_gantry.home.assert_not_called()


def test_prepare_calibration_origin_returns_400_for_negative_homing_pull_off(monkeypatch):
    mock_gantry = MagicMock()
    mock_gantry.soft_limits_enabled.return_value = False
    mock_gantry.get_position_info.return_value = idle_position_info()
    monkeypatch.setattr(gantry_router, "_gantry", mock_gantry)
    monkeypatch.setattr(
        gantry_router,
        "_connected_gantry_config",
        {"grbl_settings": {"homing_pull_off": -5.0}},
    )

    response = api_request(create_app(), "POST", "/api/gantry/calibration/prepare-origin")

    assert response.status_code == 400
    assert "non-negative" in response.text
    mock_gantry.home.assert_not_called()


def test_put_gantry_persists_calibration_block_height_mm(monkeypatch, tmp_path):
    from zoo.config import get_settings
    from zoo.services.yaml_io import write_yaml, read_yaml

    config_dir = tmp_path / "configs"
    gantry_dir = config_dir / "gantry"
    gantry_dir.mkdir(parents=True)
    write_yaml(
        gantry_dir / "test.yaml",
        {
            "serial_port": "",
            "gantry_type": "cub_xl",
            "cnc": {"homing_strategy": "standard", "factory_z_travel_mm": 110.0},
            "working_volume": {
                "x_min": 0.0, "x_max": 300.0,
                "y_min": 0.0, "y_max": 200.0,
                "z_min": 0.0, "z_max": 80.0,
            },
            "instruments": {},
        },
    )
    monkeypatch.setattr(get_settings(), "config_dir", config_dir)

    response = api_request(
        create_app(),
        "PUT",
        "/api/gantry/test.yaml",
        json={
            "serial_port": "",
            "gantry_type": "cub_xl",
            "cnc": {
                "homing_strategy": "standard",
                "factory_z_travel_mm": 110.0,
                "calibration_block_height_mm": 36.25,
            },
            "working_volume": {
                "x_min": 0.0, "x_max": 300.0,
                "y_min": 0.0, "y_max": 200.0,
                "z_min": 0.0, "z_max": 80.0,
            },
            "instruments": {},
        },
    )

    assert response.status_code == 200
    saved = read_yaml(gantry_dir / "test.yaml")
    assert saved["cnc"]["calibration_block_height_mm"] == 36.25
    assert response.json()["config"]["cnc"]["calibration_block_height_mm"] == 36.25


def test_unlock_delegates_to_gantry(monkeypatch):
    mock_gantry = MagicMock()
    mock_gantry.get_position_info.return_value = idle_position_info()
    monkeypatch.setattr(gantry_router, "_gantry", mock_gantry)

    response = api_request(create_app(), "POST", "/api/gantry/unlock")

    assert response.status_code == 200
    mock_gantry.unlock.assert_called_once()


def test_unlock_returns_400_when_not_connected(monkeypatch):
    monkeypatch.setattr(gantry_router, "_gantry", None)

    response = api_request(create_app(), "POST", "/api/gantry/unlock")

    assert response.status_code == 400


def test_unlock_returns_500_when_unlock_raises(monkeypatch):
    mock_gantry = MagicMock()
    mock_gantry.unlock.side_effect = RuntimeError("serial error")
    monkeypatch.setattr(gantry_router, "_gantry", mock_gantry)

    response = api_request(create_app(), "POST", "/api/gantry/unlock")

    assert response.status_code == 500


def test_reset_unlock_delegates_to_gantry(monkeypatch):
    mock_gantry = MagicMock()
    mock_gantry.get_position_info.return_value = idle_position_info()
    monkeypatch.setattr(gantry_router, "_gantry", mock_gantry)

    response = api_request(create_app(), "POST", "/api/gantry/reset-unlock")

    assert response.status_code == 200
    mock_gantry.reset_and_unlock.assert_called_once()


def test_feed_hold_delegates_to_gantry_stop(monkeypatch):
    mock_gantry = MagicMock()
    mock_gantry.get_position_info.return_value = idle_position_info()
    monkeypatch.setattr(gantry_router, "_gantry", mock_gantry)

    response = api_request(create_app(), "POST", "/api/gantry/feed-hold")

    assert response.status_code == 200
    mock_gantry.stop.assert_called_once()


def test_jog_cancel_delegates_to_gantry(monkeypatch):
    mock_gantry = MagicMock()
    mock_gantry.get_position_info.return_value = idle_position_info()
    monkeypatch.setattr(gantry_router, "_gantry", mock_gantry)

    response = api_request(create_app(), "POST", "/api/gantry/jog-cancel")

    assert response.status_code == 200
    mock_gantry.jog_cancel.assert_called_once()


def test_read_grbl_settings_delegates_to_gantry(monkeypatch):
    mock_gantry = MagicMock()
    mock_gantry.read_grbl_settings.return_value = {"$20": "1", "$130": "300.0"}
    monkeypatch.setattr(gantry_router, "_gantry", mock_gantry)

    response = api_request(create_app(), "GET", "/api/gantry/grbl-settings")

    assert response.status_code == 200
    assert response.json() == {"settings": {"$20": "1", "$130": "300.0"}}
    mock_gantry.read_grbl_settings.assert_called_once()


def test_set_grbl_setting_delegates_and_refreshes(monkeypatch):
    mock_gantry = MagicMock()
    mock_gantry.read_grbl_settings.return_value = {"$20": "0"}
    monkeypatch.setattr(gantry_router, "_gantry", mock_gantry)

    response = api_request(
        create_app(),
        "POST",
        "/api/gantry/grbl-settings",
        json={"setting": "$20", "value": "0"},
    )

    assert response.status_code == 200
    mock_gantry.set_grbl_setting.assert_called_once_with("$20", 0.0)
    assert response.json() == {"settings": {"$20": "0"}}


def test_set_grbl_setting_rejects_non_numeric_codes(monkeypatch):
    mock_gantry = MagicMock()
    monkeypatch.setattr(gantry_router, "_gantry", mock_gantry)

    response = api_request(
        create_app(),
        "POST",
        "/api/gantry/grbl-settings",
        json={"setting": "$X", "value": "1"},
    )

    assert response.status_code == 400
    mock_gantry.set_grbl_setting.assert_not_called()


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


def test_disconnect_reports_soft_limit_restore_failure(monkeypatch):
    mock_gantry = MagicMock()
    mock_gantry.set_soft_limits_enabled.side_effect = RuntimeError("serial error")
    monkeypatch.setattr(gantry_router, "_gantry", mock_gantry)
    monkeypatch.setattr(gantry_router, "_calibration_restore_soft_limits", True)

    response = api_request(create_app(), "POST", "/api/gantry/disconnect")

    assert response.status_code == 500
    assert "Soft-limit restore failed" in response.text
    mock_gantry.disconnect.assert_called_once()
    assert gantry_router._gantry is None
    assert gantry_router._calibration_restore_soft_limits is False


def test_disconnect_reports_both_failures_when_restore_and_disconnect_fail(monkeypatch):
    mock_gantry = MagicMock()
    mock_gantry.set_soft_limits_enabled.side_effect = RuntimeError("restore error")
    mock_gantry.disconnect.side_effect = RuntimeError("port closed")
    monkeypatch.setattr(gantry_router, "_gantry", mock_gantry)
    monkeypatch.setattr(gantry_router, "_calibration_restore_soft_limits", True)

    response = api_request(create_app(), "POST", "/api/gantry/disconnect")

    assert response.status_code == 500
    assert "both failed" in response.text
    assert "restore error" in response.text
    assert "port closed" in response.text
    assert gantry_router._gantry is None
    assert gantry_router._calibration_restore_soft_limits is False


def test_gantry_helper_serialization_and_schema_introspection(monkeypatch):
    class FakeInstrument:
        def __init__(
            self,
            port: str,
            speed: float = 1.5,
            enabled: bool | None = None,
            metadata: dict | None = None,
            pipette_model: str = "p20_single",
        ):
            pass

    monkeypatch.setattr(gantry_router, "get_instrument_class", lambda _type: FakeInstrument)

    fields = gantry_router._build_instrument_fields("fake")

    assert gantry_router._type_name(str) == "str"
    assert gantry_router._type_name(list[str]).startswith("list")
    assert gantry_router._is_primitive(bool | None) is True
    assert gantry_router._is_primitive(dict | None) is False
    assert gantry_router._float_or("not numeric", 12.5) == 12.5
    assert [field.name for field in fields] == ["port", "speed", "enabled", "pipette_model"]
    assert fields[0].required is True
    assert fields[1].default == 1.5
    assert fields[-1].choices is not None


def test_normalize_gantry_yaml_fills_current_schema_defaults(monkeypatch):
    monkeypatch.setattr(
        gantry_router,
        "_gantry_schema_fields",
        lambda: {"gantry_type", "grbl_settings", "instruments"},
    )
    monkeypatch.setattr(
        gantry_router,
        "_cnc_schema_fields",
        lambda: {
            "homing_strategy",
            "factory_z_travel_mm",
            "total_z_range",
            "structure_clearance_z",
            "y_axis_motion",
        },
    )

    normalized = gantry_router._normalize_gantry_yaml(
        {
            "cnc": {"legacy_field": 1, "y_axis_motion": "invalid"},
            "working_volume": {
                "x_max": 400,
                "y_max": 250,
                "z_min": 10,
                "z_max": -1,
            },
            "instruments": ["not", "a", "mapping"],
        }
    )

    assert normalized["gantry_type"] == "cub_xl"
    assert normalized["cnc"] == {
        "homing_strategy": "standard",
        "y_axis_motion": "head",
        "factory_z_travel_mm": 70.0,
        "total_z_range": 80.0,
        "structure_clearance_z": 70.0,
    }
    assert normalized["grbl_settings"] == {}
    assert normalized["instruments"] == {}


def test_connected_state_helpers_refresh_runtime_config(monkeypatch):
    mock_gantry = MagicMock()
    monkeypatch.setattr(gantry_router, "_gantry", mock_gantry)
    monkeypatch.setattr(gantry_router, "_connected_gantry_filename", "active.yaml")

    config = {
        "serial_port": "/dev/ttyUSB0",
        "grbl_settings": {"soft_limits": True},
        "working_volume": {"x_min": 0},
    }
    gantry_router._refresh_connected_config("other.yaml", config)
    assert gantry_router._connected_gantry_config is None

    gantry_router._refresh_connected_config("active.yaml", config)

    assert gantry_router._connected_gantry_config == config
    assert mock_gantry.config == {"serial_port": "/dev/ttyUSB0", "working_volume": {"x_min": 0}}

    monkeypatch.setattr(gantry_router, "_last_position", gantry_router.GantryPosition(connected=True))
    monkeypatch.setattr(gantry_router, "_calibration_warning", "warning")
    monkeypatch.setattr(gantry_router, "_calibration_restore_soft_limits", True)
    gantry_router._clear_connected_gantry_state()
    assert gantry_router._gantry is None
    assert gantry_router._last_position is None
    assert gantry_router._calibration_warning is None
    assert gantry_router._calibration_restore_soft_limits is False


def test_connected_grbl_setting_handles_missing_and_invalid_values(monkeypatch):
    monkeypatch.setattr(gantry_router, "_connected_gantry_config", None)
    assert gantry_router._connected_grbl_setting("homing_pull_off") is None

    monkeypatch.setattr(gantry_router, "_connected_gantry_config", {"grbl_settings": []})
    assert gantry_router._connected_grbl_setting("homing_pull_off") is None

    monkeypatch.setattr(
        gantry_router,
        "_connected_gantry_config",
        {"grbl_settings": {"homing_pull_off": float("inf")}},
    )
    with pytest.raises(gantry_router.HTTPException, match="finite"):
        gantry_router._connected_grbl_setting("homing_pull_off")


def test_calibration_mismatch_warning_handles_read_errors_and_bad_values():
    mock_gantry = MagicMock()
    config = {"grbl_settings": {"soft_limits": True, "max_travel_x": 300.0}}

    mock_gantry.read_grbl_settings.side_effect = RuntimeError("serial read failed")
    assert "Calibration status unknown" in gantry_router._calibration_mismatch_warning(mock_gantry, config)

    mock_gantry.read_grbl_settings.side_effect = None
    mock_gantry.read_grbl_settings.return_value = {"$20": "not numeric"}
    warning = gantry_router._calibration_mismatch_warning(mock_gantry, config)
    assert "$20: expected 1, got not numeric" in warning
    assert "$130: expected 300, got missing" in warning

    mock_gantry.read_grbl_settings.return_value = {"$20": "1", "$130": "300.0004"}
    assert gantry_router._calibration_mismatch_warning(mock_gantry, config) is None


def test_connected_working_volume_supports_object_config_and_invalid_shapes(monkeypatch):
    monkeypatch.setattr(gantry_router, "_gantry", None)
    assert gantry_router._connected_working_volume() is None

    mock_gantry = MagicMock()
    mock_gantry.config = SimpleNamespace(
        working_volume=SimpleNamespace(
            x_min=0,
            x_max=300,
            y_min=0,
            y_max=200,
            z_min=0,
            z_max=80,
        )
    )
    monkeypatch.setattr(gantry_router, "_gantry", mock_gantry)
    assert gantry_router._connected_working_volume()["x_max"] == 300.0

    mock_gantry.config = {"working_volume": {"x_min": 0}}
    assert gantry_router._connected_working_volume() is None


def test_move_and_jog_target_helpers_reject_bad_inputs(monkeypatch):
    mock_gantry = MagicMock()
    mock_gantry.config = {
        "working_volume": {
            "x_min": 0,
            "x_max": 10,
            "y_min": 0,
            "y_max": 10,
            "z_min": 0,
            "z_max": 10,
        }
    }
    monkeypatch.setattr(gantry_router, "_gantry", mock_gantry)

    with pytest.raises(gantry_router.HTTPException, match="finite"):
        gantry_router._validate_manual_move_target(
            gantry_router.MoveToRequest(x=float("nan"), y=1, z=1)
        )

    with pytest.raises(gantry_router.HTTPException, match="finite"):
        gantry_router._validate_jog_target_locked(
            gantry_router.JogRequest(x=0, y=float("inf"), z=0)
        )

    mock_gantry.get_position_info.return_value = {"work_pos": None, "coords": None}
    with pytest.raises(gantry_router.HTTPException, match="current gantry position"):
        gantry_router._current_work_position_locked()

    mock_gantry.get_position_info.return_value = {"work_pos": {"x": "bad", "y": 0, "z": 0}}
    with pytest.raises(gantry_router.HTTPException, match="finite current gantry position"):
        gantry_router._current_work_position_locked()


def test_wait_until_idle_handles_status_errors_and_timeout(monkeypatch):
    mock_gantry = MagicMock()
    monkeypatch.setattr(gantry_router, "_gantry", mock_gantry)
    monkeypatch.setattr(gantry_router.time, "sleep", lambda _seconds: None)

    mock_gantry.get_status.side_effect = RuntimeError("ALARM:1")
    with pytest.raises(gantry_router.HTTPException, match="alarm state"):
        gantry_router._wait_until_idle(timeout_s=1)

    mock_gantry.get_status.side_effect = RuntimeError("serial read failed")
    with pytest.raises(gantry_router.HTTPException, match="Status wait failed"):
        gantry_router._wait_until_idle(timeout_s=1)

    mock_gantry.get_status.side_effect = None
    mock_gantry.get_status.return_value = "error"
    with pytest.raises(gantry_router.HTTPException, match="Gantry entered"):
        gantry_router._wait_until_idle(timeout_s=1)

    times = iter([0.0, 0.2])
    monkeypatch.setattr(gantry_router.time, "monotonic", lambda: next(times))
    mock_gantry.get_status.return_value = "Run"
    with pytest.raises(gantry_router.HTTPException, match="Timed out"):
        gantry_router._wait_until_idle(timeout_s=0.1)


def test_grbl_setting_parsing_helpers_accept_and_reject_expected_shapes():
    assert gantry_router._normalize_grbl_setting_code("20") == "$20"
    assert gantry_router._normalize_grbl_setting_code("$21") == "$21"

    with pytest.raises(ValueError, match="numeric code"):
        gantry_router._normalize_grbl_setting_code("$X")
    with pytest.raises(ValueError, match="cannot be empty"):
        gantry_router._parse_grbl_setting_value(" ")
    with pytest.raises(ValueError, match="cannot contain newlines"):
        gantry_router._parse_grbl_setting_value("1\n2")
    with pytest.raises(ValueError, match="must be numeric"):
        gantry_router._parse_grbl_setting_value("fast")


def test_get_position_returns_not_connected_and_lock_busy_states(monkeypatch):
    assert api_request(create_app(), "GET", "/api/gantry/position").json() == {
        "x": 0.0,
        "y": 0.0,
        "z": 0.0,
        "work_x": None,
        "work_y": None,
        "work_z": None,
        "status": "Not connected",
        "connected": False,
        "calibration_warning": None,
        "move_error": None,
    }

    mock_gantry = MagicMock()
    mock_gantry._extract_status.return_value = "Run"
    monkeypatch.setattr(gantry_router, "_gantry", mock_gantry)
    monkeypatch.setattr(
        gantry_router,
        "_last_position",
        gantry_router.GantryPosition(x=1, y=2, z=3, connected=True, status="Idle"),
    )
    gantry_router._serial_lock.acquire()
    try:
        response = api_request(create_app(), "GET", "/api/gantry/position")
    finally:
        gantry_router._serial_lock.release()

    body = response.json()
    assert body["status"] == "Run"
    assert body["x"] == 1

    monkeypatch.setattr(gantry_router, "_last_position", None)
    gantry_router._serial_lock.acquire()
    try:
        response = api_request(create_app(), "GET", "/api/gantry/position")
    finally:
        gantry_router._serial_lock.release()
    assert response.json()["status"] == "Run"


def test_position_query_failure_during_calibration_uses_explicit_failed_status(monkeypatch):
    mock_gantry = MagicMock()
    mock_gantry.get_position_info.side_effect = RuntimeError("serial read failed")
    monkeypatch.setattr(gantry_router, "_gantry", mock_gantry)
    monkeypatch.setattr(
        gantry_router,
        "_last_position",
        gantry_router.GantryPosition(x=1, y=2, z=3, connected=True, status="Idle"),
    )
    monkeypatch.setattr(gantry_router, "_calibration_jog_bypass_working_volume", True)

    response = api_request(create_app(), "GET", "/api/gantry/position")

    assert response.json()["status"] == "Query failed"


def test_position_returns_move_error_when_background_move_failed(monkeypatch):
    mock_gantry = MagicMock()
    mock_gantry.get_position_info.return_value = idle_position_info(x=1, y=2, z=3)
    monkeypatch.setattr(gantry_router, "_gantry", mock_gantry)
    monkeypatch.setattr(gantry_router, "_move_error", "move failed")

    response = api_request(create_app(), "GET", "/api/gantry/position")

    assert response.json()["move_error"] == "move failed"


def test_move_to_starts_background_worker(monkeypatch):
    mock_gantry = configure_joggable_gantry(MagicMock())
    created_threads = []

    class FakeThread:
        def __init__(self, target, args, daemon):
            created_threads.append((target, args, daemon))

        def start(self):
            created_threads.append("started")

    monkeypatch.setattr(gantry_router, "_gantry", mock_gantry)
    monkeypatch.setattr(gantry_router.threading, "Thread", FakeThread)

    response = api_request(
        create_app(),
        "POST",
        "/api/gantry/move-to",
        json={"x": 10, "y": 20, "z": 30},
    )

    assert response.status_code == 200
    assert created_threads[0] == (gantry_router._move_worker, (10.0, 20.0, 30.0), True)
    assert created_threads[1] == "started"


def test_move_worker_records_errors(monkeypatch):
    mock_gantry = MagicMock()
    mock_gantry.move_to.side_effect = RuntimeError("blocked")
    monkeypatch.setattr(gantry_router, "_gantry", mock_gantry)

    gantry_router._move_worker(1, 2, 3)

    assert gantry_router._move_error == "blocked"


def test_zero_jog_and_zero_blocking_jog_return_without_motion(monkeypatch):
    mock_gantry = configure_joggable_gantry(MagicMock())
    monkeypatch.setattr(gantry_router, "_gantry", mock_gantry)

    response = api_request(create_app(), "POST", "/api/gantry/jog", json={})
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}
    mock_gantry.jog.assert_not_called()

    response = api_request(create_app(), "POST", "/api/gantry/jog-blocking", json={})
    assert response.status_code == 200
    mock_gantry.jog.assert_not_called()


def test_set_work_coordinates_rejects_empty_payload_and_hardware_errors(monkeypatch):
    mock_gantry = MagicMock()
    mock_gantry.set_work_coordinates.side_effect = RuntimeError("setter failed")
    monkeypatch.setattr(gantry_router, "_gantry", mock_gantry)

    response = api_request(create_app(), "POST", "/api/gantry/work-coordinates", json={})
    assert response.status_code == 422

    response = api_request(
        create_app(),
        "POST",
        "/api/gantry/work-coordinates",
        json={"x": 1},
    )
    assert response.status_code == 500
    assert "setter failed" in response.text


def test_soft_limit_and_calibration_routes_handle_basic_error_paths(monkeypatch):
    assert api_request(create_app(), "POST", "/api/gantry/soft-limits", json={
        "max_travel_x": 1,
        "max_travel_y": 1,
        "max_travel_z": 1,
    }).status_code == 400
    assert api_request(create_app(), "POST", "/api/gantry/calibration/prepare-origin").status_code == 400
    assert api_request(create_app(), "POST", "/api/gantry/calibration/home-and-center").status_code == 400
    assert api_request(create_app(), "POST", "/api/gantry/calibration/restore-soft-limits").status_code == 400
    assert api_request(create_app(), "POST", "/api/gantry/calibration/finalize-origin", json={
        "home_z": 1,
        "block_touch_z": 0,
        "block_height": 1,
        "factory_z_travel": 1,
    }).status_code == 400
    assert api_request(create_app(), "POST", "/api/gantry/calibration/recover-limit", json={
        "x": 1,
        "y": 0,
        "z": 0,
    }).status_code == 400

    mock_gantry = MagicMock()
    mock_gantry.configure_soft_limits_from_spans.side_effect = RuntimeError("soft failed")
    mock_gantry.home.side_effect = RuntimeError("home failed")
    mock_gantry.get_coordinates.side_effect = RuntimeError("bounds failed")
    mock_gantry.set_soft_limits_enabled.side_effect = RuntimeError("restore failed")
    mock_gantry.finalize_deck_origin_calibration.side_effect = RuntimeError("finalize failed")
    monkeypatch.setattr(gantry_router, "_gantry", mock_gantry)
    monkeypatch.setattr(gantry_router, "_calibration_restore_soft_limits", True)

    assert api_request(create_app(), "POST", "/api/gantry/soft-limits", json={
        "max_travel_x": 1,
        "max_travel_y": 1,
        "max_travel_z": 1,
    }).status_code == 500
    assert api_request(create_app(), "POST", "/api/gantry/calibration/prepare-origin").status_code == 500
    assert api_request(create_app(), "POST", "/api/gantry/calibration/home-and-center").status_code == 500
    assert api_request(create_app(), "POST", "/api/gantry/calibration/restore-soft-limits").status_code == 500
    assert api_request(create_app(), "POST", "/api/gantry/calibration/finalize-origin", json={
        "home_z": 1,
        "block_touch_z": 0,
        "block_height": 1,
        "factory_z_travel": 1,
    }).status_code == 500


def test_finalize_origin_alarm_error_is_recoverable(monkeypatch):
    mock_gantry = MagicMock()
    mock_gantry.finalize_deck_origin_calibration.side_effect = RuntimeError("ALARM:1")
    monkeypatch.setattr(gantry_router, "_gantry", mock_gantry)
    monkeypatch.setattr(gantry_router, "_calibration_restore_soft_limits", True)
    monkeypatch.setattr(gantry_router, "_calibration_jog_bypass_working_volume", True)

    response = api_request(create_app(), "POST", "/api/gantry/calibration/finalize-origin", json={
        "home_z": 1,
        "block_touch_z": 0,
        "block_height": 1,
        "factory_z_travel": 1,
    })

    assert response.status_code == 409
    assert gantry_router._calibration_restore_soft_limits is False
    assert gantry_router._calibration_jog_bypass_working_volume is False


def test_simple_controller_routes_cover_not_connected_and_failure_paths(monkeypatch):
    for method, path in (
        ("POST", "/api/gantry/reset-unlock"),
        ("POST", "/api/gantry/feed-hold"),
        ("POST", "/api/gantry/jog-cancel"),
        ("GET", "/api/gantry/grbl-settings"),
        ("POST", "/api/gantry/grbl-settings"),
    ):
        kwargs = {}
        if method == "POST" and path.endswith("grbl-settings"):
            kwargs["json"] = {"setting": "$20", "value": "1"}
        response = api_request(create_app(), method, path, **kwargs)
        assert response.status_code == 400

    mock_gantry = MagicMock()
    mock_gantry.reset_and_unlock.side_effect = RuntimeError("reset failed")
    mock_gantry.stop.side_effect = RuntimeError("stop failed")
    mock_gantry.jog_cancel.side_effect = RuntimeError("cancel failed")
    mock_gantry.read_grbl_settings.side_effect = RuntimeError("read failed")
    monkeypatch.setattr(gantry_router, "_gantry", mock_gantry)

    assert api_request(create_app(), "POST", "/api/gantry/reset-unlock").status_code == 500
    assert api_request(create_app(), "POST", "/api/gantry/feed-hold").status_code == 500
    assert api_request(create_app(), "POST", "/api/gantry/jog-cancel").status_code == 500
    assert api_request(create_app(), "GET", "/api/gantry/grbl-settings").status_code == 500

    mock_gantry.read_grbl_settings.side_effect = None
    mock_gantry.set_grbl_setting.side_effect = RuntimeError("write failed")
    assert api_request(
        create_app(),
        "POST",
        "/api/gantry/grbl-settings",
        json={"setting": "$20", "value": "1"},
    ).status_code == 500


def test_connect_handles_default_missing_and_wco_seed_paths(monkeypatch, tmp_path):
    from zoo.config import get_settings
    from zoo.services.yaml_io import write_yaml

    config_dir = tmp_path / "configs"
    gantry_dir = config_dir / "gantry"
    gantry_dir.mkdir(parents=True)
    write_yaml(
        gantry_dir / "first.yaml",
        {
            "serial_port": "/dev/first",
            "gantry_type": "cub",
            "cnc": {"homing_strategy": "standard", "factory_z_travel_mm": 80.0},
            "working_volume": {
                "x_min": 0,
                "x_max": 10,
                "y_min": 0,
                "y_max": 10,
                "z_min": 0,
                "z_max": 10,
            },
            "instruments": {},
        },
    )
    monkeypatch.setattr(get_settings(), "config_dir", config_dir)

    observed = []

    class FakeGantry:
        def __init__(self, config=None):
            observed.append(config)
            self.calls = 0

        def connect(self):
            pass

        def read_grbl_settings(self):
            return {}

        def get_position_info(self):
            self.calls += 1
            work_pos = None if self.calls == 1 else {"x": 0, "y": 0, "z": 0}
            return {
                "coords": {"x": 0, "y": 0, "z": 0},
                "work_pos": work_pos,
                "status": "Idle",
            }

    monkeypatch.setattr(gantry_router, "Gantry", FakeGantry)

    response = api_request(create_app(), "POST", "/api/gantry/connect")

    assert response.status_code == 200
    assert observed[0]["serial_port"] == "/dev/first"

    response = api_request(
        create_app(),
        "POST",
        "/api/gantry/connect",
        json={"filename": "missing.yaml"},
    )

    assert response.status_code == 404


def test_get_and_put_gantry_error_and_refresh_paths(monkeypatch, tmp_path):
    from zoo.config import get_settings
    from zoo.services.yaml_io import read_yaml, write_yaml

    config_dir = tmp_path / "configs"
    gantry_dir = config_dir / "gantry"
    gantry_dir.mkdir(parents=True)
    monkeypatch.setattr(get_settings(), "config_dir", config_dir)

    assert api_request(create_app(), "GET", "/api/gantry/missing.yaml").status_code == 404
    assert api_request(create_app(), "PUT", "/api/gantry/bad.yaml", json={"cnc": {}}).status_code == 400

    write_yaml(
        gantry_dir / "active.yaml",
        {
            "serial_port": "/dev/ttyUSB0",
            "gantry_type": "cub",
            "cnc": {"homing_strategy": "standard", "factory_z_travel_mm": 80.0},
            "working_volume": {
                "x_min": 0,
                "x_max": 10,
                "y_min": 0,
                "y_max": 10,
                "z_min": 0,
                "z_max": 10,
            },
            "instruments": {},
        },
    )
    mock_gantry = MagicMock()
    monkeypatch.setattr(gantry_router, "_gantry", mock_gantry)
    monkeypatch.setattr(gantry_router, "_connected_gantry_filename", "active.yaml")

    payload = read_yaml(gantry_dir / "active.yaml")
    payload["serial_port"] = "/dev/updated"
    response = api_request(create_app(), "PUT", "/api/gantry/active.yaml", json=payload)

    assert response.status_code == 200
    assert gantry_router._connected_gantry_config["serial_port"] == "/dev/updated"
    assert mock_gantry.config["serial_port"] == "/dev/updated"


def test_disconnect_noop_and_disconnect_only_failure(monkeypatch):
    response = api_request(create_app(), "POST", "/api/gantry/disconnect")
    assert response.status_code == 200
    assert response.json()["status"] == "Disconnected"

    mock_gantry = MagicMock()
    mock_gantry.disconnect.side_effect = RuntimeError("port closed")
    monkeypatch.setattr(gantry_router, "_gantry", mock_gantry)

    response = api_request(create_app(), "POST", "/api/gantry/disconnect")

    assert response.status_code == 500
    assert "Disconnect failed" in response.text


def test_remaining_simple_gantry_helpers(monkeypatch):
    assert gantry_router._alarm_status_from_error(RuntimeError("")) == "Alarm"
    assert gantry_router._is_primitive(list) is False

    monkeypatch.setattr(
        gantry_router,
        "_gantry_schema_fields",
        lambda: set(),
    )
    monkeypatch.setattr(
        gantry_router,
        "_cnc_schema_fields",
        lambda: {"homing_strategy", "total_z_height", "y_axis_motion"},
    )
    normalized = gantry_router._normalize_gantry_yaml(
        {
            "cnc": {"total_z_height": 40},
            "working_volume": {"z_min": 0, "z_max": 40},
            "grbl_settings": {"soft_limits": True},
            "instruments": {"tool": {}},
        }
    )
    assert normalized["cnc"]["total_z_height"] == 40.0
    assert "grbl_settings" not in normalized
    assert "instruments" not in normalized

    class FakeConfig:
        def model_dump(self, **_kwargs):
            return {
                "cnc": {},
                "working_volume": {"z_min": 5.0, "z_max": 25.0},
            }

    payload = gantry_router._api_gantry_config(
        FakeConfig(),
        {"cnc": {"total_z_height": 18.0, "calibration_block_height_mm": 7.5}},
    )
    assert payload["cnc"]["factory_z_travel_mm"] == 20.0
    assert payload["cnc"]["calibration_block_height_mm"] == 7.5

    monkeypatch.setattr(
        gantry_router,
        "_connected_gantry_config",
        {"grbl_settings": "not a mapping"},
    )
    assert gantry_router._connected_grbl_setting("homing_pull_off") is None

    monkeypatch.setattr(gantry_router, "_gantry", None)
    with pytest.raises(gantry_router.HTTPException, match="Gantry not connected"):
        gantry_router._apply_calibration_grbl_baseline()
    with pytest.raises(gantry_router.HTTPException, match="Gantry not connected"):
        gantry_router._current_work_position_locked()
    with pytest.raises(gantry_router.HTTPException, match="Gantry not connected"):
        gantry_router._wait_until_idle(timeout_s=0.1)

    mock_gantry = MagicMock()
    mock_gantry.config = SimpleNamespace(working_volume=None)
    monkeypatch.setattr(gantry_router, "_gantry", mock_gantry)
    assert gantry_router._connected_working_volume() is None

    mock_gantry.config = SimpleNamespace(
        working_volume=SimpleNamespace(
            x_min=0,
            x_max="bad",
            y_min=0,
            y_max=1,
            z_min=0,
            z_max=1,
        )
    )
    assert gantry_router._connected_working_volume() is None

    mock_gantry.config = {}
    with pytest.raises(gantry_router.HTTPException, match="Manual jogs require"):
        gantry_router._validate_jog_target_locked(gantry_router.JogRequest(x=1, y=0, z=0))


def test_remaining_gantry_metadata_endpoints(monkeypatch, tmp_path):
    from zoo.config import get_settings
    from zoo.services.yaml_io import write_yaml

    config_dir = tmp_path / "configs"
    gantry_dir = config_dir / "gantry"
    gantry_dir.mkdir(parents=True)
    write_yaml(gantry_dir / "b.yaml", {"working_volume": {}})
    write_yaml(gantry_dir / "a.yaml", {"working_volume": {}})
    monkeypatch.setattr(get_settings(), "config_dir", config_dir)

    assert api_request(create_app(), "GET", "/api/gantry/configs").json() == ["a.yaml", "b.yaml"]

    pipette_models = api_request(create_app(), "GET", "/api/gantry/pipette-models").json()
    assert pipette_models
    assert {"name", "family", "channels", "max_volume", "min_volume"} <= set(pipette_models[0])

    schemas = api_request(create_app(), "GET", "/api/gantry/instrument-schemas").json()
    assert isinstance(schemas, dict)
    assert schemas


def test_remaining_gantry_endpoint_error_paths(monkeypatch):
    response = api_request(create_app(), "GET", "/api/gantry/position")
    assert response.status_code == 200

    assert api_request(create_app(), "POST", "/api/gantry/jog", json={"x": 1}).status_code == 400
    assert api_request(create_app(), "POST", "/api/gantry/move-to", json={"x": 1, "y": 1, "z": 1}).status_code == 400
    assert api_request(create_app(), "POST", "/api/gantry/move-to-blocking", json={"x": 1, "y": 1, "z": 1}).status_code == 400
    assert api_request(create_app(), "POST", "/api/gantry/jog-blocking", json={"x": 1}).status_code == 400
    assert api_request(create_app(), "POST", "/api/gantry/work-coordinates", json={"x": 1}).status_code == 400

    mock_gantry = configure_joggable_gantry(MagicMock())
    monkeypatch.setattr(gantry_router, "_gantry", mock_gantry)

    mock_gantry.get_position_info.side_effect = RuntimeError("serial failed")
    monkeypatch.setattr(gantry_router, "_last_position", None)
    assert api_request(create_app(), "GET", "/api/gantry/position").json()["status"] == "Query failed"

    mock_gantry.get_position_info.side_effect = None
    mock_gantry.home.side_effect = RuntimeError("home failed")
    assert api_request(create_app(), "POST", "/api/gantry/home").status_code == 500

    mock_gantry.move_to.side_effect = RuntimeError("move failed")
    assert api_request(
        create_app(),
        "POST",
        "/api/gantry/move-to-blocking",
        json={"x": 1, "y": 1, "z": 1},
    ).status_code == 500

    mock_gantry.jog.side_effect = RuntimeError("motor stalled")
    assert api_request(
        create_app(),
        "POST",
        "/api/gantry/jog-blocking",
        json={"x": 1, "y": 0, "z": 0},
    ).status_code == 500


def test_remaining_soft_limit_and_finalize_branches(monkeypatch):
    mock_gantry = MagicMock()
    mock_gantry.read_grbl_settings.return_value = {
        "$10": "0",
        "$20": "1",
        "$21": "0",
        "$22": "1",
        "$27": "5",
        "$130": "10",
        "$131": "10",
        "$132": "10",
    }
    monkeypatch.setattr(gantry_router, "_gantry", mock_gantry)
    monkeypatch.setattr(
        gantry_router,
        "_connected_gantry_config",
        {"grbl_settings": {"soft_limits": True, "homing_enable": True}},
    )

    response = api_request(
        create_app(),
        "POST",
        "/api/gantry/soft-limits",
        json={
            "max_travel_x": 10,
            "max_travel_y": 10,
            "max_travel_z": 10,
            "status_report": 0,
            "homing_pull_off": 5,
        },
    )

    assert response.status_code == 200
    settings = gantry_router._connected_gantry_config["grbl_settings"]
    assert settings["status_report"] == 0.0
    assert settings["homing_pull_off"] == 5.0

    monkeypatch.setattr(gantry_router, "_calibration_restore_soft_limits", True)
    monkeypatch.setattr(gantry_router, "_calibration_jog_bypass_working_volume", True)
    monkeypatch.setattr(
        gantry_router,
        "_connected_gantry_config",
        {"grbl_settings": {"homing_pull_off": float("inf")}},
    )

    response = api_request(create_app(), "POST", "/api/gantry/calibration/finalize-origin", json={
        "home_z": 1,
        "block_touch_z": 0,
        "block_height": 1,
        "factory_z_travel": 1,
    })

    assert response.status_code == 400
    assert gantry_router._calibration_restore_soft_limits is False
    assert gantry_router._calibration_jog_bypass_working_volume is False
