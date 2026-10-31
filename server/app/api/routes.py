from __future__ import annotations

import io
import time
from typing import Literal
from uuid import UUID

from fastapi import APIRouter, File, Form, UploadFile
from PIL import Image, ImageDraw, ImageFont
from pydantic import BaseModel

from .. import services
from ..config import (
    MAX_ACTIONS, MAX_AUDIO_BYTES, MAX_AUDIO_SECONDS, MAX_EQUATION_CHARS, MAX_HISTORY_TURNS, MAX_PNG_BYTES, MAX_PNG_EDGE,
    MAX_QUESTION_CHARS, MAX_TURN_CHARS, settings,
)
from ..errors import ApiError
from ..idempotency import cache
from ..maths.linear import MathError
from ..maths.graph import graph
from ..maths.solve import run as solve_run
from ..providers.bharatcode import provider
from ..schemas.models import (
    Capabilities, CheckRequest, CheckResponse, PlotPayload, PlotRequest, PlotResponse, RecognizeRequest, RecognizeResponse,
    AutoRequest, AutoResponse, GradeRequest, GradeResult, PaperAnalyzeRequest, PaperAnalyzeResponse, SolveRequest, SolveResponse,
    TutorRequest, TutorResponse,
)
from ..speech.transcriber import transcriber

router = APIRouter(prefix="/api/v1")

_status: dict = {"modelsReachable": None, "visionSmokeTested": None, "lastTestedAt": None, "lastError": None, "visionReading": None}


@router.get("/capabilities", response_model=Capabilities)
async def capabilities() -> Capabilities:
    speech = transcriber.status()
    return Capabilities(
        version="0.1.0",
        features={
            "recognize": settings.key_configured,
            "tutor": settings.key_configured,
            "check": True,
            "plot": True,
            "transcribe": bool(speech["installed"]),
            "imageImport": True,
            "pdfImport": False,
        },
        mathScopes=["arithmetic_v1", "linear_x_v1", "expr_v2", "graph_v2"],
        limits={
            "maxPngBytes": MAX_PNG_BYTES, "maxPngEdge": MAX_PNG_EDGE, "maxEquationChars": MAX_EQUATION_CHARS,
            "maxQuestionChars": MAX_QUESTION_CHARS, "maxHistoryTurns": MAX_HISTORY_TURNS, "maxTurnChars": MAX_TURN_CHARS,
            "maxActions": MAX_ACTIONS, "maxAudioBytes": MAX_AUDIO_BYTES, "maxAudioSeconds": MAX_AUDIO_SECONDS,
            "providerTimeoutS": settings.provider_timeout_s,
        },
        provider={
            "name": "BharatCode",
            "model": settings.model,
            "keyConfigured": settings.key_configured,
            "modelsReachable": _status["modelsReachable"],
            "visionSmokeTested": _status["visionSmokeTested"],
            "lastTestedAt": _status["lastTestedAt"],
            "lastError": _status["lastError"],
            "visionReading": _status["visionReading"],
        },
        speech=speech,
    )


class ConnectionTest(BaseModel):
    vision: bool = False


def _smoke_png() -> str:
    import base64

    im = Image.new("RGB", (520, 120), "white")
    d = ImageDraw.Draw(im)
    try:
        font = ImageFont.load_default(size=64)
    except TypeError:
        font = ImageFont.load_default()
    d.text((24, 22), "2x + 3 = 14", fill=(32, 37, 43), font=font)
    buf = io.BytesIO()
    im.save(buf, "PNG")
    return base64.b64encode(buf.getvalue()).decode()


@router.post("/connection/test")
async def connection_test(body: ConnectionTest) -> dict:
    _status["lastTestedAt"] = time.strftime("%Y-%m-%dT%H:%M:%S")
    try:
        models = await provider.list_models()
        _status["modelsReachable"] = settings.model in models if models else True
        _status["lastError"] = None if _status["modelsReachable"] else f"Model {settings.model} not listed for this key."
    except ApiError as e:
        _status["modelsReachable"] = False
        _status["lastError"] = f"{e.code}: {e.message}"
        return {"ok": False, "modelsReachable": False, "error": e.envelope()["error"]}
    result: dict = {"ok": bool(_status["modelsReachable"]), "modelsReachable": _status["modelsReachable"], "models": models[:20]}
    if body.vision:
        from uuid import uuid4

        from ..schemas.models import RequestContext

        ctx = RequestContext(requestId=uuid4(), pageId="smoke", contentRevision=0, regionId="smoke", sourceHash="smoke", selectionRevision=0, interpretationRevision=0)
        try:
            r = await services.recognize(RecognizeRequest(context=ctx, regionPng=_smoke_png(), regionWidth=520, regionHeight=120))
            norm = r.rawText.replace(" ", "")
            _status["visionSmokeTested"] = norm == "2x+3=14"
            _status["visionReading"] = r.rawText
            result.update(vision={"passed": _status["visionSmokeTested"], "reading": r.rawText, "latencyMs": r.latencyMs, "note": "Synthetic typed image; not handwriting evidence."})
        except ApiError as e:
            _status["visionSmokeTested"] = False
            _status["lastError"] = f"{e.code}: {e.message}"
            result.update(ok=False, vision={"passed": False, "error": e.envelope()["error"]})
    return result


