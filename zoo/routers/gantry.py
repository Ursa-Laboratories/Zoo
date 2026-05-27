"""Gantry config + position API endpoints."""

import copy
import inspect
import logging
import math
import re
import threading
import time
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, HTTPException
from gantry import Gantry
from gantry.grbl_settings import normalize_expected_grbl_settings
from gantry.limit_recovery import (
    looks_like_limit_alarm,
    recover_from_limit_alarm,
)
from gantry.yaml_schema import GantryYamlSchema
from instruments.base_instrument import BaseInstrument
from instruments.pipette.models import PIPETTE_MODELS
from instruments.registry import (
    get_instrument_class,
    get_supported_types,
    get_supported_vendors,
)
from pydantic import BaseModel, ValidationError, model_validator

from zoo.config import get_settings
from zoo.models.gantry import GantryPosition, GantryResponse
from zoo.services.yaml_io import list_configs, read_yaml, resolve_config_path, write_yaml

router = APIRouter(prefix="/api/gantry", tags=["gantry"])

# Single Gantry instance shared across requests.
_gantry: Optional[Gantry] = None
# Serialize all serial port access so position polls and jogs don't collide.
_serial_lock = threading.Lock()
# Last known good position — returned when the lock is busy.
_last_position: Optional[GantryPosition] = None
# Non-blocking warning surfaced after connect when the controller settings do
# not match the selected gantry YAML. The connection stays open for calibration.
_calibration_warning: Optional[str] = None
# Full gantry config as loaded at connect time, including grbl_settings. Used to
# read configured GRBL values (e.g. homing_pull_off) and refresh calibration
# warnings after soft-limit changes.
_connected_gantry_config: Optional[Dict[str, Any]] = None
_connected_gantry_filename: Optional[str] = None
# During calibration, stale soft-limit travel can prevent the operator from
# jogging to the true origin. Track whether Zoo disabled $20 so a cancel/skip
# path can restore it.
_calibration_restore_soft_limits = False
_calibration_jog_bypass_working_volume = False

# Primitive types that can be represented in YAML / JSON form fields.
_PRIMITIVE_TYPES = {str, int, float, bool}

_BASE_PARAMS = {
    p for p in inspect.signature(BaseInstrument.__init__).parameters if p != "self"
}


def _looks_like_alarm_text(text: str) -> bool:
    return looks_like_limit_alarm(text)


def _looks_like_alarm_error(exc: Exception) -> bool:
    return _looks_like_alarm_text(str(exc))


def _alarm_http_exception(action: str) -> HTTPException:
    return HTTPException(
        409,
        f"Gantry entered an alarm state {action}. "
        "Run limit recovery before continuing.",
    )


def _alarm_status_from_error(exc: Exception) -> str:
    message = str(exc).strip()
    lower = message.lower()
    if "alarm" in lower:
        alarm_text = message[lower.index("alarm") :]
        return alarm_text.split()[0].strip(",.;")
    return message or "Alarm"


def _position_from_cache_with_status(status: str) -> GantryPosition:
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
            calibration_warning=_calibration_warning,
            move_error=_move_error,
        )
    return GantryPosition(
        connected=True,
        status=status,
        calibration_warning=_calibration_warning,
        move_error=_move_error,
    )


class PipetteModelInfo(BaseModel):
    name: str
    family: str
    channels: int
    max_volume: float
    min_volume: float


class InstrumentTypeInfo(BaseModel):
    type: str
    vendors: List[str]
    is_mock: bool


class InstrumentFieldInfo(BaseModel):
    name: str
    type: str
    required: bool
    default: Any = None
    choices: Optional[List[str]] = None


def _type_name(annotation: Any) -> str:
    """Convert a Python type annotation to a simple string."""
    name = getattr(annotation, "__name__", None)
    if name:
        return name
    return str(annotation)


def _is_primitive(annotation: Any) -> bool:
    """Check if an annotation is a JSON-serialisable primitive."""
    if annotation in _PRIMITIVE_TYPES:
        return True
    args = getattr(annotation, "__args__", ())
    if args and type(None) in args:
        return any(a in _PRIMITIVE_TYPES for a in args if a is not type(None))
    return False


def _build_instrument_fields(type_key: str) -> List[InstrumentFieldInfo]:
    """Introspect an instrument class's __init__ to build field metadata."""
    cls = get_instrument_class(type_key)
    sig = inspect.signature(cls.__init__)
    fields: List[InstrumentFieldInfo] = []
    for param_name, param in sig.parameters.items():
        if param_name == "self" or param_name in _BASE_PARAMS:
            continue
        annotation = param.annotation if param.annotation != inspect.Parameter.empty else str
        if not _is_primitive(annotation):
            continue
        required = param.default is inspect.Parameter.empty
        default = None if required else param.default
        choices = None
        if param_name == "pipette_model":
            choices = sorted(PIPETTE_MODELS.keys())
        fields.append(
            InstrumentFieldInfo(
                name=param_name,
                type=_type_name(annotation),
                required=required,
                default=default,
                choices=choices,
            )
        )
    return fields


def _float_or(value: Any, fallback: float) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return fallback


def _schema_fields(model: Any) -> set[str]:
    return set(getattr(model, "model_fields", {}) or {})


def _gantry_schema_fields() -> set[str]:
    return _schema_fields(GantryYamlSchema)


