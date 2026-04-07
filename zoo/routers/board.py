"""Board config API endpoints — thin layer over CubOS board schema."""

import inspect
from typing import Any, Dict, List, Optional

from board.loader import INSTRUMENT_REGISTRY
from board.yaml_schema import BoardYamlSchema
from fastapi import APIRouter, HTTPException
from instruments.base_instrument import BaseInstrument
from instruments.pipette.models import PIPETTE_MODELS
from pydantic import BaseModel

from zoo.config import get_settings
from zoo.services.yaml_io import list_configs, read_yaml, resolve_config_path, write_yaml

router = APIRouter(prefix="/api/board", tags=["board"])

# Primitive types that can be represented in YAML / JSON form fields.
_PRIMITIVE_TYPES = {str, int, float, bool}

# Base-class params rendered separately by the UI (offsets, depth, etc.).
_BASE_PARAMS = {
    p for p in inspect.signature(BaseInstrument.__init__).parameters if p != "self"
}


# ── Response models (API shape only) ──────────────────────────────────


class BoardResponse(BaseModel):
    filename: str
    instruments: Dict[str, Dict[str, Any]]


class PipetteModelInfo(BaseModel):
    name: str
    family: str
    channels: int
    max_volume: float
    min_volume: float


class InstrumentTypeInfo(BaseModel):
    type: str
    is_mock: bool


class InstrumentFieldInfo(BaseModel):
    name: str
    type: str
    required: bool
    default: Any = None
    choices: Optional[List[str]] = None


# ── Helpers ────────────────────────────────────────────────────────────


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
    # Handle Optional[primitive] → typing.Optional[str] etc.
    origin = getattr(annotation, "__origin__", None)
    args = getattr(annotation, "__args__", ())
    if origin is type(None):
        return True
    # Union[X, None] (i.e. Optional[X])
    if args and type(None) in args:
        return any(a in _PRIMITIVE_TYPES for a in args if a is not type(None))
    return False


def _build_instrument_fields(type_key: str) -> List[InstrumentFieldInfo]:
    """Introspect an instrument class's __init__ to build field metadata."""
    cls = INSTRUMENT_REGISTRY[type_key]
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


# ── Routes ─────────────────────────────────────────────────────────────


@router.get("/instrument-types")
def list_instrument_types() -> List[InstrumentTypeInfo]:
    return [
        InstrumentTypeInfo(type=key, is_mock=False)
        for key in sorted(INSTRUMENT_REGISTRY.keys())
        if not key.startswith("mock_")
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
        for type_key in sorted(INSTRUMENT_REGISTRY.keys())
        if not type_key.startswith("mock_")
    }


@router.get("/configs")
def list_board_configs() -> list[str]:
    return list_configs(get_settings().campaign_dir, "board")


@router.get("/{filename}")
def get_board(filename: str) -> BoardResponse:
    path = resolve_config_path(get_settings().campaign_dir, "board", filename)
    if not path.is_file():
        raise HTTPException(404, f"Config not found: {filename}")

    raw = read_yaml(path)
    # Validate through CubOS's schema.
    try:
        BoardYamlSchema.model_validate(raw)
    except Exception as e:
        raise HTTPException(400, str(e))

    instruments = {
        name: entry
        for name, entry in raw.get("instruments", {}).items()
    }
    return BoardResponse(filename=filename, instruments=instruments)


@router.put("/{filename}")
def put_board(filename: str, body: dict) -> BoardResponse:
    path = resolve_config_path(get_settings().campaign_dir, "board", filename)
    write_yaml(path, body)
    return get_board(filename)
