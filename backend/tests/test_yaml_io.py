"""Test YAML I/O utilities."""

import tempfile
from pathlib import Path

import pytest

from zoo.services.yaml_io import (
    YamlConfigError,
    classify_config,
    list_configs,
    read_yaml,
    resolve_config_path,
    write_yaml,
)


def test_read_write_roundtrip():
    data = {"labware": {"plate1": {"type": "well_plate", "name": "test"}}}
    with tempfile.NamedTemporaryFile(suffix=".yaml", delete=False) as f:
        path = Path(f.name)
    write_yaml(path, data)
    result = read_yaml(path)
    assert result == data
    path.unlink()


def test_classify_deck():
    assert classify_config({"labware": {}}) == "deck"


def test_classify_gantry():
    assert classify_config({"working_volume": {}}) == "gantry"


def test_classify_gantry_with_embedded_instruments():
    assert classify_config({"working_volume": {}, "instruments": {}}) == "gantry"


def test_classify_protocol():
    assert classify_config({"protocol": []}) == "protocol"


def test_classify_unknown():
    assert classify_config({"other": {}}) is None


def test_read_empty_yaml():
    with tempfile.NamedTemporaryFile(suffix=".yaml", delete=False, mode="w") as f:
        f.write("")
        path = Path(f.name)
    result = read_yaml(path)
    assert result == {}
    path.unlink()


def test_resolve_config_path_prefers_kind_subdirectory():
    with tempfile.TemporaryDirectory() as d:
        configs_dir = Path(d) / "configs"
        protocol_dir = configs_dir / "protocol"
        protocol_dir.mkdir(parents=True)
        assert resolve_config_path(configs_dir, "protocol", "move.yaml") == protocol_dir / "move.yaml"


def test_resolve_config_path_uses_flat_configs_when_kind_subdirectory_is_missing(tmp_path):
    configs_dir = tmp_path / "configs"
    configs_dir.mkdir()

    assert resolve_config_path(configs_dir, "deck", "deck.yaml") == configs_dir / "deck.yaml"


def test_read_yaml_raises_clear_error_for_invalid_yaml(tmp_path):
    path = tmp_path / "bad.yaml"
    path.write_text("labware: [\n")

    with pytest.raises(YamlConfigError, match="Invalid YAML in bad.yaml"):
        read_yaml(path)


def test_list_configs_prefers_kind_subdirectory(tmp_path):
    deck_dir = tmp_path / "configs" / "deck"
    deck_dir.mkdir(parents=True)
    (deck_dir / "b.yaml").write_text("labware: {}\n")
    (deck_dir / "a.yaml").write_text("labware: {}\n")
    (deck_dir / "ignored.txt").write_text("not yaml\n")

    assert list_configs(tmp_path / "configs", "deck") == ["a.yaml", "b.yaml"]


def test_list_configs_returns_empty_for_missing_directory(tmp_path):
    assert list_configs(tmp_path / "missing", "deck") == []


def test_list_configs_falls_back_to_classification_and_skips_bad_yaml(tmp_path):
    configs_dir = tmp_path / "configs"
    configs_dir.mkdir()
    (configs_dir / "deck.yaml").write_text("labware: {}\n")
    (configs_dir / "gantry.yaml").write_text("working_volume: {}\n")
    (configs_dir / "bad.yaml").write_text("labware: [\n")

    assert list_configs(configs_dir, "deck") == ["deck.yaml"]
