from zoo.models.gantry import GantryConfig, WorkingVolume


def test_gantry_config_validates_through_cubos_semantics() -> None:
    cfg = GantryConfig.model_validate(
        {
            "serial_port": "/dev/ttyUSB0",
            "cnc": {"homing_strategy": "standard"},
            "working_volume": {
                "x_min": 0,
                "x_max": 300,
                "y_min": 0,
                "y_max": 200,
                "z_min": 0,
                "z_max": 150,
            },
            "expected_grbl_settings": {"$22": "1"},
        }
    )

    cubos_cfg = cfg.to_cubos()

    assert cubos_cfg.serial_port == "/dev/ttyUSB0"
    assert cubos_cfg.homing_strategy.value == "standard"
    assert cubos_cfg.working_volume.x_min == 0
    assert cubos_cfg.working_volume.x_max == 300
    assert cubos_cfg.working_volume.y_min == 0
    assert cubos_cfg.working_volume.y_max == 200
    assert cubos_cfg.working_volume.z_min == 0
    assert cubos_cfg.working_volume.z_max == 150
    assert cubos_cfg.expected_grbl_settings == {"$22": "1"}


def test_gantry_config_rejects_non_positive_working_volume() -> None:
    bad = {
        "serial_port": "/dev/ttyUSB0",
        "cnc": {"homing_strategy": "standard"},
        "working_volume": {
            "x_min": 10,
            "x_max": 10,
            "y_min": 0,
            "y_max": 200,
            "z_min": 0,
            "z_max": 150,
        },
    }

    try:
        GantryConfig.model_validate(bad)
        assert False, "Expected CubOS-backed validation to reject zero-width working volume"
    except Exception as exc:  # noqa: BLE001
        assert "x_min" in str(exc) or "must be <" in str(exc)


def test_working_volume_from_cubos_round_trips_zero_origin() -> None:
    cfg = WorkingVolume.from_cubos(WorkingVolume(x_min=0, x_max=50, y_min=0, y_max=60, z_min=0, z_max=70).to_cubos())

    assert cfg.model_dump() == {
        "x_min": 0,
        "x_max": 50,
        "y_min": 0,
        "y_max": 60,
        "z_min": 0,
        "z_max": 70,
    }
