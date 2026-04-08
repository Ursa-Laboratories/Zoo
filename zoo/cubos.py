"""Helpers for loading CubOS from Zoo's configured local checkout."""

from __future__ import annotations

import sys
from pathlib import Path

from zoo.config import get_settings


def ensure_cubos_imports(cubos_path: Path | None = None) -> Path:
    """Put CubOS's ``src`` directory first on ``sys.path``.

    CubOS currently exposes packages like ``board`` and ``deck`` at top level,
    so Zoo must choose the intended checkout before router modules import them.
    """
    root = cubos_path or get_settings().cubos_path
    src = root / "src"
    src_text = str(src)
    sys.path[:] = [entry for entry in sys.path if entry != src_text]
    sys.path.insert(0, src_text)
    return src
