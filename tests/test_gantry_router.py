"""Test gantry API endpoints delegate to CubOS ``Gantry`` methods."""

from unittest.mock import MagicMock

import pytest

from gantry.gantry_driver.exceptions import StatusReturnError
from gantry.limit_recovery import LimitRecoveryResult
from tests.api_client import api_request
from zoo.app import create_app
from zoo.routers import gantry as gantry_router


def idle_position_info(x=0.0, y=0.0, z=0.0):
    return {
        "coords": {"x": x, "y": y, "z": z},
        "work_pos": {"x": x, "y": y, "z": z},
        "status": "Idle",
    }


@pytest.fixture(autouse=True)
def reset_gantry_router_state(monkeypatch):
    monkeypatch.setattr(gantry_router, "_gantry", None)
    monkeypatch.setattr(gantry_router, "_calibration_warning", None)
    monkeypatch.setattr(gantry_router, "_connected_gantry_config", None)
    monkeypatch.setattr(gantry_router, "_calibration_restore_soft_limits", False)
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
    assert config["working_volume"]["z_max"] == 135.0


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
        tolerance_mm=0.1,
    )
    assert gantry_router._calibration_restore_soft_limits is False


def test_configure_soft_limits_refreshes_calibration_warning(monkeypatch):
    mock_gantry = MagicMock()
    mock_gantry.read_grbl_settings.return_value = {
        "$20": "1",
        "$22": "1",
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
                "soft_limits": True,
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
    monkeypatch.setattr(gantry_router, "_gantry", mock_gantry)

    response = api_request(create_app(), "POST", "/api/gantry/calibration/prepare-origin")

    assert response.status_code == 200
    assert calls == [
        "home",
        "enforce_work_position_reporting",
        ("activate_work_coordinate_system", "G54"),
        "clear_g92_offsets",
        ("set_soft_limits_enabled", False),
    ]
    assert gantry_router._calibration_restore_soft_limits is True


def test_restore_calibration_soft_limits_only_when_zoo_disabled_them(monkeypatch):
    mock_gantry = MagicMock()
    mock_gantry.get_position_info.return_value = idle_position_info()
    monkeypatch.setattr(gantry_router, "_gantry", mock_gantry)
    monkeypatch.setattr(gantry_router, "_calibration_restore_soft_limits", True)

    response = api_request(create_app(), "POST", "/api/gantry/calibration/restore-soft-limits")

    assert response.status_code == 200
    mock_gantry.set_soft_limits_enabled.assert_called_once_with(True)
    assert gantry_router._calibration_restore_soft_limits is False


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
    mock_gantry = MagicMock()
    mock_gantry.get_status.side_effect = ["Run", "Idle"]
    mock_gantry.get_position_info.return_value = idle_position_info(z=15.0)
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


def test_blocking_jog_surfaces_alarm_status_as_recoverable(monkeypatch):
    mock_gantry = MagicMock()
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
    mock_gantry = MagicMock()
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
    mock_gantry = MagicMock()
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
    mock_gantry = MagicMock()
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
    mock_gantry = MagicMock()
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
    mock_gantry = MagicMock()
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
    mock_gantry = MagicMock()
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
