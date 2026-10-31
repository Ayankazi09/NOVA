from __future__ import annotations

import logging

from fastapi import Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

log = logging.getLogger("nova.api")

STATUS = {
    "INVALID_INPUT": 422,
    "AMBIGUOUS": 422,
    "UNSUPPORTED": 422,
    "AUTH_REQUIRED": 401,
    "MODEL_BUSY": 503,
    "QUOTA_LIMIT": 429,
    "TIMEOUT": 504,
    "INVALID_MODEL_OUTPUT": 502,
    "PROVIDER_ERROR": 502,
    "FEATURE_UNAVAILABLE": 501,
    "CONFLICT": 409,
    "PAYLOAD_TOO_LARGE": 413,
}

RETRYABLE = {"MODEL_BUSY", "QUOTA_LIMIT", "TIMEOUT", "INVALID_MODEL_OUTPUT", "PROVIDER_ERROR"}


class ApiError(Exception):
    def __init__(self, code: str, message: str, request_id: str | None = None, retryable: bool | None = None):
        super().__init__(message)
        self.code = code
        self.message = message
        self.request_id = request_id
        self.retryable = code in RETRYABLE if retryable is None else retryable

    def envelope(self) -> dict:
        return {"error": {"code": self.code, "message": self.message, "retryable": self.retryable, "requestId": self.request_id}}


async def api_error_handler(request: Request, exc: ApiError) -> JSONResponse:
    log.info("%s %s -> %s: %s", request.method, request.url.path, exc.code, exc.message)
    return JSONResponse(exc.envelope(), status_code=STATUS.get(exc.code, 400))


async def validation_error_handler(request: Request, exc: RequestValidationError) -> JSONResponse:
    first = exc.errors()[0] if exc.errors() else {}
    loc = ".".join(str(p) for p in first.get("loc", []) if p != "body")
    msg = f"{loc}: {first.get('msg', 'invalid')}" if loc else first.get("msg", "Invalid input")
    log.info("%s %s -> INVALID_INPUT: %s", request.method, request.url.path, msg)
    return JSONResponse(ApiError("INVALID_INPUT", msg).envelope(), status_code=422)
