"""Architecture guardrails for Zoo's CubOS wrapper boundary."""

from __future__ import annotations

from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[1]
ROUTERS_ROOT = PROJECT_ROOT / "zoo" / "routers"


def test_zoo_routers_do_not_own_gantry_session_primitives() -> None:
    forbidden = (
        "from gantry import Gantry",
        "from gantry.gantry import Gantry",
        "threading.Lock",
        "_gantry:",
        "_gantry =",
        "._gantry",
        "_serial_lock",
    )
    offenders: list[str] = []
    for path in sorted(ROUTERS_ROOT.glob("*.py")):
        text = path.read_text(encoding="utf-8")
        for token in forbidden:
            if token in text:
                offenders.append(f"{path.relative_to(PROJECT_ROOT)} contains {token!r}")
    assert offenders == []


def test_protocol_router_does_not_import_legacy_run_protocol() -> None:
    text = (ROUTERS_ROOT / "protocol.py").read_text(encoding="utf-8")
    assert "protocol_engine.setup import run_protocol" not in text


def test_data_router_does_not_embed_cubos_schema_sql() -> None:
    text = (ROUTERS_ROOT / "data.py").read_text(encoding="utf-8")
    forbidden = (
        "import sqlite3",
        "SELECT ",
        "INSERT INTO",
        "asmi_measurements",
        "uvvis_measurements",
        "potentiostat_measurements",
    )
    offenders = [token for token in forbidden if token in text]
    assert offenders == []
