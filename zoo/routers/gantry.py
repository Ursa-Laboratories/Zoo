"""Gantry config + position API endpoints."""

import logging
import threading
import time
from typing import Optional

from fastapi import APIRouter, HTTPException
from gantry import Gantry
from pydantic import BaseModel

from zoo.config import get_settings
from zoo.models.gantry import GantryConfig, GantryPosition, GantryResponse
from zoo.services.yaml_io import list_configs, read_yaml, resolve_config_path, write_yaml

router = APIRouter(prefix="/api/gantry", tags=["gantry"])

# Single Gantry instance shared across requests.
_gantry: Optional[Gantry] = None
# Serialize all serial port access so position polls and jogs don't collide.
_serial_lock = threading.Lock()
# Last known good position — returned when the lock is busy.
_last_position: Optional[GantryPosition] = None


@router.get("/configs")
def list_gantry_configs() -> list[str]:
    return list_configs(get_settings().configs_dir, "gantry")


@router.get("/position")
def get_position() -> GantryPosition:
    global _last_position
    if _gantry is None:
        return GantryPosition(connected=False, status="Not connected")
    acquired = _serial_lock.acquire(blocking=False)
    if not acquired:
        # Lock is busy (move or jog in progress). Read cached status from the
        # driver — it updates last_status during wait_for_completion, so the
        # status word stays fresh even while the lock is held.
        status = _gantry._extract_status()
        if _last_position is not None:
            return GantryPosition(
                x=_last_position.x,
                y=_last_position.y,
                z=_last_position.z,
                work_x=_last_position.work_x,
                work_y=_last_position.work_y,
                work_z=_last_position.work_z,
                status=status,
                connected=True,
            )
        return GantryPosition(connected=True, status=status)
    try:
        info = _gantry.get_position_info()
        coords = info["coords"]
        wpos = info["work_pos"]
        _last_position = GantryPosition(
            x=coords["x"],
            y=coords["y"],
            z=coords["z"],
            work_x=wpos["x"] if wpos else None,
            work_y=wpos["y"] if wpos else None,
            work_z=wpos["z"] if wpos else None,
            status=info["status"],
            connected=True,
        )
        return _last_position
    except Exception:
        if _last_position is not None:
            return _last_position
        return GantryPosition(connected=True, status="Query failed")
    finally:
        _serial_lock.release()


@router.post("/home")
def home() -> GantryPosition:
    """Home the gantry using the strategy from the loaded config.

    Dispatch lives in ``cubos.Gantry.home()``, which reads
    ``config['cnc']['homing_strategy']`` and routes to the correct
    driver call (``xy_hard_limits`` → XY-only, ``standard`` → full home).
    """
    if _gantry is None:
        raise HTTPException(400, "Gantry not connected")
    with _serial_lock:
        try:
            _gantry.home()
        except Exception as e:
            raise HTTPException(500, f"Homing failed: {e}")
    return get_position()


class JogRequest(BaseModel):
    x: float = 0.0
    y: float = 0.0
    z: float = 0.0


@router.post("/jog")
def jog(req: JogRequest) -> dict:
    """Jog the gantry by a relative offset using GRBL's $J= command."""
    if _gantry is None:
        raise HTTPException(400, "Gantry not connected")
    if req.x == 0 and req.y == 0 and req.z == 0:
        return {"status": "ok"}
    with _serial_lock:
        try:
            _gantry.jog(x=req.x, y=req.y, z=req.z)
        except Exception as e:
            logging.warning("Jog error (non-fatal): %s", e)
    return {"status": "ok"}


class MoveToRequest(BaseModel):
    x: float
    y: float
    z: float


_move_error: Optional[str] = None


def _move_worker(x: float, y: float, z: float) -> None:
    """Run move_to in a background thread so position polls can interleave."""
    global _move_error
    _move_error = None
    try:
        with _serial_lock:
            _gantry.move_to(x=x, y=y, z=z)
    except Exception as e:
        _move_error = str(e)
        logging.error("Move failed: %s", e)


