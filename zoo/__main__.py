"""`python -m zoo` entry point."""

import logging
import shutil
import subprocess
import sys
import threading
import time
import webbrowser
from pathlib import Path

import uvicorn

from zoo.config import ZooSettings

FRONTEND_DIR = Path(__file__).parent.parent / "frontend"
FRONTEND_DIST = FRONTEND_DIR / "dist"
log = logging.getLogger(__name__)


def _build_frontend() -> None:
    if not FRONTEND_DIR.is_dir():
        print("Warning: frontend/ directory not found, skipping build.")
        return
    npm = shutil.which("npm")
    if npm is None:
        log.warning("npm not found - frontend will not be served")
        return
    print("Building frontend...")
    subprocess.run(
        [npm, "run", "build"],
        cwd=FRONTEND_DIR,
        check=True,
    )


def main() -> None:
    settings = ZooSettings()

    if not FRONTEND_DIST.is_dir():
        _build_frontend()

    if settings.open_browser:

        def _open() -> None:
            time.sleep(1.5)
            webbrowser.open(f"http://{settings.host}:{settings.port}")

        threading.Thread(target=_open, daemon=True).start()

    uvicorn.run(
        "zoo.app:create_app",
        factory=True,
        host=settings.host,
        port=settings.port,
        reload=False,
    )


if __name__ == "__main__":
    main()
