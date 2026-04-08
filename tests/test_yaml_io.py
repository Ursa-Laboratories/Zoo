"""Test YAML I/O utilities."""

import tempfile
from pathlib import Path

from zoo.services.yaml_io import classify_config, read_yaml, resolve_config_path, write_yaml


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


def test_classify_board():
    assert classify_config({"instruments": {}}) == "board"


def test_classify_gantry():
    assert classify_config({"working_volume": {}}) == "gantry"


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
