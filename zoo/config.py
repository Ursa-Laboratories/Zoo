from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


DEFAULT_CONFIG_DIR = Path(__file__).resolve().parent.parent / "configs"


class ZooSettings(BaseSettings):
    model_config = SettingsConfigDict(
        env_prefix="ZOO_",
        extra="ignore",
        validate_assignment=True,
    )

    config_dir: Path = DEFAULT_CONFIG_DIR
    host: str = "127.0.0.1"
    port: int = 8742
    open_browser: bool = True

    def __init__(self, **data):
        super().__init__(**data)
        self.ensure_config_dir()

    @property
    def configs_dir(self) -> Path:
        return self.ensure_config_dir()

    def ensure_config_dir(self) -> Path:
        path = self.config_dir.expanduser().resolve()
        path.mkdir(parents=True, exist_ok=True)
        self.config_dir = path
        return path


# Shared singleton — all routers must use this instance.
_settings = ZooSettings()


def get_settings() -> ZooSettings:
    return _settings
