"""Data router: browse stored experiment outputs and export raw CSV."""

from __future__ import annotations

import csv
import io
import json
import re
import sqlite3
from contextlib import closing
from pathlib import Path
from typing import Any

from fastapi import APIRouter, HTTPException, Response
from pydantic import BaseModel

from zoo.config import get_settings

router = APIRouter(prefix="/api/data", tags=["data"])


class ExperimentSummary(BaseModel):
    experiment_id: int
    campaign_id: int
    campaign_description: str
    labware_name: str
    well_id: str | None
    created_at: str
    latest_measurement_at: str | None
    asmi_measurement_count: int


@router.get("/experiments")
def list_experiments() -> list[ExperimentSummary]:
    """Return experiment rows with simple measurement metadata."""
    db_path = _data_db_path()
    if not db_path.is_file():
        return []

    with closing(_connect(db_path)) as conn:
        _ensure_tables(conn, ("campaigns", "experiments", "asmi_measurements"))
        rows = conn.execute(
            """
            SELECT
                e.id AS experiment_id,
                e.campaign_id,
                c.description AS campaign_description,
                e.labware_name,
                e.well_id,
                e.created_at,
                MAX(m.timestamp) AS latest_measurement_at,
                COUNT(m.id) AS asmi_measurement_count
            FROM experiments e
            JOIN campaigns c ON c.id = e.campaign_id
            LEFT JOIN asmi_measurements m ON m.experiment_id = e.id
            GROUP BY e.id, e.campaign_id, c.description, e.labware_name, e.well_id, e.created_at
            ORDER BY e.created_at DESC, e.id DESC
            """
        ).fetchall()

    return [ExperimentSummary(**dict(row)) for row in rows]


