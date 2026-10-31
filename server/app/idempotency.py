"""Bounded in-memory idempotency: same requestId + same payload joins/reuses; different payload -> 409."""

from __future__ import annotations

import asyncio
import hashlib
import json
import time
from typing import Any, Awaitable, Callable

from .config import IDEMPOTENCY_TTL_S
from .errors import ApiError

MAX_ENTRIES = 256


class IdempotencyCache:
    def __init__(self) -> None:
        self._entries: dict[str, tuple[str, float, asyncio.Task]] = {}

    @staticmethod
    def fingerprint(route: str, payload: Any) -> str:
        blob = json.dumps(payload, sort_keys=True, default=str).encode()
        return hashlib.sha256(route.encode() + b"|" + blob).hexdigest()

    def _purge(self) -> None:
        now = time.monotonic()
        for key in [k for k, (_, t, _) in self._entries.items() if now - t > IDEMPOTENCY_TTL_S]:
            self._entries.pop(key, None)
        while len(self._entries) > MAX_ENTRIES:
            self._entries.pop(next(iter(self._entries)))

    async def run(self, request_id: str, fingerprint: str, factory: Callable[[], Awaitable[Any]]) -> Any:
        self._purge()
        entry = self._entries.get(request_id)
        if entry is not None:
            fp, _, task = entry
            if fp != fingerprint:
                raise ApiError("CONFLICT", "This requestId was already used with a different payload.", request_id, retryable=False)
            return await asyncio.shield(task)
        task = asyncio.ensure_future(factory())
        self._entries[request_id] = (fingerprint, time.monotonic(), task)
        try:
            return await asyncio.shield(task)
        except BaseException:
            # failures are not cached, so an explicit retry with the same id re-runs
            self._entries.pop(request_id, None)
            raise

    def clear(self) -> None:
        self._entries.clear()


cache = IdempotencyCache()
