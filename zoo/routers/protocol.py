"""Protocol router: CRUD for protocol YAML files + command registry.

Commands are introspected from CubOS's CommandRegistry at runtime,
so any new @protocol_command in CubOS is automatically available.
"""

from __future__ import annotations

import logging
from typing import Any, Dict, List

from data import DataStore
from deck.deck import Deck
from deck.loader import load_deck_from_yaml_safe
from fastapi import APIRouter, HTTPException
from gantry.loader import load_gantry_from_yaml_safe
from pydantic import BaseModel
from protocol_engine.registry import CommandRegistry
from protocol_engine.setup import run_protocol
from protocol_engine.setup_validator import run_setup_validation
from validation.errors import SetupValidationError

# Side-effect import: triggers @protocol_command registration.
import protocol_engine.commands  # noqa: F401

from zoo.config import get_settings
from zoo.models.protocol import (
    CommandArg,
    CommandInfo,
    ProtocolConfig,
    ProtocolResponse,
    ProtocolSetupValidationRequest,
    ProtocolSetupValidationResponse,
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


def _register_campaign_labware(
    data_store: DataStore,
    campaign_id: int,
    deck: Deck,
) -> None:
    for labware_key, labware in deck.labware.items():
        _register_labware_path(data_store, campaign_id, labware_key, labware)


def _register_labware_path(
    data_store: DataStore,
    campaign_id: int,
    labware_key: str,
    labware: Any,
) -> None:
    try:
        data_store.register_labware(campaign_id, labware_key, labware)
    except TypeError:
        pass

    for child_name, child in getattr(labware, "contained_labware", {}).items():
        _register_labware_path(
            data_store,
            campaign_id,
            f"{labware_key}.{child_name}",
            child,
        )


def _create_campaign_for_run(
    data_store: DataStore,
    *,
    gantry_path: str,
    deck_path: str,
    gantry_file: str,
    deck_file: str,
    protocol_file: str,
) -> int:
    campaign_id = data_store.create_campaign(
        description=(
            f"Zoo protocol run: gantry={gantry_file}, deck={deck_file}, "
            f"protocol={protocol_file}"
        ),
        deck_config=deck_file,
        gantry_config=gantry_file,
        protocol_config=protocol_file,
    )
    gantry_config = load_gantry_from_yaml_safe(gantry_path)
    deck = load_deck_from_yaml_safe(
        deck_path,
        factory_z_travel_mm=gantry_config.factory_z_travel_mm,
    )
    _register_campaign_labware(data_store, campaign_id, deck)
    return campaign_id


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
    try:
        data = read_yaml(path)
    except ValueError as e:
        raise HTTPException(400, str(e))
    if "protocol" not in data or not isinstance(data["protocol"], list):
        raise HTTPException(400, f"File '{filename}' is not a valid protocol YAML")

    steps = []
    for raw_step in data["protocol"]:
        if not isinstance(raw_step, dict) or len(raw_step) != 1:
            continue
        cmd_name = next(iter(raw_step))
        args = raw_step[cmd_name] or {}
        steps.append(ProtocolStepConfig(command=cmd_name, args=args))

    positions = data.get("positions")
    if not isinstance(positions, dict):
        positions = None

    return ProtocolResponse(filename=filename, positions=positions, steps=steps)


@router.put("/{filename}")
def save_protocol(filename: str, body: ProtocolConfig) -> dict:
    path = resolve_config_path(get_settings().configs_dir, "protocol", filename)
    # Convert to YAML-native format: list of {command: {args}}
    protocol_list = []
    for step in body.protocol:
        protocol_list.append({step.command: step.args if step.args else None})
    data: Dict[str, Any] = {}
    if body.positions is not None:
        data["positions"] = body.positions
    data["protocol"] = protocol_list
    write_yaml(path, data)
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


@router.post("/validate-setup")
def validate_protocol_setup(
    body: ProtocolSetupValidationRequest,
) -> ProtocolSetupValidationResponse:
    """Run full CubOS gantry/deck/protocol setup validation."""
    settings = get_settings()
    gantry_path = resolve_config_path(settings.configs_dir, "gantry", body.gantry_file)
    deck_path = resolve_config_path(settings.configs_dir, "deck", body.deck_file)
    protocol_path = resolve_config_path(settings.configs_dir, "protocol", body.protocol_file)

    try:
        result = run_setup_validation(
            str(gantry_path),
            str(deck_path),
            str(protocol_path),
        )
    except Exception as exc:
        logging.exception("Setup validation failed unexpectedly")
        raise HTTPException(500, f"Setup validation failed: {exc}") from exc

    return ProtocolSetupValidationResponse(
        valid=result.passed,
        errors=list(result.errors),
        output=result.output,
    )


class RunProtocolRequest(BaseModel):
    gantry_file: str
    deck_file: str
    protocol_file: str


def _looks_like_feed_hold_timeout(exc: Exception) -> bool:
    message = str(exc).lower()
    return (
        "command execution timed out" in message
        and "executing command !" in message
    )


@router.post("/cancel")
def cancel_protocol_run() -> dict:
    """Request immediate feed hold for the active protocol run."""
    from zoo.routers import gantry as gantry_router

    if gantry_router._gantry is None:
        raise HTTPException(400, "Gantry is not connected")
    try:
        # This is an interrupt path for a run that may currently hold
        # _serial_lock. Taking that lock here would make cancel wait for
        # normal completion, so send CubOS/GRBL feed hold immediately.
        gantry_router._gantry.stop()
    except Exception as exc:
        if _looks_like_feed_hold_timeout(exc):
            logging.warning(
                "Protocol cancel feed hold timed out after being sent: %s",
                exc,
            )
            return {
                "status": "cancel_requested",
                "warning": "Feed hold was sent, but the controller did not acknowledge before the read timeout.",
            }
        logging.exception("Protocol cancel failed")
        raise HTTPException(500, f"Cancel failed: {exc}") from exc
    return {"status": "cancel_requested"}


@router.post("/run")
def run_protocol_endpoint(body: RunProtocolRequest) -> dict:
    """Run a protocol with gantry/deck/protocol configs and the connected gantry.

    Holds ``_serial_lock`` for the full duration of the run so the
    frontend's 200 ms ``/position`` poll cannot race the protocol's
    G-code writes on the same serial port. Without this, the two
    threads alternately wrote ``?`` and motion commands, corrupting
    GRBL responses and ultimately getting the serial driver to close
    the port (``read failed: [Errno 9] Bad file descriptor``).

    The position endpoint's non-blocking ``acquire`` falls through to
    ``_last_position``/``_extract_status`` while the lock is held —
    the UI freezes on its last known coords during a run (acceptable)
    rather than crashing the run.
    """
    from zoo.routers import gantry as gantry_router

    settings = get_settings()
    gantry_path = resolve_config_path(settings.configs_dir, "gantry", body.gantry_file)
    deck_path = resolve_config_path(settings.configs_dir, "deck", body.deck_file)
    protocol_path = resolve_config_path(settings.configs_dir, "protocol", body.protocol_file)

    if gantry_router._gantry is None:
        raise HTTPException(400, "Gantry is not connected")

    # is_healthy() writes `?` to the serial port; it has to run inside
    # the lock or a concurrent /position poll (200 ms cadence) will race
    # it the same way it races run_protocol — the whole point of the
    # lock on this endpoint.
    try:
        with gantry_router._serial_lock:
            if gantry_router._calibration_warning:
                raise HTTPException(
                    400,
                    "Gantry calibration warning is active. Calibration and jog "
                    "recovery remain available, but protocol runs are blocked "
                    "until the selected gantry YAML matches the controller. "
                    f"{gantry_router._calibration_warning}",
                )
            if not gantry_router._gantry.is_healthy():
                raise HTTPException(400, "Gantry is not connected")
            data_store = DataStore()
            try:
                campaign_id = _create_campaign_for_run(
                    data_store,
                    gantry_path=str(gantry_path),
                    deck_path=str(deck_path),
                    gantry_file=body.gantry_file,
                    deck_file=body.deck_file,
                    protocol_file=body.protocol_file,
                )
                results = run_protocol(
                    str(gantry_path), str(deck_path), str(protocol_path),
                    gantry=gantry_router._gantry,
                    data_store=data_store,
                    campaign_id=campaign_id,
                )
            finally:
                data_store.close()
    except HTTPException:
        raise
    except SetupValidationError as exc:
        raise HTTPException(400, str(exc))
    except Exception as exc:
        logging.exception("Protocol execution failed")
        raise HTTPException(500, f"Execution failed: {exc}")

    return {
        "status": "ok",
        "steps_executed": len(results),
        "campaign_id": campaign_id,
    }
