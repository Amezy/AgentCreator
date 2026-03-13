"""Application configuration via environment variables."""

from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    """AgentCreator configuration.

    All settings can be overridden via environment variables with the AC_ prefix.
    Example: AC_HOST=127.0.0.1 AC_PORT=9000
    """

    # Server
    HOST: str = "0.0.0.0"
    PORT: int = 8100
    DEBUG: bool = False

    # Database
    DB_PATH: str = "data/agent.db"

    # ChromaDB
    CHROMA_PATH: str = "data/chroma"

    # JWT (shared with Box System)
    JWT_SECRET: str = "change-me-in-production"
    JWT_ALGORITHM: str = "HS256"
    JWT_EXPIRE_MINUTES: int = 1440

    # Agent
    MAX_CONCURRENT_AGENTS: int = 5

    # File Upload
    MAX_UPLOAD_SIZE_MB: int = 50
    UPLOAD_DIR: str = "data/artifacts"

    model_config = {"env_prefix": "AC_", "env_file": ".env"}


settings = Settings()
