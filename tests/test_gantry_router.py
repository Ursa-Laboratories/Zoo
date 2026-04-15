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
