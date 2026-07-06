"""Tests for the `python -m zoo` entrypoint helpers."""

from __future__ import annotations

import logging


def test_build_frontend_warns_when_npm_is_missing(monkeypatch, tmp_path, caplog):
    from zoo import __main__ as zoo_main

    frontend_dir = tmp_path / "frontend"
    frontend_dir.mkdir()
    monkeypatch.setattr(zoo_main, "FRONTEND_DIR", frontend_dir)
    monkeypatch.setattr(zoo_main.shutil, "which", lambda _name: None)

    with caplog.at_level(logging.WARNING):
        zoo_main._build_frontend()

    assert "npm not found - frontend will not be served" in caplog.text
