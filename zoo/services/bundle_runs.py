"""Per-run bundle directories and helpers for ``POST /api/protocol/run-bundle``.

Ports the PiCub_protocol_sender station-worker contract into Zoo: a client
POSTs gantry/deck/protocol YAML text plus a ``run_id``; Zoo stages the bundle
in a per-run directory (never the shared config library), executes it, and
stores result/error JSON alongside the inputs for replay and audit.

Layout for run_id ``plate_001:A1:asmi``::

    <bundle_runs_dir>/plate_001_A1_asmi/
        gantry.yaml
        deck.yaml
        protocol.yaml
        result.json        (on success)
        error.txt          (on failure)
        meta.json          (run_id, timestamps, sha256s, metadata, mock_mode)
"""

from __future__ import annotations

import dataclasses
import datetime as _dt
import hashlib
import json
import re
from pathlib import Path
from typing import Any, Dict, List, Optional

_SAFE_RE = re.compile(r"[^A-Za-z0-9_.\-]+")

_PRIMITIVES = (str, int, float, bool, type(None))
_MAX_DEPTH = 25


def sanitize_run_id(run_id: str) -> str:
    cleaned = _SAFE_RE.sub("_", run_id.strip())
    # A name of only dots ("..") would resolve outside the base directory.
    cleaned = cleaned.strip(".") or "run"
    return cleaned[:200]


def sha256_text(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


class BundleRunDir:
    def __init__(self, base_dir: Path, run_id: str, *, create: bool = True):
        base = Path(base_dir).expanduser()
        self.run_id = run_id
        self.name = sanitize_run_id(run_id)
        self.dir = base / self.name
        if self.dir.resolve().parent != base.resolve():
            raise ValueError(f"Invalid run_id: {run_id!r}")
        if create:
            self.dir.mkdir(parents=True, exist_ok=True)

    @property
    def exists(self) -> bool:
        return self.dir.exists()

    # paths
    @property
    def gantry_path(self) -> Path:
        return self.dir / "gantry.yaml"

    @property
    def deck_path(self) -> Path:
        return self.dir / "deck.yaml"

    @property
    def protocol_path(self) -> Path:
        return self.dir / "protocol.yaml"

    @property
    def result_path(self) -> Path:
        return self.dir / "result.json"

    @property
    def error_path(self) -> Path:
        return self.dir / "error.txt"

    @property
    def meta_path(self) -> Path:
        return self.dir / "meta.json"

    # writes
    def write_inputs(
        self, *, gantry_yaml: str, deck_yaml: str, protocol_yaml: str
    ) -> Dict[str, str]:
        self.gantry_path.write_text(gantry_yaml)
        self.deck_path.write_text(deck_yaml)
        self.protocol_path.write_text(protocol_yaml)
        return {
            "gantry_sha256": sha256_text(gantry_yaml),
            "deck_sha256": sha256_text(deck_yaml),
            "protocol_sha256": sha256_text(protocol_yaml),
        }

    def write_meta(self, meta: Dict[str, Any]) -> None:
        self.meta_path.write_text(json.dumps(meta, indent=2, default=str, sort_keys=True))

    def write_result(self, result: Dict[str, Any]) -> None:
        self.result_path.write_text(json.dumps(result, indent=2, default=str, sort_keys=True))

    def write_error(self, error: str) -> None:
        self.error_path.write_text(error)

    # reads
    def read_meta(self) -> Optional[Dict[str, Any]]:
        if self.meta_path.exists():
            return json.loads(self.meta_path.read_text())
        return None

    def read_result(self) -> Optional[Dict[str, Any]]:
        if self.result_path.exists():
            return json.loads(self.result_path.read_text())
        return None

    def read_error(self) -> Optional[str]:
        return self.error_path.read_text() if self.error_path.exists() else None

    def read_protocol(self) -> Optional[str]:
        return self.protocol_path.read_text() if self.protocol_path.exists() else None


def run_bundle_mock(
    *, gantry_path: Path, deck_path: Path, protocol_path: Path
) -> List[Any]:
    """Execute a staged bundle on CubOS offline drivers (no hardware).

    Mirrors the PiCub station worker's mock path: ``setup_protocol`` with
    ``gantry=None, mock_mode=True`` constructs offline drivers, no GRBL serial
    port is opened, and ``connect_instruments`` is a no-op for them.
    """
    from protocol_engine.setup import setup_protocol  # noqa: PLC0415 — heavy CubOS import

    protocol, context = setup_protocol(
        str(gantry_path), str(deck_path), str(protocol_path), gantry=None, mock_mode=True
    )
    context.gantry.connect_instruments()
    try:
        return protocol.execute(context)
    finally:
        context.gantry.disconnect_instruments()


def to_jsonable(obj: Any, _depth: int = 0) -> Any:
    """Convert arbitrary CubOS per-step results to JSON-native types.

    CubOS command results are a mix of plain dicts, dataclasses, ``None``
    (home/move), and ``scan``-style ``{well: result}`` mappings, possibly with
    numpy scalars/arrays.
    """
    if _depth > _MAX_DEPTH:
        return repr(obj)

    if isinstance(obj, _PRIMITIVES):
        return obj

    if isinstance(obj, (bytes, bytearray)):
        try:
            return obj.decode("utf-8")
        except UnicodeDecodeError:
            return obj.hex()

    if isinstance(obj, (_dt.datetime, _dt.date, _dt.time)):
        return obj.isoformat()

    if dataclasses.is_dataclass(obj) and not isinstance(obj, type):
        return {k: to_jsonable(v, _depth + 1) for k, v in dataclasses.asdict(obj).items()}

    if isinstance(obj, dict):
        return {str(k): to_jsonable(v, _depth + 1) for k, v in obj.items()}

    if isinstance(obj, (list, tuple, set, frozenset)):
        return [to_jsonable(v, _depth + 1) for v in obj]

    # numpy without importing numpy
    if hasattr(obj, "tolist") and obj.__class__.__module__.startswith("numpy"):
        try:
            return to_jsonable(obj.tolist(), _depth + 1)
        except Exception:  # noqa: BLE001
            pass
    if hasattr(obj, "item") and obj.__class__.__module__.startswith("numpy"):
        try:
            return obj.item()
        except Exception:  # noqa: BLE001
            pass

    if hasattr(obj, "__dict__"):
        d = {k: v for k, v in vars(obj).items() if not k.startswith("_")}
        if d:
            return {
                "__type__": type(obj).__name__,
                **{k: to_jsonable(v, _depth + 1) for k, v in d.items()},
            }

    return repr(obj)


__all__ = [
    "BundleRunDir",
    "run_bundle_mock",
    "sanitize_run_id",
    "sha256_text",
    "to_jsonable",
]
