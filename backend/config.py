"""Application settings loaded from environment variables."""
from typing import Literal

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    anthropic_api_key: str = ""
    groq_api_key: str = ""
    elevenlabs_api_key: str = ""
    elevenlabs_voice_id_en: str = ""
    elevenlabs_voice_id_es: str = ""
    log_level: Literal["DEBUG", "INFO", "WARNING", "ERROR"] = "INFO"


settings = Settings()