@router.get("/experiments/{experiment_id}/asmi.csv")
def export_asmi_csv(experiment_id: int) -> Response:
    """Export one experiment's ASMI measurements in ASMI_new raw CSV format."""
    db_path = _data_db_path()
    if not db_path.is_file():
        raise HTTPException(404, f"Data database not found: {db_path}")

    with closing(_connect(db_path)) as conn:
        _ensure_tables(conn, ("experiments", "asmi_measurements"))
        rows = conn.execute(
            """
            SELECT
                m.id AS measurement_id,
                m.sample_timestamps,
                m.z_positions,
                m.raw_forces,
                m.corrected_forces,
                m.directions,
                m.baseline_avg,
                m.baseline_std,
                m.force_exceeded,
                m.data_points,
                m.step_size_mm,
                m.z_target_mm,
                m.force_limit_n,
                m.timestamp,
                e.well_id
            FROM asmi_measurements m
            JOIN experiments e ON e.id = m.experiment_id
            WHERE e.id = ?
            ORDER BY m.id
            """,
            (experiment_id,),
        ).fetchall()

    if not rows:
        raise HTTPException(404, f"No ASMI measurement found for experiment {experiment_id}")

    filename = _filename_for_row(rows[0])
    return Response(
        content="\n".join(_asmi_new_csv(row) for row in rows),
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


def _data_db_path() -> Path:
    return get_settings().data_db_path.expanduser().resolve()


def _connect(path: Path) -> sqlite3.Connection:
    conn = sqlite3.connect(path)
    conn.row_factory = sqlite3.Row
    return conn


def _ensure_tables(conn: sqlite3.Connection, tables: tuple[str, ...]) -> None:
    present = {
        row[0]
        for row in conn.execute(
            "SELECT name FROM sqlite_master WHERE type = 'table'",
        ).fetchall()
    }
    missing = [table for table in tables if table not in present]
    if missing:
        raise HTTPException(
            400,
            f"Data database is missing table(s): {', '.join(missing)}",
        )


def _asmi_new_csv(row: sqlite3.Row) -> str:
    z_positions = _json_array(row["z_positions"], "z_positions")
    raw_forces = _json_array(row["raw_forces"], "raw_forces")
    corrected_forces = _json_array(row["corrected_forces"], "corrected_forces")
    timestamps = _json_array_or_default(
        row["sample_timestamps"],
        "sample_timestamps",
        default=[None] * len(z_positions),
    )
    directions = _json_array_or_default(
        row["directions"],
        "directions",
        default=[None] * len(z_positions),
    )
    _validate_equal_lengths(
        z_positions=z_positions,
        raw_forces=raw_forces,
        corrected_forces=corrected_forces,
        sample_timestamps=timestamps,
        directions=directions,
    )

    has_directions = any(direction not in (None, "") for direction in directions)
    handle = io.StringIO()
    writer = csv.writer(handle, lineterminator="\n")
    writer.writerow(["Test_Time", row["timestamp"]])
    writer.writerow(["Well", row["well_id"] or ""])
    writer.writerow(["Target_Z(mm)", _format_optional(row["z_target_mm"], 3)])
    writer.writerow(["Step_Size(mm)", _format_optional(row["step_size_mm"], 3)])
    writer.writerow(["Force_Limit(N)", _format_optional(row["force_limit_n"], 1)])
    writer.writerow(["Baseline_Force(N)", _format_optional(row["baseline_avg"], 3)])
    writer.writerow(["Baseline_Std(N)", _format_optional(row["baseline_std"], 3)])
    writer.writerow(["Force_Exceeded", str(bool(row["force_exceeded"]))])
    writer.writerow([])
    header = [
        "Timestamp(s)",
        "Z_Position(mm)",
        "Raw_Force(N)",
        "Corrected_Force(N)",
    ]
    if has_directions:
        header.append("Direction")
    writer.writerow(header)

    for timestamp, z_pos, raw_force, corrected_force, direction in zip(
        timestamps,
        z_positions,
        raw_forces,
        corrected_forces,
        directions,
    ):
        sample_row = [
            _format_optional(timestamp, 3),
            _format_optional(z_pos, 3),
            _format_optional(raw_force, 3),
            _format_optional(corrected_force, 3),
        ]
        if has_directions:
            sample_row.append("" if direction is None else str(direction))
        writer.writerow(sample_row)
    return handle.getvalue()


def _filename_for_row(row: sqlite3.Row) -> str:
    well = row["well_id"] or f"experiment_{row['measurement_id']}"
    timestamp = _timestamp_suffix(str(row["timestamp"]))
    return f"well_{well}_{timestamp}.csv"


def _timestamp_suffix(timestamp: str) -> str:
    match = re.match(
        r"(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})",
        timestamp,
    )
    if match is None:
        safe = re.sub(r"[^0-9A-Za-z]+", "_", timestamp).strip("_")
        return safe or "unknown_time"
    return "".join(match.groups()[:3]) + "_" + "".join(match.groups()[3:])


def _json_array(value: Any, field_name: str) -> list[Any]:
    if value is None:
        raise HTTPException(400, f"ASMI field '{field_name}' is missing")
    parsed = json.loads(value) if isinstance(value, str) else value
    if not isinstance(parsed, list):
        raise HTTPException(400, f"ASMI field '{field_name}' must be a JSON array")
    return parsed


def _json_array_or_default(
    value: Any,
    field_name: str,
    *,
    default: list[Any],
) -> list[Any]:
    if value is None:
        return list(default)
    return _json_array(value, field_name)


def _validate_equal_lengths(**arrays: list[Any]) -> None:
    lengths = {name: len(value) for name, value in arrays.items()}
    expected = next(iter(lengths.values()), 0)
    mismatches = {
        name: length for name, length in lengths.items()
        if length != expected
    }
    if mismatches:
        details = ", ".join(f"{name}={length}" for name, length in lengths.items())
        raise HTTPException(400, f"ASMI measurement arrays must have equal lengths: {details}")


def _format_optional(value: Any, digits: int) -> str:
    if value is None:
        return ""
    return f"{float(value):.{digits}f}"
