"""Test `python -m zoo` orchestration without starting a server."""

from zoo import __main__ as zoo_main


class FakeSettings:
    host = "127.0.0.9"
    port = 9999
    open_browser = False


def test_build_frontend_skips_when_frontend_dir_is_missing(monkeypatch, tmp_path, capsys):
    monkeypatch.setattr(zoo_main, "FRONTEND_DIR", tmp_path / "missing")

    zoo_main._build_frontend()

    assert "frontend/ directory not found" in capsys.readouterr().out


def test_build_frontend_runs_npm_build(monkeypatch, tmp_path):
    calls = []
    frontend_dir = tmp_path / "frontend"
    frontend_dir.mkdir()
    monkeypatch.setattr(zoo_main, "FRONTEND_DIR", frontend_dir)
    monkeypatch.setattr(
        zoo_main.subprocess,
        "run",
        lambda args, cwd, check: calls.append((args, cwd, check)),
    )

    zoo_main._build_frontend()

    assert calls == [(["npm", "run", "build"], frontend_dir, True)]


def test_main_builds_missing_frontend_and_runs_uvicorn(monkeypatch, tmp_path):
    calls = []
    monkeypatch.setattr(zoo_main, "ZooSettings", FakeSettings)
    monkeypatch.setattr(zoo_main, "FRONTEND_DIST", tmp_path / "missing-dist")
    monkeypatch.setattr(zoo_main, "_build_frontend", lambda: calls.append("build"))
    monkeypatch.setattr(
        zoo_main.uvicorn,
        "run",
        lambda *args, **kwargs: calls.append(("uvicorn", args, kwargs)),
    )

    zoo_main.main()

    assert calls[0] == "build"
    _, args, kwargs = calls[1]
    assert args == ("zoo.app:create_app",)
    assert kwargs == {
        "factory": True,
        "host": FakeSettings.host,
        "port": FakeSettings.port,
        "reload": False,
    }


def test_main_schedules_browser_open_when_enabled(monkeypatch, tmp_path):
    opened = []
    dist = tmp_path / "dist"
    dist.mkdir()

    class BrowserSettings(FakeSettings):
        open_browser = True

    class ImmediateThread:
        def __init__(self, target, daemon):
            assert daemon is True
            self.target = target

        def start(self):
            self.target()

    monkeypatch.setattr(zoo_main, "ZooSettings", BrowserSettings)
    monkeypatch.setattr(zoo_main, "FRONTEND_DIST", dist)
    monkeypatch.setattr(zoo_main.threading, "Thread", ImmediateThread)
    monkeypatch.setattr(zoo_main.time, "sleep", lambda _seconds: None)
    monkeypatch.setattr(zoo_main.webbrowser, "open", lambda url: opened.append(url))
    monkeypatch.setattr(zoo_main.uvicorn, "run", lambda *args, **kwargs: None)

    zoo_main.main()

    assert opened == [f"http://{BrowserSettings.host}:{BrowserSettings.port}"]
