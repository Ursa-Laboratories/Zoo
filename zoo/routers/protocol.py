"""Protocol router: CRUD for protocol YAML files + command registry.

Commands are introspected from CubOS's CommandRegistry at runtime,
so any new @protocol_command in CubOS is automatically available.
"""

from __future__ import annotations

import logging
import threading
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from protocol_engine.registry import CommandRegistry
from protocol_engine.setup import run_protocol
from validation.errors import SetupValidationError

# Side-effect import: triggers @protocol_command registration.
import protocol_engine.commands  # noqa: F401

from zoo.config import get_settings
from zoo.models.protocol import (
    CommandArg,
    CommandInfo,
    ProtocolConfig,
    ProtocolResponse,
    ProtocolStepConfig,
    ProtocolValidationResponse,
)
from zoo.services.yaml_io import list_configs, read_yaml, resolve_config_path, write_yaml

router = APIRouter(prefix="/api/protocol", tags=["protocol"])


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _type_name(annotation: Any) -> str:
    """Convert a Python type annotation to a simple string for the frontend."""
    name = getattr(annotation, "__name__", None)
    if name:
        return name
    return str(annotation)


def _build_command_info(name: str) -> CommandInfo:
    """Build a CommandInfo from a registered CubOS command."""
    registry = CommandRegistry.instance()
    cmd = registry.get(name)
    args = []
    for field_name, field_info in cmd.schema.model_fields.items():
        args.append(
            CommandArg(
                name=field_name,
                type=_type_name(field_info.annotation),
                required=field_info.is_required(),
                default=None if field_info.is_required() else field_info.default,
            )
        )
    return CommandInfo(
        name=cmd.name,
        description=(cmd.handler.__doc__ or "").strip(),
        args=args,
    )


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------


@router.get("/commands")
def get_commands() -> List[CommandInfo]:
    """Return all registered protocol commands with their argument schemas."""
    registry = CommandRegistry.instance()
    return [_build_command_info(name) for name in registry.command_names]


@router.get("/commands/{name}")
def get_command(name: str) -> CommandInfo:
    """Return schema for a single protocol command."""
    registry = CommandRegistry.instance()
    if name not in registry.command_names:
        raise HTTPException(404, f"Unknown command '{name}'")
    return _build_command_info(name)


@router.get("/configs")
def list_protocol_configs() -> List[str]:
    return list_configs(get_settings().campaign_dir, "protocol")


@router.get("/{filename}")
def get_protocol(filename: str) -> ProtocolResponse:
    path = resolve_config_path(get_settings().campaign_dir, "protocol", filename)
    if not path.is_file():
        raise HTTPException(404, f"Protocol file not found: {filename}")
    data = read_yaml(path)
    if "protocol" not in data or not isinstance(data["protocol"], list):
        raise HTTPException(400, f"File '{filename}' is not a valid protocol YAML")

    steps = []
    for raw_step in data["protocol"]:
        if not isinstance(raw_step, dict) or len(raw_step) != 1:
            continue
        cmd_name = next(iter(raw_step))
        args = raw_step[cmd_name] or {}
        steps.append(ProtocolStepConfig(command=cmd_name, args=args))

    return ProtocolResponse(filename=filename, steps=steps)


@router.put("/{filename}")
def save_protocol(filename: str, body: ProtocolConfig) -> dict:
    path = resolve_config_path(get_settings().campaign_dir, "protocol", filename)
    # Convert to YAML-native format: list of {command: {args}}
    protocol_list = []
    for step in body.protocol:
        protocol_list.append({step.command: step.args if step.args else None})
    write_yaml(path, {"protocol": protocol_list})
    return {"status": "ok", "filename": filename}


