"""Gateway configuration, read from the environment once when the app is created."""

from pydantic import SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict


class GatewaySettings(BaseSettings):
    model_config = SettingsConfigDict(extra="ignore")

    agent_api_token: SecretStr = SecretStr("")
    lifeflow_api_base_url: str = "http://127.0.0.1:8000/api/v1"
    siu_platform_api_url: str = "http://127.0.0.1:4100/v1"
    # Empty (as in the env template) means "use the request's base URL".
    siu_public_base_url: str = ""
    siu_secure_cookie: bool = False
    siu_allow_registration: bool = True
