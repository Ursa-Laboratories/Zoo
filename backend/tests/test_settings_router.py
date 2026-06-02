"""Test settings API config directory contract."""

import sys as python_sys
import tempfile
import types
from pathlib import Path
from subprocess import CompletedProcess

import pytest

from backend.tests.api_client import api_request
from zoo.app import create_app
from zoo.config import get_settings
from zoo.routers import settings as settings_router


@pytest.fixture(autouse=True)
def restore_config_dir():
    original = get_settings().config_dir
    yield
    get_settings().config_dir = original


def test_get_settings_returns_config_dir(monkeypatch):
    with tempfile.TemporaryDirectory() as d:
        monkeypatch.setattr(get_settings(), "config_dir", Path(d))
        app = create_app()

        response = api_request(app, "GET", "/api/settings")

        assert response.status_code == 200
        assert response.json() == {"config_dir": str(Path(d).resolve())}


def test_settings_endpoint_reports_existing_local_directory(monkeypatch):
    with tempfile.TemporaryDirectory() as d:
        path = Path(d)
        monkeypatch.setattr(get_settings(), "config_dir", path)
        app = create_app()

        response = api_request(app, "GET", "/api/settings")

        assert response.status_code == 200
        assert response.json()["config_dir"] == str(path.resolve())
        assert path.is_dir()


def test_update_settings_accepts_config_dir():
    with tempfile.TemporaryDirectory() as d:
        app = create_app()

        response = api_request(app, "PUT", "/api/settings", json={"config_dir": d})

        assert response.status_code == 200
        assert response.json() == {"config_dir": str(Path(d).resolve())}
        assert get_settings().config_dir == Path(d).resolve()


def test_update_settings_rejects_invalid_path():
    app = create_app()

    response = api_request(app, "PUT", "/api/settings", json={"config_dir": "/does/not/exist"})

    assert response.status_code == 400
    assert "Directory does not exist" in response.text


def test_browse_directory_returns_selected_config_dir(monkeypatch):
    selected = "/tmp/zoo-configs"
    monkeypatch.setattr(settings_router.sys, "platform", "darwin")

    monkeypatch.setattr(
        "zoo.routers.settings.subprocess.run",
        lambda *args, **kwargs: CompletedProcess(args=args[0], returncode=0, stdout=f"{selected}\n"),
    )

    app = create_app()
    response = api_request(app, "POST", "/api/settings/browse")

    assert response.status_code == 200
    assert response.json() == {"config_dir": selected}


def test_browse_directory_rejects_cancelled_macos_selection(monkeypatch):
    monkeypatch.setattr(settings_router.sys, "platform", "darwin")
    monkeypatch.setattr(
        settings_router.subprocess,
        "run",
        lambda *args, **kwargs: CompletedProcess(args=args[0], returncode=1, stdout=""),
    )

    response = api_request(create_app(), "POST", "/api/settings/browse")

    assert response.status_code == 400
    assert "No directory selected" in response.text


def test_browse_directory_uses_tk_picker_on_non_macos(monkeypatch, tmp_path):
    calls = []

    class FakeRoot:
        def withdraw(self):
            calls.append("withdraw")

        def destroy(self):
            calls.append("destroy")

    filedialog = types.SimpleNamespace(
        askdirectory=lambda title: str(tmp_path),
    )
    tkinter = types.SimpleNamespace(Tk=FakeRoot, filedialog=filedialog)
    monkeypatch.setattr(settings_router.sys, "platform", "linux")
    monkeypatch.setitem(python_sys.modules, "tkinter", tkinter)
    monkeypatch.setitem(python_sys.modules, "tkinter.filedialog", filedialog)

    response = api_request(create_app(), "POST", "/api/settings/browse")

    assert response.status_code == 200
    assert response.json() == {"config_dir": str(tmp_path)}
    assert calls == ["withdraw", "destroy"]
