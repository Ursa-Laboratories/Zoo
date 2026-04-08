import os
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


DEFAULT_CUBOS_PATH = Path(__file__).resolve().parent / "CubOS"


class ZooSettings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="ZOO_", extra="ignore")

    cubos_path: Path = DEFAULT_CUBOS_PATH
    host: str = "127.0.0.1"
    port: int = 8742
    open_browser: bool = True

    def __init__(self, **data):
        if "cubos_path" not in data and "panda_core_path" in data:
            data["cubos_path"] = data.pop("panda_core_path")
        if "cubos_path" not in data and "ZOO_CUBOS_PATH" not in os.environ:
            legacy_path = os.environ.get("ZOO_PANDA_CORE_PATH")
            if legacy_path:
                data["cubos_path"] = legacy_path
        super().__init__(**data)

    @property
    def configs_dir(self) -> Path:
        return self.cubos_path / "configs"

    @property
    def panda_core_path(self) -> Path:
        return self.cubos_path

    @panda_core_path.setter
    def panda_core_path(self, path: Path) -> None:
        self.cubos_path = path


# Shared singleton — all routers must use this instance.
_settings = ZooSettings()


def get_settings() -> ZooSettings:
    return _settings
