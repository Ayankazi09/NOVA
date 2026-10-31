"""Runtime configuration. Secrets come only from the environment or server/.env."""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path

SERVER_DIR = Path(__file__).resolve().parent.parent
REPO_DIR = SERVER_DIR.parent


def _load_dotenv(path: Path) -> None:
    if not path.exists():
        return
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        value = value.strip().strip('"').strip("'")
        os.environ.setdefault(key.strip(), value)


_load_dotenv(SERVER_DIR / ".env")


def _int(name: str, default: int) -> int:
    try:
        return int(os.environ.get(name, default))
    except ValueError:
        return default


@dataclass(frozen=True)
class Settings:
    api_key: str = field(default_factory=lambda: os.environ.get("BHARATCODE_API_KEY", "").strip(), repr=False)
    base_url: str = field(default_factory=lambda: os.environ.get("BHARATCODE_BASE_URL", "https://bharatcode.ai/api/model/v1").rstrip("/"))
    model: str = field(default_factory=lambda: os.environ.get("NOVA_MODEL", "qwen-3.8-27b"))
    provider_timeout_s: int = field(default_factory=lambda: _int("NOVA_PROVIDER_TIMEOUT_S", 75))
    max_output_tokens: int = field(default_factory=lambda: _int("NOVA_MAX_OUTPUT_TOKENS", 1200))
    host: str = field(default_factory=lambda: os.environ.get("NOVA_HOST", "127.0.0.1"))
    port: int = field(default_factory=lambda: _int("NOVA_PORT", 8010))
    allowed_hosts: tuple[str, ...] = field(
        default_factory=lambda: tuple(h.strip() for h in os.environ.get("NOVA_ALLOWED_HOSTS", "*" if os.environ.get("VERCEL") else "127.0.0.1,localhost").split(",") if h.strip())
    )
    allowed_origins: tuple[str, ...] = field(
        default_factory=lambda: tuple(
            o.strip()
            for o in os.environ.get(
                "NOVA_ALLOWED_ORIGINS",
                "http://127.0.0.1:5180,http://localhost:5180,https://127.0.0.1:5180,https://localhost:5180,http://127.0.0.1:8010,http://localhost:8010",
            ).split(",")
            if o.strip()
        )
    )
    access_code: str = field(default_factory=lambda: os.environ.get("NOVA_ACCESS_CODE", "").strip(), repr=False)  # hosted testing: shared code
    whisper_model: str = field(default_factory=lambda: os.environ.get("NOVA_WHISPER_MODEL", "base.en"))
    whisper_device: str = field(default_factory=lambda: os.environ.get("NOVA_WHISPER_DEVICE", "cpu"))
    whisper_compute: str = field(default_factory=lambda: os.environ.get("NOVA_WHISPER_COMPUTE", "int8"))
    speech_allow_download: bool = field(default_factory=lambda: os.environ.get("NOVA_SPEECH_ALLOW_DOWNLOAD", "0") == "1")

    @property
    def key_configured(self) -> bool:
        return bool(self.api_key)


settings = Settings()

# Request bounds (configurable defaults, not provider guarantees)
MAX_PNG_BYTES = 1_000_000
MAX_PNG_EDGE = 1600
MAX_EQUATION_CHARS = 160
MAX_QUESTION_CHARS = 1200
MAX_HISTORY_TURNS = 6
MAX_TURN_CHARS = 600
MAX_ACTIONS = 3
MAX_NOTE_CHARS = 400
MAX_SPEAK_CHARS = 600
MAX_AUDIO_BYTES = 5_000_000
MAX_AUDIO_SECONDS = 20
IDEMPOTENCY_TTL_S = 300
