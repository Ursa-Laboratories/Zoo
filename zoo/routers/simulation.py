"""Digital simulation routes backed by the CubOS loader-based exporter."""

from __future__ import annotations

import logging

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
from validation.errors import SetupValidationError

from zoo.config import get_settings
from zoo.services.digital_twin.exporter import export_digital_twin
from zoo.services.yaml_io import resolve_config_path

router = APIRouter(prefix="/api/simulation", tags=["simulation"])


class DigitalTwinRequest(BaseModel):
    gantry_file: str
    deck_file: str
    protocol_file: str
    sample_step_mm: float = Field(default=5.0, gt=0)


@router.post("/digital-twin")
def build_digital_twin(body: DigitalTwinRequest) -> dict:
    """Return the Digital Sim bundle for the selected Zoo configs.

    The endpoint is intentionally a thin adapter: path resolution is Zoo's,
    validation/loading/motion expansion are the copied Digital Sim exporter
    backed by CubOS public loaders. It does not connect to or command hardware.
    """
    settings = get_settings()
    gantry_path = resolve_config_path(settings.configs_dir, "gantry", body.gantry_file)
    deck_path = resolve_config_path(settings.configs_dir, "deck", body.deck_file)
    protocol_path = resolve_config_path(settings.configs_dir, "protocol", body.protocol_file)

    for label, path in (
        ("Gantry", gantry_path),
        ("Deck", deck_path),
        ("Protocol", protocol_path),
    ):
        if not path.is_file():
            raise HTTPException(404, f"{label} file not found: {path.name}")

    try:
        return export_digital_twin(
            gantry_path=gantry_path,
            deck_path=deck_path,
            protocol_path=protocol_path,
            sample_step_mm=body.sample_step_mm,
        )
    except (ValueError, SetupValidationError, KeyError) as exc:
        raise HTTPException(400, str(exc))
    except Exception as exc:
        logging.exception("Digital simulation export failed")
        raise HTTPException(500, f"Simulation export failed: {exc}")
