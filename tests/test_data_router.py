"""Tests for experiment data browsing and CSV export routes."""

from __future__ import annotations

import json
import sqlite3
from pathlib import Path

from tests.api_client import api_request
from zoo.app import create_app
from zoo.config import get_settings


def _seed_asmi_database(path: Path) -> None:
    conn = sqlite3.connect(path)
    conn.executescript(
        """
        CREATE TABLE campaigns (
            id INTEGER PRIMARY KEY,
            description TEXT NOT NULL,
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            status TEXT NOT NULL DEFAULT 'running'
        );
        CREATE TABLE experiments (
            id INTEGER PRIMARY KEY,
            campaign_id INTEGER NOT NULL REFERENCES campaigns(id),
            labware_name TEXT NOT NULL,
            well_id TEXT,
            contents TEXT,
            created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE TABLE asmi_measurements (
            id INTEGER PRIMARY KEY,
            experiment_id INTEGER NOT NULL REFERENCES experiments(id),
            sample_timestamps TEXT,
            z_positions TEXT NOT NULL,
            raw_forces TEXT NOT NULL,
            corrected_forces TEXT NOT NULL,
            directions TEXT,
            baseline_avg REAL NOT NULL,
            baseline_std REAL NOT NULL,
            force_exceeded INTEGER NOT NULL DEFAULT 0,
            data_points INTEGER NOT NULL,
            step_size_mm REAL,
            z_target_mm REAL,
            force_limit_n REAL,
            timestamp TEXT NOT NULL DEFAULT (datetime('now'))
        );
        """
    )
    conn.execute(
        "INSERT INTO campaigns (id, description, created_at, status) VALUES (?, ?, ?, ?)",
        (1, "ASMI sample campaign", "2025-10-30 12:20:00", "complete"),
    )
    conn.execute(
        "INSERT INTO experiments "
        "(id, campaign_id, labware_name, well_id, contents, created_at) "
        "VALUES (?, ?, ?, ?, ?, ?)",
        (7, 1, "asmi_96_well_deck_origin", "E5", "[]", "2025-10-30 12:21:07"),
    )
    conn.execute(
        "INSERT INTO asmi_measurements "
        "(id, experiment_id, sample_timestamps, z_positions, raw_forces, "
        "corrected_forces, directions, baseline_avg, baseline_std, "
        "force_exceeded, data_points, step_size_mm, z_target_mm, force_limit_n, timestamp) "
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        (
            11,
            7,
            json.dumps([1761841220.199, 1761841220.327]),
            json.dumps([-74.01, -74.02]),
            json.dumps([0.463, 0.457]),
            json.dumps([0.004, -0.002]),
            json.dumps(["down", "down"]),
            0.459,
            0.003,
            1,
            2,
            0.01,
            -80.0,
            10.0,
            "2025-10-30 12:21:07",
        ),
    )
    conn.commit()
    conn.close()


def test_list_experiments_returns_run_metadata(monkeypatch, tmp_path):
    db_path = tmp_path / "panda_data.db"
    _seed_asmi_database(db_path)
    monkeypatch.setattr(get_settings(), "data_db_path", db_path)

    response = api_request(create_app(), "GET", "/api/data/experiments")

    assert response.status_code == 200
    assert response.json() == [
        {
            "experiment_id": 7,
            "campaign_id": 1,
            "campaign_description": "ASMI sample campaign",
            "labware_name": "asmi_96_well_deck_origin",
            "well_id": "E5",
            "created_at": "2025-10-30 12:21:07",
            "latest_measurement_at": "2025-10-30 12:21:07",
            "asmi_measurement_count": 1,
        }
    ]


def test_export_experiment_asmi_csv_matches_raw_per_well_format(monkeypatch, tmp_path):
    db_path = tmp_path / "panda_data.db"
    _seed_asmi_database(db_path)
    monkeypatch.setattr(get_settings(), "data_db_path", db_path)

    response = api_request(create_app(), "GET", "/api/data/experiments/7/asmi.csv")

    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/csv")
    assert response.headers["content-disposition"] == (
        'attachment; filename="well_E5_20251030_122107.csv"'
    )
    assert response.text.splitlines() == [
        "Test_Time,2025-10-30 12:21:07",
        "Well,E5",
        "Target_Z(mm),-80.000",
        "Step_Size(mm),0.010",
        "Force_Limit(N),10.0",
        "Baseline_Force(N),0.459",
        "Baseline_Std(N),0.003",
        "Force_Exceeded,True",
        "",
        "Timestamp(s),Z_Position(mm),Raw_Force(N),Corrected_Force(N),Direction",
        "1761841220.199,-74.010,0.463,0.004,down",
        "1761841220.327,-74.020,0.457,-0.002,down",
    ]


def test_missing_database_returns_empty_experiment_list(monkeypatch, tmp_path):
    monkeypatch.setattr(get_settings(), "data_db_path", tmp_path / "missing.db")

    response = api_request(create_app(), "GET", "/api/data/experiments")

    assert response.status_code == 200
    assert response.json() == []
