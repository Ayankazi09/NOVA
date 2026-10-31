from __future__ import annotations

import base64
import binascii
import io

from PIL import Image

from .config import MAX_PNG_BYTES, MAX_PNG_EDGE
from .errors import ApiError

PNG_SIGNATURE = b"\x89PNG\r\n\x1a\n"
Image.MAX_IMAGE_PIXELS = MAX_PNG_EDGE * MAX_PNG_EDGE


def decode_png(data: str, field: str, request_id: str | None) -> str:
    """Validate a base64 PNG and return it as a data URL for the provider."""
    raw_b64 = data.split(",", 1)[1] if data.startswith("data:") else data
    try:
        raw = base64.b64decode(raw_b64, validate=True)
    except (binascii.Error, ValueError):
        raise ApiError("INVALID_INPUT", f"{field} is not valid base64.", request_id)
    if len(raw) > MAX_PNG_BYTES:
        raise ApiError("PAYLOAD_TOO_LARGE", f"{field} exceeds {MAX_PNG_BYTES // 1000} KB.", request_id, retryable=False)
    if not raw.startswith(PNG_SIGNATURE):
        raise ApiError("INVALID_INPUT", f"{field} is not a PNG image.", request_id)
    try:
        with Image.open(io.BytesIO(raw)) as im:
            w, h = im.size
            if max(w, h) > MAX_PNG_EDGE or min(w, h) < 1:
                raise ApiError("INVALID_INPUT", f"{field} must be at most {MAX_PNG_EDGE}px on its longest edge.", request_id)
            im.verify()
    except ApiError:
        raise
    except Exception:
        raise ApiError("INVALID_INPUT", f"{field} could not be decoded.", request_id)
    return "data:image/png;base64," + base64.b64encode(raw).decode("ascii")
