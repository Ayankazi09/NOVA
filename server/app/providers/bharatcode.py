"""BharatCode adapter (OpenAI Responses-compatible). Server-only key; store:false."""

from __future__ import annotations

import json
import logging
import os
import re
import time
from dataclasses import dataclass

import httpx

from ..config import settings
from ..errors import ApiError

log = logging.getLogger("nova.provider")

# "responses" (default) or "chat" (OpenAI chat/completions with image_url parts)
API_STYLE = os.environ.get("NOVA_API_STYLE", "responses")
REASONING_OFF = os.environ.get("NOVA_REASONING_OFF", "1") == "1"


@dataclass
class ModelReply:
    text: str
    latency_ms: int
    incomplete: bool


def _responses_body(instructions: str, text: str, images: list[str], max_tokens: int, reasoning_off: bool, effort: str | None = None, temperature: float | None = None) -> dict:
    content: list[dict] = [{"type": "input_text", "text": text}]
    for img in images:
        content.append({"type": "input_image", "image_url": img})
    body = {
        "model": settings.model,
        "instructions": instructions,
        "input": [{"role": "user", "content": content}],
        "store": False,
        "max_output_tokens": max_tokens,
    }
    if effort:
        body["reasoning"] = {"effort": effort}
    elif reasoning_off:
        body["reasoning"] = {"effort": "none"}
    if temperature is not None:
        body["temperature"] = temperature
    return body


def _chat_body(instructions: str, text: str, images: list[str], max_tokens: int, reasoning_off: bool, effort: str | None = None, temperature: float | None = None) -> dict:
    content: list[dict] = [{"type": "text", "text": text}]
    for img in images:
        content.append({"type": "image_url", "image_url": {"url": img}})
    body = {
        "model": settings.model,
        "messages": [{"role": "system", "content": instructions}, {"role": "user", "content": content}],
        "max_tokens": max_tokens,
    }
    if effort:
        body["reasoning_effort"] = effort
    elif reasoning_off:
        body["reasoning_effort"] = "none"
    if temperature is not None:
        body["temperature"] = temperature
    return body


def _extract_text(style: str, data: dict) -> tuple[str, bool]:
    if style == "chat":
        choice = (data.get("choices") or [{}])[0]
        msg = choice.get("message") or {}
        return (msg.get("content") or ""), choice.get("finish_reason") == "length"
    if isinstance(data.get("output_text"), str) and data["output_text"]:
        return data["output_text"], data.get("status") == "incomplete"
    parts: list[str] = []
    for item in data.get("output") or []:
        if item.get("type") == "message":
            for c in item.get("content") or []:
                if c.get("type") in ("output_text", "text") and isinstance(c.get("text"), str):
                    parts.append(c["text"])
    return "".join(parts), data.get("status") == "incomplete"


def _map_status(resp: httpx.Response, request_id: str | None) -> ApiError:
    s = resp.status_code
    rid = resp.headers.get("x-request-id", "")
    suffix = f" (provider request {rid})" if rid else ""
    if s in (401, 403):
        return ApiError("AUTH_REQUIRED", "The BharatCode key was rejected or lacks access to the model." + suffix, request_id, retryable=False)
    if s == 429:
        return ApiError("QUOTA_LIMIT", "BharatCode quota or rate limit reached. Try again later." + suffix, request_id)
    if s == 503:
        return ApiError("MODEL_BUSY", "The model is busy. Wait a few seconds and retry." + suffix, request_id)
    if s in (408, 504):
        return ApiError("TIMEOUT", "The model took too long to respond." + suffix, request_id)
    return ApiError("PROVIDER_ERROR", f"Provider returned HTTP {s}." + suffix, request_id)