def _cnc_schema_fields() -> set[str]:
    cnc_field = getattr(GantryYamlSchema, "model_fields", {}).get("cnc")
    cnc_model = getattr(cnc_field, "annotation", None)
    return _schema_fields(cnc_model)


def _normalize_gantry_yaml(data: Dict[str, Any]) -> Dict[str, Any]:
    """Lift older Zoo gantry YAMLs into CubOS staging's gantry schema.

    Zoo still validates through CubOS after this compatibility pass. The pass
    is intentionally narrow: it removes the retired homing strategy and fills
    fields that CubOS now requires so operators can save a corrected file.
    """
    normalized = copy.deepcopy(data)
    gantry_fields = _gantry_schema_fields()
    cnc_fields = _cnc_schema_fields()
    working_volume = dict(normalized.get("working_volume") or {})
    z_min = _float_or(working_volume.get("z_min"), 0.0)
    z_max = _float_or(working_volume.get("z_max"), 80.0)
    if z_max <= 0:
        z_max = 80.0
    z_span = max(z_max - z_min, 0.0)

    cnc = dict(normalized.get("cnc") or {})
    cnc["homing_strategy"] = "standard"
    if cnc.get("y_axis_motion") not in {"head", "bed"}:
        cnc["y_axis_motion"] = "head"

    factory_z_travel = max(
        _float_or(
            cnc.get(
                "factory_z_travel_mm",
                cnc.get("total_z_range", cnc.get("total_z_height")),
            ),
            z_span,
        ),
        z_span,
    )
    if "factory_z_travel_mm" in cnc_fields:
        cnc["factory_z_travel_mm"] = factory_z_travel
    if "total_z_range" in cnc_fields:
        cnc["total_z_range"] = max(factory_z_travel, z_max)
    if "total_z_height" in cnc_fields:
        cnc["total_z_height"] = factory_z_travel
    if "structure_clearance_z" in cnc_fields and cnc.get("structure_clearance_z") is None:
        cnc["structure_clearance_z"] = factory_z_travel
    if cnc_fields:
        for key in list(cnc):
            if key not in cnc_fields:
                cnc.pop(key, None)

    normalized["cnc"] = cnc
    normalized["working_volume"] = working_volume
    if "gantry_type" in gantry_fields and "gantry_type" not in normalized:
        x_max = _float_or(working_volume.get("x_max"), 0.0)
        y_max = _float_or(working_volume.get("y_max"), 0.0)
        normalized["gantry_type"] = "cub_xl" if x_max > 310 or y_max > 220 else "cub"
    if "grbl_settings" in gantry_fields:
        normalized.setdefault("grbl_settings", {})
    else:
        normalized.pop("grbl_settings", None)
    if "instruments" in gantry_fields:
        if not isinstance(normalized.get("instruments"), dict):
            normalized["instruments"] = {}
        else:
            normalized.setdefault("instruments", {})
    else:
        normalized.pop("instruments", None)
    return normalized


def _validated_gantry_config(data: Dict[str, Any]) -> GantryYamlSchema:
    return GantryYamlSchema.model_validate(_normalize_gantry_yaml(data))


