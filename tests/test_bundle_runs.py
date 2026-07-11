"""Tests for POST /api/protocol/run-bundle and GET /api/protocol/bundle-runs.

The mock-mode end-to-end test executes a real CubOS offline bundle (the
pipette_tip_transfer sim fixtures from the sibling CubOS checkout); it is
skipped when that checkout is not present. Everything else runs standalone.
"""

from __future__ import annotations

import json
from pathlib import Path
from types import SimpleNamespace

import pytest

from tests.api_client import api_request
from zoo.app import create_app
from zoo.config import get_settings
from zoo.routers import gantry as gantry_router
from zoo.services.bundle_runs import sanitize_run_id

SIM_BUNDLE = (
    Path(__file__).resolve().parents[2]
    / "CubOS"
    / "configs"
    / "sim"
    / "pipette_tip_transfer"
)


@pytest.fixture()
def client():
    return create_app()


@pytest.fixture()
def tmp_bundle_dir(tmp_path, monkeypatch):
    bundle_dir = tmp_path / "bundle_runs"
    monkeypatch.setattr(get_settings(), "bundle_run_dir", bundle_dir)
    yield bundle_dir


def _sim_bundle_body(run_id: str, **overrides):
    body = {
        "run_id": run_id,
        "gantry_config": (SIM_BUNDLE / "gantry.yaml").read_text(),
        "deck_config": (SIM_BUNDLE / "deck.yaml").read_text(),
        "protocol_yaml": (SIM_BUNDLE / "protocol.yaml").read_text(),
        "mock_mode": True,
    }
    body.update(overrides)
    return body


def test_sanitize_run_id_never_escapes():
    assert sanitize_run_id("plate 001:A1/asmi") == "plate_001_A1_asmi"
    assert sanitize_run_id("..") == "run"
    assert sanitize_run_id("../evil") == "_evil"
    assert sanitize_run_id("") == "run"


@pytest.mark.skipif(not SIM_BUNDLE.is_dir(), reason="CubOS sim bundle not available")
def test_run_bundle_mock_executes(client, tmp_bundle_dir):
    response = api_request(
        client, "POST", "/api/protocol/run-bundle", json=_sim_bundle_body("sim-001")
    )
    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["status"] == "ok"
    assert payload["run_id"] == "sim-001"
    assert payload["mock_mode"] is True
    assert payload["steps_executed"] > 0
    assert payload["campaign_id"] is None
    assert isinstance(payload["results"], list)

    run_dir = tmp_bundle_dir / "sim-001"
    assert (run_dir / "gantry.yaml").is_file()
    assert (run_dir / "deck.yaml").is_file()
    assert (run_dir / "protocol.yaml").is_file()
    assert (run_dir / "meta.json").is_file()
    stored = json.loads((run_dir / "result.json").read_text())
    assert stored["status"] == "ok"

    # Audit endpoint returns the stored bundle.
    lookup = api_request(client, "GET", "/api/protocol/bundle-runs/sim-001")
    assert lookup.status_code == 200
    assert lookup.json()["result"]["run_id"] == "sim-001"
    assert lookup.json()["error"] is None


@pytest.mark.skipif(not SIM_BUNDLE.is_dir(), reason="CubOS sim bundle not available")
def test_run_bundle_traversal_run_id_stays_inside_base(client, tmp_bundle_dir):
    response = api_request(
        client, "POST", "/api/protocol/run-bundle", json=_sim_bundle_body("../evil")
    )
    assert response.status_code == 200, response.text
    assert (tmp_bundle_dir / "_evil").is_dir()
    assert not (tmp_bundle_dir.parent / "evil").exists()


def test_run_bundle_real_routes_through_session(client, tmp_bundle_dir, monkeypatch):
    captured = {}

    def fake_run_protocol_on_session(**kwargs):
        captured.update(kwargs)
        return SimpleNamespace(
            status="ok", steps_executed=2, campaign_id=7, results=[None, {"f": 1.0}]
        )

    monkeypatch.setattr(
        gantry_router, "run_protocol_on_session", fake_run_protocol_on_session
    )

    body = {
        "run_id": "real-001",
        "gantry_config": "g: 1\n",
        "deck_config": "d: 1\n",
        "protocol_yaml": "p: 1\n",
        "mock_mode": False,
    }
    response = api_request(client, "POST", "/api/protocol/run-bundle", json=body)
    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["steps_executed"] == 2
    assert payload["campaign_id"] == 7
    assert payload["results"] == [None, {"f": 1.0}]

    run_dir = tmp_bundle_dir / "real-001"
    assert captured["gantry_path"] == str(run_dir / "gantry.yaml")
    assert captured["deck_path"] == str(run_dir / "deck.yaml")
    assert captured["protocol_path"] == str(run_dir / "protocol.yaml")
    assert captured["gantry_file"] == "bundle:real-001/gantry.yaml"
    # The staged files hold exactly the client-supplied YAML text.
    assert (run_dir / "gantry.yaml").read_text() == "g: 1\n"
    # The run gate is released afterwards.
    assert gantry_router.run_active() is False


def test_run_bundle_rejects_when_run_active(client, tmp_bundle_dir):
    gantry_router.begin_run(protocol_file="other.yaml")
    try:
        body = {
            "run_id": "busy-001",
            "gantry_config": "g: 1\n",
            "deck_config": "d: 1\n",
            "protocol_yaml": "p: 1\n",
            "mock_mode": True,
        }
        response = api_request(client, "POST", "/api/protocol/run-bundle", json=body)
        assert response.status_code == 409
    finally:
        gantry_router.end_run()


def test_run_bundle_invalid_yaml_is_400_and_writes_error(client, tmp_bundle_dir):
    body = {
        "run_id": "bad-001",
        "gantry_config": "not: [valid: gantry\n",
        "deck_config": "d: 1\n",
        "protocol_yaml": "p: 1\n",
        "mock_mode": True,
    }
    response = api_request(client, "POST", "/api/protocol/run-bundle", json=body)
    assert response.status_code in (400, 500)
    assert (tmp_bundle_dir / "bad-001" / "error.txt").is_file()
    assert gantry_router.run_active() is False


def test_run_bundle_requires_all_fields(client, tmp_bundle_dir):
    body = {
        "run_id": "x",
        "gantry_config": "",
        "deck_config": "d: 1\n",
        "protocol_yaml": "p: 1\n",
    }
    response = api_request(client, "POST", "/api/protocol/run-bundle", json=body)
    assert response.status_code == 400


def test_get_bundle_run_missing_404(client, tmp_bundle_dir):
    response = api_request(client, "GET", "/api/protocol/bundle-runs/nope-000")
    assert response.status_code == 404
