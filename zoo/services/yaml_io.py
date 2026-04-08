"""Read/write YAML config files safely."""

from __future__ import annotations

from pathlib import Path
from typing import Any, Dict, List, Optional

import yaml


def read_yaml(path: Path) -> Dict[str, Any]:
    with path.open() as f:
        data = yaml.safe_load(f)
    return data if data is not None else {}


def write_yaml(path: Path, data: Dict[str, Any]) -> None:
    with path.open("w") as f:
        yaml.dump(data, f, default_flow_style=False, sort_keys=False, allow_unicode=True)


def classify_config(data: Dict[str, Any]) -> Optional[str]:
    """Classify a YAML config by its top-level keys."""
    if "labware" in data:
        return "deck"
    if "instruments" in data:
        return "board"
    if "working_volume" in data:
        return "gantry"
    if "protocol" in data:
        return "protocol"
    return None


def resolve_config_path(configs_dir: Path, kind: str, filename: str) -> Path:
    """Return the full path for a config file, using the subdirectory if it exists."""
    sub = configs_dir / kind
    if sub.is_dir():
        return sub / filename
    return configs_dir / filename


def list_configs(configs_dir: Path, kind: str) -> List[str]:
    """List YAML filenames for the given kind.

    Checks ``configs_dir/<kind>/`` first (CubOS's standard layout),
    then falls back to a flat scan of ``configs_dir/`` with content-based
    classification.
    """
    sub = configs_dir / kind
    if sub.is_dir():
        return sorted(p.name for p in sub.glob("*.yaml"))

    # Fallback: flat directory with content-based classification.
    results = []
    if not configs_dir.is_dir():
        return results
    for p in sorted(configs_dir.glob("*.yaml")):
        try:
            data = read_yaml(p)
            if classify_config(data) == kind:
                results.append(p.name)
        except Exception:
            continue
    return results