@router.post("/move-to")
def move_to(req: MoveToRequest) -> dict:
    """Move the gantry to absolute coordinates using safe_move."""
    if _gantry is None:
        raise HTTPException(400, "Gantry not connected")
    thread = threading.Thread(target=_move_worker, args=(req.x, req.y, req.z), daemon=True)
    thread.start()
    return {"status": "ok"}


@router.post("/unlock")
def unlock() -> GantryPosition:
    """Send GRBL $X unlock command to clear alarm state."""
    if _gantry is None:
        raise HTTPException(400, "Gantry not connected")
    with _serial_lock:
        try:
            _gantry.unlock()
        except Exception as e:
            raise HTTPException(500, f"Unlock failed: {e}")
    return get_position()


@router.post("/connect")
def connect() -> GantryPosition:
    """Open the serial connection and verify the mill is responding.

    Holds ``_serial_lock`` for the entire connect sequence — the Mill's
    auto-detect, GRBL verification, WPos-mode enforcement, and WCO seeding
    all chatter on the serial port. The frontend polls ``/position`` every
    200 ms, and until we're holding the lock, every one of those polls
    will race us for GRBL's response bytes. Seen in the wild: a concurrent
    ``?`` from the poll consumed the response to our ``G90``, causing
    ``_enforce_wpos_mode`` to fail, which snowballed into
    ``current_coordinates`` timing out, which tripped the outer
    ``except``, which nulled ``_gantry`` — UI shows "Not connected"
    immediately after a user click-Home race.

    Also defers the module-level ``_gantry`` assignment until connect has
    fully succeeded, so position polls see ``None`` (and return a clean
    "Not connected") during the connect window instead of trying to touch
    a half-initialized mill.
    """
    global _gantry
    with _serial_lock:
        try:
            gantry_configs = list_configs(get_settings().configs_dir, "gantry")
            config = {}
            if gantry_configs:
                config = read_yaml(resolve_config_path(get_settings().configs_dir, "gantry", gantry_configs[0]))
            # Stage the Gantry locally; publish to the module global only on
            # success so /position sees _gantry=None until we're ready, and
            # so a transient failure on reconnect doesn't clobber a prior
            # working connection.
            staged = Gantry(config=config)
            staged.connect()
            # Seed WCO cache — GRBL sends WCO in one of the first few status reports.
            for _ in range(10):
                info = staged.get_position_info()
                if info["work_pos"] is not None:
                    break
                time.sleep(0.1)
        except Exception as e:
            raise HTTPException(500, f"Failed to connect: {e}")
        _gantry = staged
    # get_position() acquires _serial_lock itself; call it outside the
    # `with` block so we don't try to re-acquire a non-reentrant lock,
    # which would fall through to the cached path and return a degraded
    # response (no coords) on the very first post-connect frame.
    return get_position()


@router.post("/disconnect")
def disconnect() -> GantryPosition:
    global _gantry
    if _gantry is None:
        return GantryPosition(connected=False, status="Disconnected")
    # Clear the module global inside the lock so concurrent /position
    # polls don't see _gantry set to a mill object that's mid-disconnect.
    with _serial_lock:
        try:
            _gantry.disconnect()
        finally:
            _gantry = None
    return GantryPosition(connected=False, status="Disconnected")


@router.get("/{filename}")
def get_gantry(filename: str) -> GantryResponse:
    path = resolve_config_path(get_settings().configs_dir, "gantry", filename)
    if not path.is_file():
        raise HTTPException(404, f"Config not found: {filename}")
    data = read_yaml(path)
    config = GantryConfig.model_validate(data)
    return GantryResponse(filename=filename, config=config)


@router.put("/{filename}")
def put_gantry(filename: str, body: dict) -> GantryResponse:
    path = resolve_config_path(get_settings().configs_dir, "gantry", filename)
    write_yaml(path, body)
    return get_gantry(filename)