def _api_gantry_config(
    config: GantryYamlSchema,
    source_data: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """Return a frontend-friendly payload after CubOS schema validation."""
    payload = config.model_dump(mode="json", exclude_none=True)
    cnc = dict(payload.get("cnc") or {})
    source_cnc = dict((source_data or {}).get("cnc") or {})
    working_volume = dict(payload.get("working_volume") or {})
    z_span = max(
        _float_or(working_volume.get("z_max"), 0.0)
        - _float_or(working_volume.get("z_min"), 0.0),
        0.0,
    )
    if "factory_z_travel_mm" not in cnc:
        cnc["factory_z_travel_mm"] = max(
            _float_or(
                source_cnc.get(
                    "factory_z_travel_mm",
                    cnc.get("total_z_range", cnc.get("total_z_height")),
                ),
                z_span,
            ),
            z_span,
        )
    if (
        "calibration_block_height_mm" in source_cnc
        and "calibration_block_height_mm" not in cnc
    ):
        cnc["calibration_block_height_mm"] = source_cnc["calibration_block_height_mm"]
    payload["cnc"] = cnc
    return payload


def _clear_connected_gantry_state() -> None:
    """Drop stale connection state after a live serial query fails."""
    global _gantry, _last_position, _calibration_warning, _calibration_restore_soft_limits
    _gantry = None
    _last_position = None
    _calibration_warning = None
    _calibration_restore_soft_limits = False


def _runtime_connect_config(config: Dict[str, Any]) -> Dict[str, Any]:
    """Return a Gantry config that will not block connect on calibration drift."""
    runtime_config = copy.deepcopy(config)
    runtime_config.pop("grbl_settings", None)
    return runtime_config


def _refresh_connected_config(filename: str, config: Dict[str, Any]) -> None:
    """Refresh the in-memory Gantry config when the connected YAML is saved."""
    global _connected_gantry_config
    if _gantry is None or _connected_gantry_filename != filename:
        return
    _connected_gantry_config = copy.deepcopy(config)
    _gantry.config = _runtime_connect_config(config)


def _connected_grbl_setting(field_name: str) -> Optional[float]:
    """Return a numeric GRBL setting from the connected gantry YAML."""
    if _connected_gantry_config is None:
        return None
    settings = _connected_gantry_config.get("grbl_settings") or {}
    if not isinstance(settings, dict):
        return None
    value = settings.get(field_name)
    if value is None:
        return None
    try:
        numeric = float(value)
    except (TypeError, ValueError):
        raise HTTPException(
            400,
            f"Connected gantry grbl_settings.{field_name} must be numeric.",
        ) from None
    if not math.isfinite(numeric):
        raise HTTPException(
            400,
            f"Connected gantry grbl_settings.{field_name} must be finite.",
        )
    if field_name == "homing_pull_off" and numeric < 0:
        raise HTTPException(
            400,
            "Connected gantry grbl_settings.homing_pull_off must be non-negative.",
        )
    return numeric


def _apply_calibration_grbl_baseline() -> tuple[float, Optional[float]]:
    """Write $10=0 (WPos reporting) and $27 from configured homing_pull_off before
    calibration homing, so homed positions are in the WPos frame and the pull-off
    distance is consistent with the YAML."""
    if _gantry is None:
        raise HTTPException(400, "Gantry not connected")
    status_report = 0.0
    homing_pull_off = _connected_grbl_setting("homing_pull_off")
    _gantry.set_grbl_setting("$10", status_report)
    if homing_pull_off is not None:
        _gantry.set_grbl_setting("$27", homing_pull_off)
    return status_report, homing_pull_off


def _calibration_mismatch_warning(
    gantry: Gantry,
    config: Dict[str, Any],
) -> Optional[str]:
    expected = normalize_expected_grbl_settings(config.get("grbl_settings"))
    if not expected:
        return None

    try:
        live = gantry.read_grbl_settings()
    except Exception as exc:
        return (
            "Calibration status unknown: connected, but Zoo could not read "
            f"controller GRBL settings after connect ({exc}). Run calibration "
            "again before trusting coordinates or running protocols."
        )

    mismatches = []
    for code, expected_value in expected.items():
        live_raw = live.get(code)
        if live_raw is None:
            mismatches.append(f"{code}: expected {expected_value:g}, got missing")
            continue
        try:
            live_value = float(live_raw)
        except (TypeError, ValueError):
            mismatches.append(f"{code}: expected {expected_value:g}, got {live_raw}")
            continue
        if abs(live_value - float(expected_value)) > 0.001:
            mismatches.append(f"{code}: expected {expected_value:g}, got {live_value:g}")

    if not mismatches:
        return None
    return (
        "Calibration needed: connected, but controller GRBL settings differ "
        "from the selected gantry YAML. Run calibration again before trusting "
        "coordinates or running protocols. "
        + "; ".join(mismatches)
    )


def _connected_working_volume() -> Optional[Dict[str, float]]:
    """Return the connected gantry's configured working volume, if available."""
    if _gantry is None:
        return None
    config = getattr(_gantry, "config", None)
    volume: Any = None
    if isinstance(config, dict):
        volume = config.get("working_volume")
        if not isinstance(volume, dict):
            return None
        try:
            return {
                key: float(volume[key])
                for key in ("x_min", "x_max", "y_min", "y_max", "z_min", "z_max")
            }
        except (KeyError, TypeError, ValueError):
            return None

    volume = getattr(config, "working_volume", None)
    if volume is None:
        return None
    try:
        return {
            key: float(getattr(volume, key))
            for key in ("x_min", "x_max", "y_min", "y_max", "z_min", "z_max")
        }
    except (TypeError, ValueError):
        return None


def _validate_manual_move_target(req: "MoveToRequest") -> None:
    """Reject manual absolute moves outside the loaded gantry working volume."""
    for axis, value in (("X", req.x), ("Y", req.y), ("Z", req.z)):
        if not math.isfinite(value):
            raise HTTPException(400, f"Manual move {axis} target must be finite.")

    volume = _connected_working_volume()
    if volume is None:
        raise HTTPException(
            409,
            "Manual absolute moves require a loaded gantry working_volume. "
            "Reconnect with a valid gantry YAML before using Move To.",
        )

    violations = []
    for axis, value in (("x", req.x), ("y", req.y), ("z", req.z)):
        lower = volume[f"{axis}_min"]
        upper = volume[f"{axis}_max"]
        if value < lower or value > upper:
            violations.append(
                f"{axis.upper()}={value:g} outside [{lower:g}, {upper:g}]"
            )

    if violations:
        raise HTTPException(
            400,
            "Manual move target outside configured gantry working volume: "
            + "; ".join(violations),
        )


def _current_work_position_locked() -> Dict[str, float]:
    """Return current WPos-like coordinates while the serial lock is held."""
    if _gantry is None:
        raise HTTPException(400, "Gantry not connected")
    info = _gantry.get_position_info()
    raw = info.get("work_pos") or info.get("coords")
    if not isinstance(raw, dict):
        raise HTTPException(
            409,
            "Jog working-volume checks require current gantry position. "
            "Reconnect before jogging.",
        )
    try:
        return {axis: float(raw[axis]) for axis in ("x", "y", "z")}
    except (KeyError, TypeError, ValueError) as exc:
        raise HTTPException(
            409,
            "Jog working-volume checks require finite current gantry position. "
            "Reconnect before jogging.",
        ) from exc


def _validate_jog_target_locked(req: "JogRequest | JogBlockingRequest") -> None:
    """Reject normal relative jogs whose target would leave working_volume."""
    for axis, value in (("X", req.x), ("Y", req.y), ("Z", req.z)):
        if not math.isfinite(value):
            raise HTTPException(400, f"Jog {axis} delta must be finite.")
    if _calibration_jog_bypass_working_volume:
        return

    volume = _connected_working_volume()
    if volume is None:
        raise HTTPException(
            409,
            "Manual jogs require a loaded gantry working_volume. Reconnect with "
            "a valid gantry YAML before jogging.",
        )

    current = _current_work_position_locked()
    violations = []
    for axis, delta in (("x", req.x), ("y", req.y), ("z", req.z)):
        target = current[axis] + float(delta)
        lower = volume[f"{axis}_min"]
        upper = volume[f"{axis}_max"]
        if target < lower or target > upper:
            violations.append(
                f"{axis.upper()} target {target:g} outside [{lower:g}, {upper:g}]"
            )
    if violations:
        raise HTTPException(
            400,
            "Jog target outside configured gantry working volume: "
            + "; ".join(violations),
        )


@router.get("/configs")
def list_gantry_configs() -> list[str]:
    return list_configs(get_settings().configs_dir, "gantry")


@router.get("/instrument-types")
def list_instrument_types() -> List[InstrumentTypeInfo]:
    return [
        InstrumentTypeInfo(
            type=key,
            vendors=get_supported_vendors(key),
            is_mock=key.startswith("mock_"),
        )
        for key in get_supported_types()
    ]


@router.get("/pipette-models")
def list_pipette_models() -> List[PipetteModelInfo]:
    return [
        PipetteModelInfo(
            name=cfg.name,
            family=cfg.family.value,
            channels=cfg.channels,
            max_volume=cfg.max_volume,
            min_volume=cfg.min_volume,
        )
        for cfg in PIPETTE_MODELS.values()
    ]


@router.get("/instrument-schemas")
def get_instrument_schemas() -> Dict[str, List[InstrumentFieldInfo]]:
    """Return per-type field schemas introspected from CubOS instrument classes."""
    return {
        type_key: _build_instrument_fields(type_key)
        for type_key in get_supported_types()
    }


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
                calibration_warning=_calibration_warning,
                move_error=_move_error,
            )
        return GantryPosition(
            connected=True,
            status=status,
            calibration_warning=_calibration_warning,
            move_error=_move_error,
        )
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
            calibration_warning=_calibration_warning,
        )
        if _move_error:
            return _last_position.model_copy(update={"move_error": _move_error})
        return _last_position
    except Exception as exc:
        if _looks_like_alarm_error(exc):
            return _position_from_cache_with_status(_alarm_status_from_error(exc))
        logging.error("Position query failed: %s", exc)
        if _last_position is not None:
            # During calibration the frontend reads live position to compute Z math;
            # returning stale coords silently would poison the calibration result.
            if _calibration_jog_bypass_working_volume:
                return _position_from_cache_with_status("Query failed")
            return _last_position
        return GantryPosition(connected=True, status="Query failed")
    finally:
        _serial_lock.release()


