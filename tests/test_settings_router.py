"""Test settings API CubOS path contract."""

import tempfile
from pathlib import Path

import pytest

from tests.api_client import api_request
from zoo.app import create_app
from zoo.config import get_settings


@pytest.fixture(autouse=True)
def restore_cubos_path():
    original = get_settings().cubos_path
    yield
    get_settings().cubos_path = original


def test_get_settings_returns_cubos_path(monkeypatch):
    with tempfile.TemporaryDirectory() as d:
        monkeypatch.setattr(get_settings(), "cubos_path", Path(d))
        app = create_app()

        response = api_request(app, "GET", "/api/settings")

        assert response.status_code == 200
        assert response.json() == {"cubos_path": str(Path(d).resolve())}


def test_update_settings_accepts_cubos_path():
    with tempfile.TemporaryDirectory() as d:
        app = create_app()

        response = api_request(app, "PUT", "/api/settings", json={"cubos_path": d})

        assert response.status_code == 200
        assert response.json() == {"cubos_path": str(Path(d).resolve())}
        assert get_settings().cubos_path == Path(d)


def test_update_settings_accepts_legacy_panda_core_path():
    with tempfile.TemporaryDirectory() as d:
        app = create_app()

        response = api_request(app, "PUT", "/api/settings", json={"panda_core_path": d})

        assert response.status_code == 200
        assert response.json() == {"cubos_path": str(Path(d).resolve())}
        assert get_settings().cubos_path == Path(d)


def test_update_settings_rejects_missing_path():
    app = create_app()

    response = api_request(app, "PUT", "/api/settings", json={})

    assert response.status_code == 400
    assert "cubos_path is required" in response.text


def test_update_settings_rejects_invalid_path():
    app = create_app()

    response = api_request(app, "PUT", "/api/settings", json={"cubos_path": "/does/not/exist"})

    assert response.status_code == 400
