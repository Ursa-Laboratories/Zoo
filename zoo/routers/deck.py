"""Deck config API endpoints — thin layer over CubOS deck loader."""

from typing import Any, Dict, Optional

from deck import load_deck_from_yaml
from deck.labware.well_plate import WellPlate
from deck.loader import _derive_wells_from_calibration
from deck.yaml_schema import WellPlateYamlEntry
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from zoo.config import get_settings
from zoo.services.yaml_io import list_configs, read_yaml, resolve_config_path, write_yaml

router = APIRouter(prefix="/api/deck", tags=["deck"])


# ── Response models (API shape only, no validation duplication) ────────


class WellPosition(BaseModel):
    x: float
    y: float
    z: float


class LabwareResponse(BaseModel):
    key: str
    config: Dict[str, Any]
    wells: Optional[Dict[str, WellPosition]] = None


class DeckResponse(BaseModel):
    filename: str
    labware: list[LabwareResponse]


# ── Routes ─────────────────────────────────────────────────────────────


@router.get("/configs")
def list_deck_configs() -> list[str]:
    return list_configs(get_settings().campaign_dir, "deck")


@router.get("/{filename}")
def get_deck(filename: str) -> DeckResponse:
    path = resolve_config_path(get_settings().campaign_dir, "deck", filename)
    if not path.is_file():
        raise HTTPException(404, f"Config not found: {filename}")

    # Use CubOS's loader for validation + well derivation.
    try:
        deck = load_deck_from_yaml(path)
    except Exception as e:
        raise HTTPException(400, str(e))

    raw = read_yaml(path)
    items: list[LabwareResponse] = []
    for key, labware in deck.labware.items():
        config = raw.get("labware", {}).get(key, {})
        wells = None
        if isinstance(labware, WellPlate):
            wells = {
                wid: WellPosition(x=c.x, y=c.y, z=c.z)
                for wid, c in labware.wells.items()
            }
        items.append(LabwareResponse(key=key, config=config, wells=wells))

    return DeckResponse(filename=filename, labware=items)


@router.post("/preview-wells")
def preview_wells(body: dict) -> Dict[str, WellPosition]:
    """Compute well positions from a well plate config using CubOS's
    calibration logic, without requiring the config to be saved first."""
    try:
        entry = WellPlateYamlEntry.model_validate(body)
        wells = _derive_wells_from_calibration(entry)
        return {
            wid: WellPosition(x=round(c.x, 3), y=round(c.y, 3), z=round(c.z, 3))
            for wid, c in wells.items()
        }
    except Exception as e:
        raise HTTPException(400, str(e))


@router.put("/{filename}")
def put_deck(filename: str, body: dict) -> DeckResponse:
    path = resolve_config_path(get_settings().campaign_dir, "deck", filename)
    write_yaml(path, body)
    return get_deck(filename)
