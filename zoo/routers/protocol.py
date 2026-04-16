"""Protocol router: CRUD for protocol YAML files + command registry.

Commands are introspected from CubOS's CommandRegistry at runtime,
so any new @protocol_command in CubOS is automatically available.
"""

from __future__ import annotations

import logging
from typing import Any, Dict, List

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
    return list_configs(get_settings().configs_dir, "protocol")


@router.get("/{filename}")
def get_protocol(filename: str) -> ProtocolResponse:
    path = resolve_config_path(get_settings().configs_dir, "protocol", filename)
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
    path = resolve_config_path(get_settings().configs_dir, "protocol", filename)
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


@router.post("/run")
def run_protocol_endpoint(body: RunProtocolRequest) -> dict:
    """Run a protocol with all four configs and the connected gantry.

    Holds ``_serial_lock`` for the entire protocol duration. The gantry
    router's position endpoint detects the busy lock and falls back to
    ``Gantry.get_cached_position_info()``, which reads Mill's internal
    WPos cache — no serial contention with the in-flight motion.
    """
    from zoo.routers.gantry import _gantry, _serial_lock

    settings = get_settings()
    gantry_path = resolve_config_path(settings.configs_dir, "gantry", body.gantry_file)
    deck_path = resolve_config_path(settings.configs_dir, "deck", body.deck_file)
    board_path = resolve_config_path(settings.configs_dir, "board", body.board_file)
    protocol_path = resolve_config_path(settings.configs_dir, "protocol", body.protocol_file)

    if _gantry is None or not _gantry.is_healthy():
        raise HTTPException(400, "Gantry is not connected")

    try:
        with _serial_lock:
            results = run_protocol(
                str(gantry_path), str(deck_path), str(board_path), str(protocol_path),
                gantry=_gantry,
            )
    except SetupValidationError as exc:
        raise HTTPException(400, str(exc))
    except Exception as exc:
        logging.exception("Protocol execution failed")
        raise HTTPException(500, f"Execution failed: {exc}")

    return {"status": "ok", "steps_executed": len(results)}
