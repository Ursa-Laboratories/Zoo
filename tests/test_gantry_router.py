"""Test gantry API endpoints delegate to CubOS ``Gantry`` methods."""

from unittest.mock import MagicMock

from tests.api_client import api_request
from zoo.app import create_app
from zoo.routers import gantry as gantry_router


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
