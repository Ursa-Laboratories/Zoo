"""Test Zoo app factory and lifespan behavior."""

import asyncio
from unittest.mock import MagicMock

from zoo import app as zoo_app
from zoo.routers import gantry as gantry_router


def _run_lifespan_once() -> None:
    async def run() -> None:
        app = zoo_app.create_app()
        async with zoo_app.lifespan(app):
            pass

    asyncio.run(run())


def test_lifespan_disconnects_connected_gantry(monkeypatch):
    mock_gantry = MagicMock()
    monkeypatch.setattr(gantry_router, "_gantry", mock_gantry)

    _run_lifespan_once()

    mock_gantry.disconnect.assert_called_once_with()
    assert gantry_router._gantry is None


def test_lifespan_clears_connected_gantry_after_disconnect_error(monkeypatch, caplog):
    mock_gantry = MagicMock()
    mock_gantry.disconnect.side_effect = RuntimeError("serial busy")
    monkeypatch.setattr(gantry_router, "_gantry", mock_gantry)

    _run_lifespan_once()

    mock_gantry.disconnect.assert_called_once_with()
    assert gantry_router._gantry is None
    assert "Error disconnecting gantry on shutdown" in caplog.text


def test_create_app_mounts_frontend_dist_when_present(monkeypatch, tmp_path):
    (tmp_path / "index.html").write_text("<!doctype html><title>Zoo</title>")
    monkeypatch.setattr(zoo_app, "FRONTEND_DIST", tmp_path)

    app = zoo_app.create_app()

    assert any(getattr(route, "name", None) == "frontend" for route in app.routes)