@router.post("/validate")
def validate_protocol(body: ProtocolConfig) -> ProtocolValidationResponse:
    """Validate a protocol against CubOS's command schemas."""
    registry = CommandRegistry.instance()
    errors: List[str] = []
    for i, step in enumerate(body.protocol):
        if step.command not in registry.command_names:
            errors.append(
                f"Step {i}: Unknown command '{step.command}'. "
                f"Available: {', '.join(registry.command_names)}"
            )
            continue

        cmd = registry.get(step.command)
        try:
            cmd.schema.model_validate(step.args)
        except Exception as e:
            errors.append(f"Step {i} ({step.command}): {e}")

    return ProtocolValidationResponse(valid=len(errors) == 0, errors=errors)


class RunProtocolRequest(BaseModel):
    gantry_file: str
    deck_file: str
    board_file: str
    protocol_file: str
    dry_run: bool = False


# ── Background protocol execution state ───────────────────────────────

_run_lock = threading.Lock()
_run_status: str = "idle"          # idle | running | done | error
_run_steps: int = 0
_run_error: Optional[str] = None


class _LockedGantry:
    """Proxy that wraps every method call with _serial_lock.

    Ensures protocol serial calls and position-poll serial calls
    never collide, while keeping the lock held only for the duration
    of each individual call so position updates stay responsive.
    """

    def __init__(self, gantry: Any, lock: threading.Lock) -> None:
        self._gantry = gantry
        self._lock = lock

    def __getattr__(self, name: str) -> Any:
        attr = getattr(self._gantry, name)
        if not callable(attr):
            return attr

        def locked(*args: Any, **kwargs: Any) -> Any:
            with self._lock:
                return attr(*args, **kwargs)

        return locked


def _run_worker(
    gantry_path: str,
    deck_path: str,
    board_path: str,
    protocol_path: str,
    gantry: Any,
    mock_mode: bool,
) -> None:
    global _run_status, _run_steps, _run_error
    try:
        results = run_protocol(
            gantry_path, deck_path, board_path, protocol_path,
            gantry=gantry, mock_mode=mock_mode,
        )
        _run_steps = len(results)
        _run_status = "done"
    except SetupValidationError as exc:
        _run_error = str(exc)
        _run_status = "error"
    except Exception as exc:
        logging.exception("Protocol execution failed")
        _run_error = f"Execution failed: {exc}"
        _run_status = "error"


@router.post("/run")
def run_protocol_endpoint(body: RunProtocolRequest) -> dict:
    """Start protocol execution in a background thread.

    Returns immediately so position polling stays responsive.
    Use GET /api/protocol/run/status to track progress.

    When ``dry_run`` is True, instruments are swapped for mock variants so
    measurement methods are no-ops, but the real gantry still performs all moves.
    """
    global _run_status, _run_steps, _run_error

    from zoo.routers.gantry import _gantry, _homed

    if _run_status == "running":
        raise HTTPException(409, "A protocol is already running")

    settings = get_settings()
    gantry_path = resolve_config_path(settings.campaign_dir, "gantry", body.gantry_file)
    deck_path = resolve_config_path(settings.campaign_dir, "deck", body.deck_file)
    board_path = resolve_config_path(settings.campaign_dir, "board", body.board_file)
    protocol_path = resolve_config_path(settings.campaign_dir, "protocol", body.protocol_file)

    if _gantry is None or not _gantry.is_healthy():
        raise HTTPException(400, "Gantry is not connected")
    if not _homed:
        raise HTTPException(400, "Gantry must be homed before running a protocol — position is uncalibrated")

    _run_status = "running"
    _run_steps = 0
    _run_error = None

    from zoo.routers.gantry import _serial_lock
    locked_gantry = _LockedGantry(_gantry, _serial_lock)

    thread = threading.Thread(
        target=_run_worker,
        args=(
            str(gantry_path), str(deck_path), str(board_path), str(protocol_path),
            locked_gantry, body.dry_run,
        ),
        daemon=True,
    )
    thread.start()

    return {"status": "running"}


@router.get("/run/status")
def run_status() -> dict:
    """Poll the current protocol execution status."""
    if _run_status == "error":
        return {"status": "error", "error": _run_error}
    if _run_status == "done":
        return {"status": "done", "steps_executed": _run_steps}
    return {"status": _run_status}
