"""Test raw YAML editing endpoints."""

from pathlib import Path

import pytest

from backend.tests.api_client import api_request
from zoo.app import create_app
from zoo.config import get_settings


@pytest.fixture(autouse=True)
def restore_config_dir():
    original = get_settings().config_dir
    yield
    get_settings().config_dir = original


def test_put_raw_writes_and_returns_content(monkeypatch, tmp_path):
    monkeypatch.setattr(get_settings(), "config_dir", tmp_path)

    response = api_request(
        create_app(),
        "PUT",
        "/api/raw/gantry.yaml",
        json={"content": "working_volume: {}\n"},
    )

    assert response.status_code == 200
    assert response.json() == {"content": "working_volume: {}\n"}
    assert (tmp_path / "gantry.yaml").read_text() == "working_volume: {}\n"


def test_get_raw_returns_existing_content(monkeypatch, tmp_path):
    monkeypatch.setattr(get_settings(), "config_dir", tmp_path)
    path = Path(tmp_path) / "deck.yaml"
    path.write_text("labware: {}\n")

    response = api_request(create_app(), "GET", "/api/raw/deck.yaml")

    assert response.status_code == 200
    assert response.json() == {"content": "labware: {}\n"}


def test_get_raw_rejects_missing_config(monkeypatch, tmp_path):
    monkeypatch.setattr(get_settings(), "config_dir", tmp_path)

    response = api_request(create_app(), "GET", "/api/raw/missing.yaml")

    assert response.status_code == 404
    assert "Config not found: missing.yaml" in response.text