@router.post("/home")
def home() -> GantryPosition:
    """Home the gantry using the strategy from the loaded config.

    Dispatch lives in ``cubos.Gantry.home()``, which reads
    ``config['cnc']['homing_strategy']`` and routes through CubOS's
    current standard homing behavior.
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
            _validate_jog_target_locked(req)
            _gantry.jog(x=req.x, y=req.y, z=req.z)
        except HTTPException:
            raise
        except Exception as e:
            logging.warning("Jog error: %s", e)
            if _looks_like_alarm_error(e):
                raise _alarm_http_exception("during jog")
            raise HTTPException(500, f"Jog failed: {e}")
    return {"status": "ok"}


class MoveToRequest(BaseModel):
    x: float
    y: float
    z: float


class SetWorkCoordinatesRequest(BaseModel):
    x: Optional[float] = None
    y: Optional[float] = None
    z: Optional[float] = None

    @model_validator(mode="after")
    def _at_least_one_axis(self) -> "SetWorkCoordinatesRequest":
        if self.x is None and self.y is None and self.z is None:
            raise ValueError("At least one axis must be supplied.")
        return self


class ConfigureSoftLimitsRequest(BaseModel):
    max_travel_x: float
    max_travel_y: float
    max_travel_z: float
    status_report: Optional[float] = None
    homing_pull_off: Optional[float] = None
    hard_limits: Optional[bool] = None
    tolerance_mm: float = 0.25


class GrblSettingsResponse(BaseModel):
    settings: Dict[str, str]


class SetGrblSettingRequest(BaseModel):
    setting: str
    value: str


class JogBlockingRequest(BaseModel):
    x: float = 0.0
    y: float = 0.0
    z: float = 0.0
    timeout_s: float = 10.0


class LimitRecoveryRequest(BaseModel):
    x: float = 0.0
    y: float = 0.0
    z: float = 0.0
    pull_off_mm: float = 5.0
    feed_rate: float = 2500.0


class LimitRecoveryResponse(BaseModel):
    status: str
    attempts: int
    pull_off: Dict[str, float]
    messages: List[str]


class CalibrationCenterResponse(BaseModel):
    xy_bounds: Dict[str, float]
    position: Dict[str, float]


class FinalizeOriginRequest(BaseModel):
    home_z: float
    block_touch_z: float
    block_height: float
    factory_z_travel: float
    tolerance_mm: float = 0.25


class FinalizeOriginResponse(BaseModel):
    measured_volume: Dict[str, float]
    z_calibration: Dict[str, Any]
    max_travel: Dict[str, float]
    position: Dict[str, float]
    homing_pull_off_mm: Optional[float] = None


def _wait_until_idle(*, timeout_s: float = 10.0, poll_interval_s: float = 0.1) -> None:
    """Block until CubOS reports the gantry is no longer jogging/running."""
    if _gantry is None:
        raise HTTPException(400, "Gantry not connected")
    deadline = time.monotonic() + timeout_s
    last_status = ""
    while time.monotonic() < deadline:
        try:
            last_status = str(_gantry.get_status())
        except Exception as exc:
            if _looks_like_alarm_error(exc):
                raise _alarm_http_exception("while waiting for motion to finish")
            raise HTTPException(500, f"Status wait failed: {exc}")
        lowered = last_status.lower()
        if "idle" in lowered:
            return
        if _looks_like_alarm_text(lowered):
            raise _alarm_http_exception("while waiting for motion to finish")
        if "error" in lowered:
            raise HTTPException(500, f"Gantry entered {last_status} while waiting for motion to finish")
        time.sleep(poll_interval_s)
    raise HTTPException(500, f"Timed out waiting for gantry to become idle; last status: {last_status}")


def _restore_calibration_soft_limits_if_needed() -> None:
    global _calibration_restore_soft_limits
    if _gantry is None or not _calibration_restore_soft_limits:
        return
    _gantry.set_soft_limits_enabled(True)
    _calibration_restore_soft_limits = False


def _normalize_grbl_setting_code(setting: str) -> str:
    raw = setting.strip()
    if not re.fullmatch(r"\$?\d+", raw):
        raise ValueError("GRBL setting must be a numeric code like $20 or 20.")
    return raw if raw.startswith("$") else f"${raw}"


def _parse_grbl_setting_value(value: str) -> float:
    raw = value.strip()
    if raw == "":
        raise ValueError("GRBL setting value cannot be empty.")
    if "\n" in raw or "\r" in raw:
        raise ValueError("GRBL setting value cannot contain newlines.")
    try:
        return float(raw)
    except ValueError as exc:
        raise ValueError("GRBL setting value must be numeric.") from exc


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
    _validate_manual_move_target(req)
    thread = threading.Thread(target=_move_worker, args=(req.x, req.y, req.z), daemon=True)
    thread.start()
    return {"status": "ok"}


@router.post("/move-to-blocking")
def move_to_blocking(req: MoveToRequest) -> GantryPosition:
    """Move to absolute coordinates and return only after CubOS finishes."""
    if _gantry is None:
        raise HTTPException(400, "Gantry not connected")
    _validate_manual_move_target(req)
    with _serial_lock:
        try:
            _gantry.move_to(x=req.x, y=req.y, z=req.z)
        except Exception as e:
            raise HTTPException(500, f"Move failed: {e}")
    return get_position()


@router.post("/jog-blocking")
def jog_blocking(req: JogBlockingRequest) -> GantryPosition:
    """Jog by a relative offset and block until the controller is idle."""
    if _gantry is None:
        raise HTTPException(400, "Gantry not connected")
    if req.x == 0 and req.y == 0 and req.z == 0:
        return get_position()
    with _serial_lock:
        try:
            _validate_jog_target_locked(req)
            _gantry.jog(x=req.x, y=req.y, z=req.z)
            _wait_until_idle(timeout_s=req.timeout_s)
        except HTTPException:
            raise
        except Exception as e:
            if _looks_like_alarm_error(e):
                raise _alarm_http_exception("during blocking jog")
            raise HTTPException(500, f"Jog failed: {e}")
    return get_position()


@router.post("/work-coordinates")
def set_work_coordinates(req: SetWorkCoordinatesRequest) -> GantryPosition:
    """Assign the current physical pose to the supplied CubOS WPos axis values."""
    if _gantry is None:
        raise HTTPException(400, "Gantry not connected")
    with _serial_lock:
        try:
            _gantry.set_work_coordinates(x=req.x, y=req.y, z=req.z)
        except Exception as e:
            raise HTTPException(500, f"Set work coordinates failed: {e}")
    return get_position()


@router.post("/soft-limits")
def configure_soft_limits(req: ConfigureSoftLimitsRequest) -> dict:
    """Program GRBL soft-limit travel spans through CubOS Gantry semantics."""
    global _calibration_jog_bypass_working_volume, _calibration_restore_soft_limits
    global _calibration_warning
    if _gantry is None:
        raise HTTPException(400, "Gantry not connected")
    with _serial_lock:
        try:
            hard_limits = (
                req.hard_limits
                if req.hard_limits is not None
                else _connected_grbl_setting("hard_limits")
            )
            _gantry.configure_soft_limits_from_spans(
                max_travel_x=req.max_travel_x,
                max_travel_y=req.max_travel_y,
                max_travel_z=req.max_travel_z,
                status_report=req.status_report,
                homing_pull_off=req.homing_pull_off,
                hard_limits=hard_limits,
                tolerance_mm=req.tolerance_mm,
            )
            _calibration_restore_soft_limits = False
            _calibration_jog_bypass_working_volume = False
            if _connected_gantry_config is not None:
                grbl_settings = dict(
                    _connected_gantry_config.get("grbl_settings") or {}
                )
                grbl_settings.update({
                    "soft_limits": True,
                    "homing_enable": True,
                    "max_travel_x": req.max_travel_x,
                    "max_travel_y": req.max_travel_y,
                    "max_travel_z": req.max_travel_z,
                })
                if hard_limits is not None:
                    grbl_settings["hard_limits"] = bool(hard_limits)
                if req.status_report is not None:
                    grbl_settings["status_report"] = req.status_report
                if req.homing_pull_off is not None:
                    grbl_settings["homing_pull_off"] = req.homing_pull_off
                _connected_gantry_config["grbl_settings"] = grbl_settings
                _calibration_warning = _calibration_mismatch_warning(
                    _gantry,
                    _connected_gantry_config,
                )
        except Exception as e:
            raise HTTPException(500, f"Soft-limit configuration failed: {e}")
    return {"status": "ok"}


@router.post("/calibration/prepare-origin")
def prepare_calibration_origin() -> GantryPosition:
    """Run the blocking CubOS setup before the interactive XY-origin jog."""
    global _calibration_jog_bypass_working_volume, _calibration_restore_soft_limits
    if _gantry is None:
        raise HTTPException(400, "Gantry not connected")
    with _serial_lock:
        try:
            _apply_calibration_grbl_baseline()
            _gantry.home()
            _gantry.enforce_work_position_reporting()
            _gantry.activate_work_coordinate_system("G54")
            _gantry.clear_g92_offsets()
            enabled = _gantry.soft_limits_enabled()
            if enabled is True:
                _gantry.set_soft_limits_enabled(False)
                _calibration_restore_soft_limits = True
            _calibration_jog_bypass_working_volume = True
        except HTTPException:
            raise
        except Exception as e:
            raise HTTPException(500, f"Calibration preparation failed: {e}")
    return get_position()


@router.post("/calibration/home-and-center")
def calibration_home_and_center() -> CalibrationCenterResponse:
    """Home after XY origining, capture X/Y bounds, then move to the deck center."""
    if _gantry is None:
        raise HTTPException(400, "Gantry not connected")
    with _serial_lock:
        try:
            _gantry.home()
            bounds = dict(_gantry.get_coordinates())
            center_x = round(float(bounds["x"]) / 2.0, 3)
            center_y = round(float(bounds["y"]) / 2.0, 3)
            _gantry.move_to(center_x, center_y, float(bounds["z"]))
            position = dict(_gantry.get_coordinates())
        except Exception as e:
            raise HTTPException(500, f"Home and center failed: {e}")
    return CalibrationCenterResponse(xy_bounds=bounds, position=position)


@router.post("/calibration/restore-soft-limits")
def restore_calibration_soft_limits() -> GantryPosition:
    """Restore soft limits if Zoo disabled them for a calibration jog."""
    global _calibration_jog_bypass_working_volume
    if _gantry is None:
        raise HTTPException(400, "Gantry not connected")
    with _serial_lock:
        try:
            _restore_calibration_soft_limits_if_needed()
            _calibration_jog_bypass_working_volume = False
        except Exception as e:
            raise HTTPException(500, f"Soft-limit restore failed: {e}")
    return get_position()


@router.post("/calibration/finalize-origin")
def finalize_calibration_origin(req: FinalizeOriginRequest) -> FinalizeOriginResponse:
    """Finalize single-instrument deck-origin calibration through CubOS."""
    global _calibration_jog_bypass_working_volume, _calibration_restore_soft_limits
    global _calibration_warning, _last_position
    if _gantry is None:
        raise HTTPException(400, "Gantry not connected")
    with _serial_lock:
        try:
            result = _gantry.finalize_deck_origin_calibration(
                home_z=req.home_z,
                block_touch_z=req.block_touch_z,
                block_height=req.block_height,
                total_z_range=req.factory_z_travel,
                status_report=0,
                homing_pull_off=_connected_grbl_setting("homing_pull_off"),
                hard_limits=_connected_grbl_setting("hard_limits"),
                tolerance_mm=req.tolerance_mm,
            )
            max_travel = {
                axis: float(value)
                for axis, value in dict(result["max_travel"]).items()
            }
            measured_volume = {
                axis: float(value)
                for axis, value in dict(result["measured_volume"]).items()
            }
            position = {
                axis: float(value)
                for axis, value in dict(result["position"]).items()
            }
            homing_pull_off_mm = result.get("homing_pull_off_mm")
            if homing_pull_off_mm is not None:
                homing_pull_off_mm = float(homing_pull_off_mm)
            _calibration_restore_soft_limits = False
            _calibration_jog_bypass_working_volume = False
            if _connected_gantry_config is not None:
                grbl_settings = dict(
                    _connected_gantry_config.get("grbl_settings") or {}
                )
                grbl_settings.update({
                    "soft_limits": True,
                    "homing_enable": True,
                    "max_travel_x": max_travel["x"],
                    "max_travel_y": max_travel["y"],
                    "max_travel_z": max_travel["z"],
                })
                grbl_settings["status_report"] = 0
                if homing_pull_off_mm is not None:
                    grbl_settings["homing_pull_off"] = homing_pull_off_mm
                _connected_gantry_config["grbl_settings"] = grbl_settings
                _calibration_warning = _calibration_mismatch_warning(
                    _gantry,
                    _connected_gantry_config,
                )
            _last_position = GantryPosition(
                x=position["x"],
                y=position["y"],
                z=position["z"],
                work_x=position["x"],
                work_y=position["y"],
                work_z=position["z"],
                status="Idle",
                connected=True,
                calibration_warning=_calibration_warning,
            )
        except HTTPException:
            _calibration_restore_soft_limits = False
            _calibration_jog_bypass_working_volume = False
            raise
        except Exception as e:
            _calibration_restore_soft_limits = False
            _calibration_jog_bypass_working_volume = False
            if _looks_like_alarm_error(e):
                raise _alarm_http_exception("during calibration finalization")
            raise HTTPException(500, f"Calibration finalization failed: {e}")
    return FinalizeOriginResponse(
        measured_volume=measured_volume,
        z_calibration=dict(result["z_calibration"]),
        max_travel=max_travel,
        position=position,
        homing_pull_off_mm=homing_pull_off_mm,
    )


@router.post("/calibration/recover-limit")
def recover_calibration_limit(req: LimitRecoveryRequest) -> LimitRecoveryResponse:
    """Recover from a calibration jog that tripped a limit switch."""
    if _gantry is None:
        raise HTTPException(400, "Gantry not connected")
    if req.x == 0 and req.y == 0 and req.z == 0:
        raise HTTPException(400, "Limit recovery requires the failed jog delta.")
    messages: List[str] = []
    with _serial_lock:
        try:
            result = recover_from_limit_alarm(
                _gantry,
                {"x": req.x, "y": req.y, "z": req.z},
                pull_off_mm=req.pull_off_mm,
                feed_rate=req.feed_rate,
                output=messages.append,
            )
        except Exception as e:
            logging.error("Limit recovery failed: %s", e)
            if _looks_like_alarm_error(e):
                raise HTTPException(
                    409,
                    "Limit recovery did not clear the gantry alarm. "
                    f"Use E-stop/controller reset before continuing: {e}",
                )
            raise HTTPException(500, f"Limit recovery failed: {e}")
    return LimitRecoveryResponse(
        status="recovered",
        attempts=result.attempts,
        pull_off=result.pull_off_delta,
        messages=messages,
    )


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


@router.post("/reset-unlock")
def reset_and_unlock() -> GantryPosition:
    """Soft-reset the controller, then send unlock through CubOS."""
    if _gantry is None:
        raise HTTPException(400, "Gantry not connected")
    with _serial_lock:
        try:
            _gantry.reset_and_unlock()
        except Exception as e:
            raise HTTPException(500, f"Reset and unlock failed: {e}")
    return get_position()


@router.post("/feed-hold")
def feed_hold() -> GantryPosition:
    """Immediately stop gantry motion using CubOS feed-hold semantics."""
    if _gantry is None:
        raise HTTPException(400, "Gantry not connected")
    with _serial_lock:
        try:
            _gantry.stop()
        except Exception as e:
            raise HTTPException(500, f"Feed hold failed: {e}")
    return get_position()


@router.post("/jog-cancel")
def jog_cancel() -> GantryPosition:
    """Cancel any active jog through CubOS."""
    if _gantry is None:
        raise HTTPException(400, "Gantry not connected")
    with _serial_lock:
        try:
            _gantry.jog_cancel()
        except Exception as e:
            raise HTTPException(500, f"Jog cancel failed: {e}")
    return get_position()


@router.get("/grbl-settings")
def read_grbl_settings() -> GrblSettingsResponse:
    """Read live GRBL settings from the connected controller."""
    if _gantry is None:
        raise HTTPException(400, "Gantry not connected")
    with _serial_lock:
        try:
            settings = _gantry.read_grbl_settings()
        except Exception as e:
            raise HTTPException(500, f"Read GRBL settings failed: {e}")
    return GrblSettingsResponse(settings={str(k): str(v) for k, v in settings.items()})


@router.post("/grbl-settings")
def set_grbl_setting(req: SetGrblSettingRequest) -> GrblSettingsResponse:
    """Set one GRBL setting through CubOS, then return the refreshed settings."""
    if _gantry is None:
        raise HTTPException(400, "Gantry not connected")
    try:
        setting = _normalize_grbl_setting_code(req.setting)
        value = _parse_grbl_setting_value(req.value)
    except ValueError as exc:
        raise HTTPException(400, str(exc))
    with _serial_lock:
        try:
            _gantry.set_grbl_setting(setting, value)
            settings = _gantry.read_grbl_settings()
        except Exception as e:
            raise HTTPException(500, f"Set GRBL setting failed: {e}")
    return GrblSettingsResponse(settings={str(k): str(v) for k, v in settings.items()})


class ConnectRequest(BaseModel):
    filename: Optional[str] = None


@router.post("/connect")
def connect(body: Optional[ConnectRequest] = None) -> GantryPosition:
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
    global _calibration_jog_bypass_working_volume, _calibration_restore_soft_limits
    global _connected_gantry_config, _connected_gantry_filename, _gantry
    global _calibration_warning
    with _serial_lock:
        try:
            settings = get_settings()
            config = {}
            config_filename: Optional[str] = None
            if body and body.filename:
                path = resolve_config_path(settings.configs_dir, "gantry", body.filename)
                if not path.is_file():
                    raise HTTPException(404, f"Config not found: {body.filename}")
                config_filename = body.filename
                config = _validated_gantry_config(read_yaml(path)).model_dump(
                    mode="json",
                    exclude_none=True,
                )
            else:
                gantry_configs = list_configs(settings.configs_dir, "gantry")
                if gantry_configs:
                    path = resolve_config_path(settings.configs_dir, "gantry", gantry_configs[0])
                    config_filename = gantry_configs[0]
                    config = _validated_gantry_config(read_yaml(path)).model_dump(
                        mode="json",
                        exclude_none=True,
                    )
            # Stage the Gantry locally; publish to the module global only on
            # success so /position sees _gantry=None until we're ready, and
            # so a transient failure on reconnect doesn't clobber a prior
            # working connection.
            staged = Gantry(config=_runtime_connect_config(config))
            staged.connect()
            calibration_warning = _calibration_mismatch_warning(staged, config)
            # Seed WCO cache — GRBL sends WCO in one of the first few status reports.
            for _ in range(10):
                info = staged.get_position_info()
                if info["work_pos"] is not None:
                    break
                time.sleep(0.1)
        except HTTPException:
            raise
        except (ValueError, ValidationError) as e:
            raise HTTPException(400, f"Invalid gantry config: {e}")
        except Exception as e:
            raise HTTPException(500, f"Failed to connect: {e}")
        _gantry = staged
        _calibration_warning = calibration_warning
        _calibration_restore_soft_limits = False
        _calibration_jog_bypass_working_volume = False
        _connected_gantry_config = copy.deepcopy(config)
        _connected_gantry_filename = config_filename
    # get_position() acquires _serial_lock itself; call it outside the
    # `with` block so we don't try to re-acquire a non-reentrant lock,
    # which would fall through to the cached path and return a degraded
    # response (no coords) on the very first post-connect frame.
    return get_position()


@router.post("/disconnect")
def disconnect() -> GantryPosition:
    global _connected_gantry_config
    global _connected_gantry_filename, _gantry, _calibration_warning
    global _calibration_jog_bypass_working_volume, _calibration_restore_soft_limits
    if _gantry is None:
        return GantryPosition(connected=False, status="Disconnected")
    restore_error: Optional[Exception] = None
    disconnect_error: Optional[Exception] = None
    # Clear the module global inside the lock so concurrent /position
    # polls don't see _gantry set to a mill object that's mid-disconnect.
    with _serial_lock:
        try:
            _restore_calibration_soft_limits_if_needed()
        except Exception as e:
            restore_error = e
            logging.error("Failed to restore soft limits during disconnect: %s", e)
        try:
            _gantry.disconnect()
        except Exception as e:
            disconnect_error = e
            logging.error("Failed to disconnect gantry: %s", e)
        finally:
            _gantry = None
            _calibration_warning = None
            _connected_gantry_config = None
            _connected_gantry_filename = None
            _calibration_restore_soft_limits = False
            _calibration_jog_bypass_working_volume = False
    if restore_error is not None:
        detail = (
            "Soft-limit restore failed before disconnect: "
            f"{restore_error}. Gantry was disconnected; verify GRBL soft limits "
            "and travel settings before moving again."
        )
        if disconnect_error is not None:
            detail = (
                "Soft-limit restore and disconnect both failed: "
                f"restore error: {restore_error}; disconnect error: {disconnect_error}. "
                "Verify controller state before moving again."
            )
        raise HTTPException(500, detail)
    if disconnect_error is not None:
        raise HTTPException(500, f"Disconnect failed: {disconnect_error}")
    return GantryPosition(connected=False, status="Disconnected")


@router.get("/{filename}")
def get_gantry(filename: str) -> GantryResponse:
    path = resolve_config_path(get_settings().configs_dir, "gantry", filename)
    if not path.is_file():
        raise HTTPException(404, f"Config not found: {filename}")
    try:
        data = read_yaml(path)
        config = _validated_gantry_config(data)
    except (ValueError, ValidationError) as e:
        raise HTTPException(400, str(e))
    return GantryResponse(filename=filename, config=_api_gantry_config(config, data))


@router.put("/{filename}")
def put_gantry(filename: str, body: dict) -> GantryResponse:
    path = resolve_config_path(get_settings().configs_dir, "gantry", filename)
    try:
        config = _validated_gantry_config(body)
    except (ValueError, ValidationError) as e:
        raise HTTPException(400, str(e))
    config_dict = config.model_dump(mode="json", exclude_none=True)
    # calibration_block_height_mm is not in the CubOS CNC schema so it is stripped
    # by _normalize_gantry_yaml. Preserve it from the incoming body so the editor
    # field survives a save/reload cycle.
    source_cnc = dict((body or {}).get("cnc") or {})
    if "calibration_block_height_mm" in source_cnc:
        config_dict.setdefault("cnc", {})["calibration_block_height_mm"] = source_cnc[
            "calibration_block_height_mm"
        ]
    write_yaml(path, config_dict)
    with _serial_lock:
        _refresh_connected_config(filename, config_dict)
    return get_gantry(filename)
