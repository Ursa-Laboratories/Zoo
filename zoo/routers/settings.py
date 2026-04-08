"""Settings API for Zoo configuration such as the CubOS path."""

from pathlib import Path
import subprocess
import sys

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, ConfigDict

from zoo.cubos import ensure_cubos_imports
from zoo.config import get_settings

router = APIRouter(prefix="/api/settings", tags=["settings"])


class SettingsResponse(BaseModel):
    cubos_path: str


class UpdatePathRequest(BaseModel):
    model_config = ConfigDict(extra="ignore")

    cubos_path: str | None = None
    panda_core_path: str | None = None

    def selected_path(self) -> str:
        path = self.cubos_path or self.panda_core_path
        if path is None:
            raise ValueError("cubos_path is required")
        return path


@router.get("")
def get_current_settings() -> SettingsResponse:
    return SettingsResponse(cubos_path=str(get_settings().cubos_path.resolve()))


@router.put("")
def update_settings(body: UpdatePathRequest) -> SettingsResponse:
    try:
        raw_path = body.selected_path()
    except ValueError as exc:
        raise HTTPException(400, str(exc))
    path = Path(raw_path)
    if not path.is_dir():
        raise HTTPException(400, f"Directory does not exist: {raw_path}")
    get_settings().cubos_path = path
    ensure_cubos_imports(path)
    return SettingsResponse(cubos_path=str(path.resolve()))


@router.post("/browse")
def browse_directory() -> SettingsResponse:
    """Open a native directory picker and return the selected path."""
    if sys.platform == "darwin":
        script = (
            'POSIX path of (choose folder with prompt "Select CubOS directory")'
        )
        result = subprocess.run(
            ["osascript", "-e", script],
            capture_output=True,
            text=True,
            timeout=120,
        )
        if result.returncode != 0:
            raise HTTPException(400, "No directory selected")
        selected = result.stdout.strip().rstrip("/")
    else:
        # Fallback: tkinter for Linux/Windows
        import tkinter as tk
        from tkinter import filedialog

        root = tk.Tk()
        root.withdraw()
        selected = filedialog.askdirectory(title="Select CubOS directory")
        root.destroy()
        if not selected:
            raise HTTPException(400, "No directory selected")

    return SettingsResponse(cubos_path=selected)