@router.post("/recognize", response_model=RecognizeResponse)
async def recognize(req: RecognizeRequest) -> RecognizeResponse:
    fp = cache.fingerprint("recognize", req.model_dump(mode="json"))
    return await cache.run(str(req.context.requestId), fp, lambda: services.recognize(req))


@router.post("/tutor", response_model=TutorResponse)
async def tutor(req: TutorRequest) -> TutorResponse:
    fp = cache.fingerprint("tutor", req.model_dump(mode="json"))
    return await cache.run(str(req.context.requestId), fp, lambda: services.tutor(req))


@router.post("/check", response_model=CheckResponse)
async def check(req: CheckRequest) -> CheckResponse:
    return services.run_check(req.context, req.problem, req.current, req.confirmed)


@router.post("/plot", response_model=PlotResponse)
async def plot(req: PlotRequest) -> PlotResponse:
    try:
        g = graph(req.expression, req.xMin, req.xMax)
    except MathError as e:
        raise ApiError("UNSUPPORTED", e.message, str(req.context.requestId), retryable=False)
    return PlotResponse(context=req.context, plot=PlotPayload(**g.payload()))


@router.post("/paper/analyze", response_model=PaperAnalyzeResponse)
async def paper_analyze(req: PaperAnalyzeRequest) -> PaperAnalyzeResponse:
    fp = cache.fingerprint("paper", req.model_dump(mode="json"))
    r = await cache.run(str(req.requestId), fp, lambda: services.analyze_paper_page(req))
    return PaperAnalyzeResponse(**r)


@router.post("/paper/grade", response_model=list[GradeResult])
async def paper_grade(req: GradeRequest) -> list[GradeResult]:
    return [GradeResult(**g) for g in await services.grade(req.items)]


@router.post("/auto", response_model=AutoResponse)
async def auto(req: AutoRequest) -> AutoResponse:
    """Model-free reaction to a freshly read line: write the answer, mark it right/wrong, or do nothing."""
    r = await services.auto(req.text, req.problem, req.autoAnswer)
    return AutoResponse(context=req.context, **r)


@router.post("/solve", response_model=SolveResponse)
async def solve(req: SolveRequest) -> SolveResponse:
    """Exact, model-free: finish a '... =' line or solve an equation. Used for handwritten auto-answers."""
    import asyncio

    r = await asyncio.to_thread(solve_run, req.text, req.mode)
    completed = services.completed_line(req.text, r.answer) if r.status == "answered" and r.answer else None
    return SolveResponse(context=req.context, status=r.status, answer=r.answer, completed=completed, kind=r.kind, message=r.message, note=r.note)


@router.post("/transcribe")
async def transcribe(requestId: UUID = Form(...), audio: UploadFile = File(...)) -> dict:
    rid = str(requestId)
    if not transcriber.engine_installed():
        raise ApiError("FEATURE_UNAVAILABLE", "No speech engine is installed on the server. Typing still works.", rid, retryable=False)
    data = await audio.read(MAX_AUDIO_BYTES + 1)
    if len(data) > MAX_AUDIO_BYTES:
        raise ApiError("PAYLOAD_TOO_LARGE", "Recording is larger than 5 MB.", rid, retryable=False)
    if not data:
        raise ApiError("INVALID_INPUT", "Recording is empty.", rid, retryable=False)
    t = await transcriber.transcribe(data, audio.content_type or "", rid)
    return {"requestId": rid, "transcript": t.text, "durationS": t.duration_s, "latencyMs": t.latency_ms, "language": t.language}


@router.get("/health")
async def health() -> dict[str, Literal["ok"]]:
    return {"status": "ok"}