class BharatCodeClient:
    def __init__(self) -> None:
        self._client: httpx.AsyncClient | None = None

    def _http(self) -> httpx.AsyncClient:
        if self._client is None:
            self._client = httpx.AsyncClient(
                base_url=settings.base_url,
                timeout=httpx.Timeout(settings.provider_timeout_s, connect=10),
                limits=httpx.Limits(max_connections=4),
            )
        return self._client

    async def aclose(self) -> None:
        if self._client is not None:
            await self._client.aclose()

    def _headers(self) -> dict:
        return {"Authorization": f"Bearer {settings.api_key}", "Content-Type": "application/json"}

    async def list_models(self) -> list[str]:
        if not settings.key_configured:
            raise ApiError("AUTH_REQUIRED", "No BharatCode key is configured on the server.", retryable=False)
        try:
            resp = await self._http().get("/models", headers=self._headers())
        except httpx.TimeoutException:
            raise ApiError("TIMEOUT", "Timed out contacting BharatCode.")
        except httpx.HTTPError as e:
            raise ApiError("PROVIDER_ERROR", f"Could not reach BharatCode: {type(e).__name__}.")
        if resp.status_code != 200:
            raise _map_status(resp, None)
        data = resp.json()
        items = data.get("data") if isinstance(data, dict) else data
        return [str(m.get("id")) for m in items or [] if isinstance(m, dict)]

    async def generate(
        self, instructions: str, text: str, images: list[str] | None = None, max_tokens: int | None = None, request_id: str | None = None,
        effort: str | None = None, temperature: float | None = None,
    ) -> ModelReply:
        if not settings.key_configured:
            raise ApiError("AUTH_REQUIRED", "No BharatCode key is configured on the server. Add it to server/.env.", request_id, retryable=False)
        images = images or []
        max_tokens = max_tokens or settings.max_output_tokens
        style = API_STYLE
        reasoning_off = REASONING_OFF
        path = "/chat/completions" if style == "chat" else "/responses"
        builder = _chat_body if style == "chat" else _responses_body
        started = time.perf_counter()
        for attempt in range(2):
            body = builder(instructions, text, images, max_tokens, reasoning_off, effort, temperature)
            try:
                resp = await self._http().post(path, headers=self._headers(), json=body)
            except httpx.TimeoutException:
                raise ApiError("TIMEOUT", "The model took too long to respond.", request_id)
            except httpx.HTTPError as e:
                raise ApiError("PROVIDER_ERROR", f"Could not reach BharatCode: {type(e).__name__}.", request_id)
            if resp.status_code == 400 and (reasoning_off or effort or temperature is not None) and attempt == 0:
                # some deployments reject optional fields; retry once without them
                log.warning("provider 400 with optional fields; retrying without them: %s", resp.text[:300])
                reasoning_off, effort, temperature = False, None, None
                continue
            break
        latency = int((time.perf_counter() - started) * 1000)
        if resp.status_code != 200:
            log.warning("provider error %s: %s", resp.status_code, resp.text[:300])
            raise _map_status(resp, request_id)
        try:
            data = resp.json()
        except ValueError:
            raise ApiError("INVALID_MODEL_OUTPUT", "Provider returned a non-JSON body.", request_id)
        text_out, incomplete = _extract_text(style, data)
        return ModelReply(text=text_out, latency_ms=latency, incomplete=incomplete)


_FENCE = re.compile(r"^```(?:json)?\s*|\s*```$", re.MULTILINE)


_BAD_ESCAPE = re.compile(r'\\(?!["\\/bfnrtu])')


def _loads(s: str):
    try:
        return json.loads(s)
    except ValueError:
        # models sometimes emit LaTeX-ish backslashes ("\ ", "\times"); keep them as literal text
        return json.loads(_BAD_ESCAPE.sub(r"\\\\", s))


def parse_json_object(text: str) -> dict:
    """Pull the first JSON object out of model text. Raises ValueError."""
    t = re.sub(r"<think>.*?</think>", "", text, flags=re.DOTALL).strip()
    t = _FENCE.sub("", t).strip()
    try:
        obj = _loads(t)
        if isinstance(obj, dict):
            return obj
    except ValueError:
        pass
    start = t.find("{")
    while start != -1:
        depth = 0
        in_str = False
        esc = False
        for i in range(start, len(t)):
            ch = t[i]
            if in_str:
                if esc:
                    esc = False
                elif ch == "\\":
                    esc = True
                elif ch == '"':
                    in_str = False
                continue
            if ch == '"':
                in_str = True
            elif ch == "{":
                depth += 1
            elif ch == "}":
                depth -= 1
                if depth == 0:
                    try:
                        obj = _loads(t[start : i + 1])
                        if isinstance(obj, dict):
                            return obj
                    except ValueError:
                        break
                    break
        start = t.find("{", start + 1)
    raise ValueError("no JSON object in model output")


provider = BharatCodeClient()
