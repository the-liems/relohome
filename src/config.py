from functools import lru_cache
from pathlib import Path
from typing import Literal

from pydantic import AliasChoices, Field, SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # App
    app_name: str = "AI20K Agent"
    # "staging": team test deployment (compose.coolify.yaml); only "production" disables test-only controls.
    app_env: Literal["development", "staging", "production", "test"] = "development"
    app_port: int = Field(default=8000, ge=1, le=65535)
    app_host: str = "0.0.0.0"
    log_level: Literal["DEBUG", "INFO", "WARNING", "ERROR"] = "INFO"
    cors_origins: str = "http://localhost:3000"

    # LLM
    openai_api_key: str = ""
    model_name: str = "gpt-4o-mini"
    llm_temperature: float = Field(default=0.7, ge=0.0, le=2.0)

    # Database
    # BACKEND_DATABASE_URL is the unique name in the shared local environment and wins
    # over a generic inherited DATABASE_URL; containers may still set DATABASE_URL.
    database_url: str = Field(
        default="sqlite:///./data/app.db",
        validation_alias=AliasChoices("BACKEND_DATABASE_URL", "DATABASE_URL", "database_url"),
    )

    # Vector Store
    chroma_persist_dir: str = "./data/chroma"

    # Isolated Roommate service: off until the complete release gates pass.
    roommate_enabled: bool = False
    roommate_state_dir: Path = Path("logs/private-roommate")
    roommate_area_catalog: Path | None = None
    roommate_moderators: str = ""
    roommate_demo_enabled: bool = False
    roommate_demo_dataset: Path | None = None
    agent_api_token: SecretStr = SecretStr("")


@lru_cache
def get_settings() -> Settings:
    return Settings()
