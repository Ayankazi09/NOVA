"""Optional local speech-to-text using faster-whisper (CPU int8 by default).

The model is never downloaded implicitly: run scripts/setup_speech.py or set
NOVA_SPEECH_ALLOW_DOWNLOAD=1 to permit a recorded, explicit download.
"""

from __future__ import annotations

import asyncio
import logging
import os
import tempfile
import time
from dataclasses import dataclass

from ..config import MAX_AUDIO_SECONDS, SERVER_DIR, settings
from ..errors import ApiError

log = logging.getLogger("nova.speech")

ALLOWED_MIME_PREFIXES = ("audio/webm", "audio/ogg", "audio/mp4", "audio/mpeg", "audio/wav", "audio/x-wav", "audio/aac", "video/webm")
SUFFIX = {"audio/webm": ".webm", "video/webm": ".webm", "audio/ogg": ".ogg", "audio/mp4": ".m4a", "audio/aac": ".aac", "audio/mpeg": ".mp3", "audio/wav": ".wav", "audio/x-wav": ".wav"}


@dataclass
class Transcript:
    text: str
    duration_s: float
    latency_ms: int
    language: str | None


class Transcriber:
    def __init__(self) -> None:
        self._model = None
        self._error: str | None = None
        self._lock = asyncio.Lock()

    @staticmethod
    def engine_installed() -> bool:
        try:
            import faster_whisper  # noqa: F401
            return True
        except Exception:
            return False

    def status(self) -> dict:
        return {
            "engine": "faster-whisper",
            "installed": self.engine_installed(),
            "model": settings.whisper_model,
            "device": settings.whisper_device,
            "compute": settings.whisper_compute,
            "loaded": self._model is not None,
            "lastError": self._error,
            "maxSeconds": MAX_AUDIO_SECONDS,
        }

    def _load(self):
        if self._model is not None:
            return self._model
        try:
            from faster_whisper import WhisperModel
        except Exception:
            raise ApiError("FEATURE_UNAVAILABLE", "No speech engine is installed on the server. Typing still works.", retryable=False)
        try:
            self._model = WhisperModel(
                settings.whisper_model,
                device=settings.whisper_device,
                compute_type=settings.whisper_compute,
                download_root=str(SERVER_DIR / "models"),
                local_files_only=not settings.speech_allow_download,
            )
            self._error = None
        except Exception as e:
            self._error = f"{type(e).__name__}: {str(e)[:200]}"
            log.warning("speech model load failed: %s", self._error)
            raise ApiError(
                "FEATURE_UNAVAILABLE",
                f"Speech model '{settings.whisper_model}' is not available locally. Run scripts/setup_speech.py once.",
                retryable=False,
            )
        return self._model

    async def transcribe(self, audio: bytes, mime: str, request_id: str) -> Transcript:
        base_mime = mime.split(";")[0].strip().lower()
        if not base_mime.startswith(ALLOWED_MIME_PREFIXES):
            raise ApiError("UNSUPPORTED", f"Audio type '{base_mime}' is not supported.", request_id, retryable=False)
        async with self._lock:
            return await asyncio.to_thread(self._transcribe_sync, audio, base_mime, request_id)

    def _transcribe_sync(self, audio: bytes, mime: str, request_id: str) -> Transcript:
        model = self._load()
        started = time.perf_counter()
        fd, path = tempfile.mkstemp(suffix=SUFFIX.get(mime, ".bin"), prefix="nova-")
        try:
            with os.fdopen(fd, "wb") as f:
                f.write(audio)
            # faster-whisper decodes with PyAV (package-backed) to 16 kHz mono PCM
            from faster_whisper.audio import decode_audio

            try:
                pcm = decode_audio(path, sampling_rate=16000)
            except Exception:
                raise ApiError("UNSUPPORTED", "The recording could not be decoded.", request_id, retryable=False)
            duration = len(pcm) / 16000.0
            if duration > MAX_AUDIO_SECONDS + 0.5:
                raise ApiError("INVALID_INPUT", f"Recording is longer than {MAX_AUDIO_SECONDS} s.", request_id, retryable=False)
            if duration < 0.2:
                raise ApiError("INVALID_INPUT", "Recording is too short.", request_id, retryable=False)
            segments, info = model.transcribe(pcm, beam_size=1, vad_filter=True, condition_on_previous_text=False)
            text = " ".join(s.text.strip() for s in segments).strip()
            return Transcript(text=text, duration_s=round(duration, 2), latency_ms=int((time.perf_counter() - started) * 1000), language=getattr(info, "language", None))
        finally:
            try:
                os.remove(path)  # never retain raw audio
            except OSError:
                pass


transcriber = Transcriber()
