from __future__ import annotations

import logging
import os
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from starlette.middleware.trustedhost import TrustedHostMiddleware

from .api.routes import router
from .config import REPO_DIR, settings
from .errors import ApiError, api_error_handler, validation_error_handler
from .providers.bharatcode import provider


class _Redact(logging.Filter):
    def filter(self, record: logging.LogRecord) -> bool:
        if settings.api_key and settings.api_key in str(record.msg):
            record.msg = str(record.msg).replace(settings.api_key, "***")
        return True


logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
for h in logging.getLogger().handlers:
    h.addFilter(_Redact())


@asynccontextmanager
async def lifespan(_: FastAPI):
    import threading

    from .maths.solve import warm_up

    if not os.environ.get("VERCEL"):
        threading.Thread(target=warm_up, daemon=True).start()  # import SymPy in the worker before the first request
    yield
    await provider.aclose()


app = FastAPI(title="NOVA", version="0.1.0", lifespan=lifespan, docs_url="/api/docs", openapi_url="/api/openapi.json")
@app.middleware("http")
async def access_gate(request, call_next):
    """Hosted for testers: every API call except capabilities needs the shared access code (keeps the model key's credit safe)."""
    import hmac

    from fastapi.responses import JSONResponse

    code = settings.access_code
    path = request.url.path
    if code and path.startswith("/api/") and path != "/api/v1/capabilities":
        given = request.headers.get("x-nova-access", "")
        if not hmac.compare_digest(given.encode(), code.encode()):
            return JSONResponse(status_code=401, content={"error": {"code": "ACCESS_REQUIRED", "message": "Enter the NOVA access code to use this test site.", "retryable": True}})
    return await call_next(request)


app.add_middleware(TrustedHostMiddleware, allowed_hosts=list(settings.allowed_hosts) + ["testserver"])
app.add_middleware(CORSMiddleware, allow_origins=list(settings.allowed_origins), allow_methods=["GET", "POST"], allow_headers=["Content-Type", "X-Nova-Access"])
app.add_exception_handler(ApiError, api_error_handler)  # type: ignore[arg-type]
app.add_exception_handler(RequestValidationError, validation_error_handler)  # type: ignore[arg-type]
app.include_router(router)

# Single browser origin: serve the built client when present (npm run build in web/).
DIST = REPO_DIR / "web" / "dist"
if DIST.exists():
    app.mount("/assets", StaticFiles(directory=DIST / "assets"), name="assets")

    @app.get("/{path:path}", include_in_schema=False)
    async def spa(path: str):
        target = (DIST / path).resolve()
        if path and target.is_file() and DIST.resolve() in target.parents:
            return FileResponse(target)
        return FileResponse(DIST / "index.html")
