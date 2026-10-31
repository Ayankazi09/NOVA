"""Recognition + bounded tutor orchestration. Model output is validated before anything is returned."""

from __future__ import annotations

import asyncio
import logging
import os
import re
import time
from typing import Any

from pydantic import TypeAdapter, ValidationError

from .config import MAX_ACTIONS, MAX_EQUATION_CHARS, MAX_NOTE_CHARS, MAX_SPEAK_CHARS, settings
from .errors import ApiError
from .images import decode_png
from .maths.arith import check_arith, looks_arithmetic
from .maths.graph import graph
from .maths.linear import MathError, check_step, fmt, is_isolated, parse_equation, solution_set
from .maths.solve import SolveError, run as solve_run, tokenize as solve_tokenize, verify_content
from .maths.steps import explained_steps, next_step, solution_steps
from .providers.bharatcode import parse_json_object, provider
from .providers.prompts import SOLVE_ANY_INSTRUCTIONS, EXAM_NOTE, EXAM_REVIEW, PAPER_INSTRUCTIONS, RECOGNIZE_INSTRUCTIONS, RECOGNIZE_USER, TUTOR_INSTRUCTIONS
from .schemas.models import (
    Action,
    CheckResponse,
    PlotPayload,
    RecognizeRequest,
    RecognizeResponse,
    RequestContext,
    TutorRequest,
    TutorResponse,
)

log = logging.getLogger("nova.services")
_action_adapter = TypeAdapter(Action)
_CTRL = re.compile(r"[\x00-\x08\x0b-\x1f\x7f]")

# Two independent reads; disagreement becomes a clarification question instead of a silent guess.
RECOGNIZE_VOTES = max(1, min(3, int(os.environ.get("NOVA_RECOGNIZE_VOTES", "2"))))
RECOGNIZE_GRACE_S = float(os.environ.get("NOVA_RECOGNIZE_GRACE_S", "3"))  # extra wait for the second vote
RECOGNIZE_EFFORT = os.environ.get("NOVA_RECOGNIZE_EFFORT", "") or None  # e.g. "low" to let the model reason


_LATEX = [
    (re.compile(r"\\[dt]?frac\{([^{}]*)\}\{([^{}]*)\}"), lambda m: f"{_wrap(m.group(1))}/{_wrap(m.group(2))}"),
    (re.compile(r"\\sqrt\{([^{}]*)\}"), lambda m: "√" + _wrap(m.group(1))),
    (re.compile(r"\^\{?\\circ\}?"), lambda m: "°"),
    (re.compile(r"\^\{(\d)\}"), lambda m: "^" + m.group(1)),
]
_LATEX_WORDS = {r"\theta": "θ", r"\pi": "π", r"\alpha": "α", r"\beta": "β", r"\cdot": "·", r"\times": "×", r"\div": "÷",
                r"\leq": "≤", r"\geq": "≥", r"\le": "≤", r"\ge": "≥", r"\neq": "≠", r"\infty": "∞", r"\sin": "sin", r"\cos": "cos",
                r"\tan": "tan", r"\left": "", r"\right": "", r"\,": " ", r"\(": "", r"\)": "", r"\[": "", r"\]": "", "$": ""}


def _wrap(t: str) -> str:
    t = t.strip()
    return t if re.fullmatch(r"[\w√.]+", t) else f"({t})"


def delatex(s: str) -> str:
    """Models sometimes answer in LaTeX; students read plain maths (frac of sqrt 3 over 2 -> √3/2)."""
    if "\\" not in s and "$" not in s:
        return s
    for _ in range(3):
        for pat, fn in _LATEX:
            s = pat.sub(fn, s)
    for a, b in _LATEX_WORDS.items():
        s = s.replace(a, b)
    return s


def clean_text(s: Any, limit: int) -> str:
    if not isinstance(s, str):
        return ""
    s = delatex(s)
    s = _CTRL.sub("", s).replace("<", "‹").replace(">", "›").strip()
    return s[:limit]


_ASCII_MATH = {"−": "-", "–": "-", "×": "*", "÷": "/", "²": "^2", "³": "^3", "\\times": "*", "\\cdot": "*", "\\div": "/", "\\": ""}


def clean_math(s: Any, limit: int = MAX_EQUATION_CHARS) -> str:
    if not isinstance(s, str):
        return ""
    s = delatex(s)
    s = _CTRL.sub("", s)
    for a, b in _ASCII_MATH.items():
        s = s.replace(a, b)
    s = re.sub(r"\s+", " ", s).strip()
    return s[:limit]


def _norm_reading(s: str) -> str:
    """Compare readings by their maths, not their formatting: (7)/(2) == 7/2, 2·x == 2*x == 2x, ÷ == /."""
    t = re.sub(r"\s+", "", s).lower()
    for a, b in (("×", "*"), ("·", "*"), ("÷", "/"), ("−", "-"), ("–", "-"), ("…", "..."), ("²", "^2"), ("³", "^3")):
        t = t.replace(a, b)
    prev = None
    while prev != t:  # drop brackets around a single number or letter
        prev = t
        t = re.sub(r"\(([a-z0-9.]+)\)", r"\1", t)
    t = re.sub(r"(\d)\*([a-z(])", r"\1\2", t)  # 2*x -> 2x
    return t


# ------------------------------------------------------------ recognition


async def _read_once(images: list[str], user: str, rid: str, temperature: float) -> dict:
    reply = await provider.generate(RECOGNIZE_INSTRUCTIONS, user, images, max_tokens=700 if not RECOGNIZE_EFFORT else 3000, request_id=rid, effort=RECOGNIZE_EFFORT, temperature=temperature)
    if reply.incomplete:
        raise ApiError("INVALID_MODEL_OUTPUT", "The model's reading was cut off. Retry.", rid)
    try:
        obj = parse_json_object(reply.text)
    except ValueError:
        log.warning("unparseable recognition output: %r", reply.text[:300])
        raise ApiError("INVALID_MODEL_OUTPUT", "The model did not return a readable transcription. Retry.", rid)
    obj["_latency"] = reply.latency_ms
    return obj


def _parse_reading(obj: dict) -> tuple[str, str, list[str], bool]:
    status = obj.get("status") if obj.get("status") in ("expression", "incomplete", "none", "ambiguous") else "expression"
    raw = clean_math(obj.get("rawText"), 400)
    alts: list[str] = []
    for a in obj.get("alternatives") if isinstance(obj.get("alternatives"), list) else []:
        t = clean_math(a)
        if t and _norm_reading(t) != _norm_reading(raw) and all(_norm_reading(t) != _norm_reading(x) for x in alts):
            alts.append(t)
    needs = bool(obj.get("needsClarification")) or status == "ambiguous"
    if not raw:
        status, needs = "none", False
    if raw and status != "incomplete" and raw.rstrip().endswith(("=", "+", "-", "*", "/")):
        status = "incomplete"
    return status, raw, alts, needs


async def recognize(req: RecognizeRequest) -> RecognizeResponse:
    rid = str(req.context.requestId)
    images = [decode_png(req.regionPng, "regionPng", rid)]
    problem_hint = ""
    if req.problemPng:
        images.append(decode_png(req.problemPng, "problemPng", rid))
        problem_hint = "The second image is the selected problem, for context only; do NOT transcribe it and do NOT use it to correct the first image. "
    user = RECOGNIZE_USER.format(problem_hint=problem_hint, w=req.regionWidth, h=req.regionHeight)
    temps = [0.0, 0.7, 0.4][:RECOGNIZE_VOTES]
    # Don't make the student wait for the slowest vote: once one reading is back, the others get a short grace.
    tasks = [asyncio.ensure_future(_read_once(images, user, rid, t)) for t in temps]
    done, pending = await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)
    while pending and not any(t.exception() is None for t in done):
        more, pending = await asyncio.wait(pending, return_when=asyncio.FIRST_COMPLETED)
        done |= more
    if pending:
        more, pending = await asyncio.wait(pending, timeout=RECOGNIZE_GRACE_S)
        done |= more
        for t in pending:
            t.cancel()
    results = [t.exception() if t.exception() is not None else t.result() for t in tasks if t in done]
    ok = [r for r in results if isinstance(r, dict)]
    if not ok:
        err = results[0]
        raise err if isinstance(err, ApiError) else ApiError("PROVIDER_ERROR", "Reading failed.", rid)
    status, raw, alts, needs = _parse_reading(ok[0])
    latency = max(int(r.get("_latency", 0)) for r in ok)
    # self-consistency: a second independent reading that differs means the ink is genuinely unclear
    for other in ok[1:]:
        o_status, o_raw, o_alts, _ = _parse_reading(other)
        if o_raw and raw and _norm_reading(o_raw) != _norm_reading(raw):
            needs = True
            if all(_norm_reading(o_raw) != _norm_reading(a) for a in alts):
                alts.insert(0, o_raw)
        elif not raw and o_raw:
            status, raw, alts, needs = o_status, o_raw, o_alts, True
    alts = alts[:3]
    if status == "incomplete":
        needs = False  # still being written: read it again when it is finished, don't interrupt
    if needs and not alts:
        needs = bool(ok[0].get("needsClarification")) and len(ok) == 1
    note = {
        "incomplete": "This line looks unfinished.",
        "none": "No maths was found in this area.",
        "ambiguous": "Some symbols could be read more than one way.",
    }.get(status)
    return RecognizeResponse(
        context=req.context, status=status, rawText=raw, alternatives=alts, needsClarification=needs,
        note=note, model=settings.model, latencyMs=latency,
    )


# ------------------------------------------------------------------ check


def run_check(ctx: RequestContext, problem: str, current: str, confirmed: bool) -> CheckResponse:
    if not confirmed:
        return CheckResponse(
            context=ctx,
            status="needs_clarification",
            message="Confirm the reading of both lines before checking. A reading error is not your mistake.",
        )
    if looks_arithmetic(current):
        a = check_arith(current)
        return CheckResponse(context=ctx, status=a.status, message=a.message, scope="arithmetic_v1")  # type: ignore[arg-type]
    r = check_step(problem, current)
    return CheckResponse(
        context=ctx,
        status=r.status,  # type: ignore[arg-type]
        message=r.message,
        problemSolution=r.problemSolution,
        currentSolution=r.currentSolution,
        parsedProblem=r.parsedProblem,
        parsedCurrent=r.parsedCurrent,
    )


# ------------------------------------------------------------------ tutor


def _known_regions(req: TutorRequest) -> set[str]:
    ids = set(req.regionIds) | {req.context.regionId, "page"}
    if req.problem:
        ids.add(req.problem.regionId)
    if req.current:
        ids.add(req.current.regionId)
    return ids


def _unique_solution(problem: str | None) -> str | None:
    if not problem:
        return None
    try:
        s = solution_set(*parse_equation(problem))
    except MathError:
        return None
    return fmt(s.value) if s.kind == "unique" and s.value is not None else None


def _redact_answer(text: str, answer: str | None) -> str:
    if not answer:
        return text
    pat = re.compile(r"\bx\s*=\s*" + re.escape(answer) + r"(?!\d|[./]\d)")
    return pat.sub("x = ?", text)


def _redact_value(text: str, value: str | None) -> str:
    """Arithmetic: hide '= 5' / 'is 5' / 'equals 5' style reveals in hints."""
    if not value:
        return text
    pat = re.compile(r"(=|\bis|\bequals|\bmakes|\bgives)\s*" + re.escape(value) + r"(?!\d|[./]\d)", re.IGNORECASE)
    return pat.sub(lambda m: m.group(1) + " ?", text)


def _plot_payload(expression: str, x_min: float | None = None, x_max: float | None = None) -> PlotPayload:
    g = graph(expression, x_min, x_max)
    return PlotPayload(**g.payload())


def _graph_explanation(p: PlotPayload) -> str:
    if p.kind == "equation":
        sols = [pt["label"] for pt in p.points if pt.get("kind") == "solution"]
        lead = f"Graph of both sides of {p.normalized}."
        if sols:
            return f"{lead} They cross at {', '.join(sols)}, so that is the solution."
        return f"{lead} {p.note}"
    roots = [pt["label"] for pt in p.points if pt.get("kind") == "root"]
    inter = [pt["label"] for pt in p.points if pt.get("kind") == "intercept"]
    bits = [f"Graph of {p.normalized}."]
    if inter:
        bits.append(f"It crosses the y-axis at {inter[0]}.")
    if roots:
        bits.append(f"It meets the x-axis at {', '.join(roots[:4])}.")
    return " ".join(bits)


def _build_prompt(req: TutorRequest, known: set[str], check: CheckResponse | None) -> str:
    lines = [f"INTENT: {req.intent}", f"KNOWN_REGIONS: {', '.join(sorted(known))}", f"SELECTED_REGION: {req.context.regionId}"]
    lines.append("STUDENT_WORK:")
    if req.problem:
        lines.append(f"  problem (region {req.problem.regionId}, {'confirmed' if req.problem.accepted else 'unconfirmed reading'}): {req.problem.text}")
    else:
        lines.append("  problem: (none selected)")
    if req.current:
        lines.append(f"  current step (region {req.current.regionId}, {'confirmed' if req.current.accepted else 'unconfirmed reading'}): {req.current.text}")
    else:
        lines.append("  current step: (no working yet)")
    if check:
        lines.append(f"CHECK RESULT (deterministic, scope {check.scope}): {check.status} - {check.message}")
        if check.problemSolution:
            lines.append(f"  problem solution: {check.problemSolution}; current line solution: {check.currentSolution}")
    if req.pageLines:
        lines.append("PAGE_LINES (everything written on this page, top to bottom; context only):")
        for pl in req.pageLines[:30]:
            lines.append(f"  [{pl.regionId}] {pl.text}")
    if not req.problem and not req.current:
        lines.append("NOTE: nothing is selected, so the question is about the page or maths in general, not a particular line.")
    if req.history:
        lines.append("HISTORY (oldest first):")
        for t in req.history[-6:]:
            lines.append(f"  {t.role}: {t.text}")
    if req.exam:
        note = EXAM_REVIEW if req.exam.reveal else EXAM_NOTE
        lines.append(note.format(number=req.exam.number, text=req.exam.text, answer=req.exam.answer))
    lines.append(f"QUESTION: {req.question or '(no question typed; give the most useful single hint for the intent)'}")
    return "\n".join(lines)


def _validate_actions(raw_actions: Any, req: TutorRequest, known: set[str], answer: str | None, value: str | None = None) -> list[Any]:
    out: list[Any] = []
    if not isinstance(raw_actions, list):
        return out
    rid = str(req.context.requestId)
    hide = req.intent != "complete"
    for item in raw_actions:
        if len(out) >= MAX_ACTIONS:
            break
        if not isinstance(item, dict):
            continue
        typ = item.get("type")
        anchor = item.get("anchorRegionId")
        if anchor not in known:
            anchor = req.context.regionId
        aid = f"{rid}:{len(out)}"

        def red(t: str) -> str:
            return _redact_value(_redact_answer(t, answer if hide else None), value if hide else None)

        try:
            if typ == "highlight_region":
                if any(o.type == "highlight_region" and o.anchorRegionId == anchor for o in out):
                    continue  # one highlight per line
                obj = {"id": aid, "type": typ, "anchorRegionId": anchor, "reason": red(clean_text(item.get("reason"), 120))}
            elif typ == "add_note":
                text = red(clean_text(item.get("text"), MAX_NOTE_CHARS))
                if not text:
                    continue
                obj = {"id": aid, "type": typ, "anchorRegionId": anchor, "text": text}
            elif typ == "write_equation":
                expr = clean_math(item.get("expression"))
                purpose = item.get("purpose") if item.get("purpose") in ("hint", "completion") else "hint"
                if purpose == "completion":
                    continue  # completion equations are produced only by the validated complete path
                if value and hide and re.search(r"=\s*" + re.escape(value) + r"\s*$", expr):
                    continue
                try:
                    l, r = parse_equation(expr)
                    solution_set(l, r)
                    if answer and is_isolated(l, r):
                        continue  # a hint must not reveal the solved form
                except MathError:
                    try:
                        solve_tokenize(expr)
                    except SolveError:
                        continue
                obj = {"id": aid, "type": typ, "anchorRegionId": anchor, "expression": expr, "purpose": "hint", "verified": False}
            elif typ == "draw_groups":
                groups = [clean_text(g, 24) for g in (item.get("groups") or []) if clean_text(g, 24)]
                if not 2 <= len(groups) <= 4:
                    continue
                obj = {"id": aid, "type": typ, "anchorRegionId": anchor, "groups": groups, "caption": red(clean_text(item.get("caption"), 120))}
            elif typ == "plot_function":
                try:
                    x0 = float(item["xMin"]) if "xMin" in item else None
                    x1 = float(item["xMax"]) if "xMax" in item else None
                    plot = _plot_payload(clean_math(item.get("expression"), 200), x0, x1)
                except (MathError, TypeError, ValueError):
                    continue
                obj = {"id": aid, "type": typ, "anchorRegionId": anchor, "plot": plot.model_dump()}
            elif typ == "write_lines":
                lines_in, inks = [], []
                for x in (item.get("lines") or [])[:20]:
                    text, ink = (x, "blue") if isinstance(x, str) else ((x.get("text"), x.get("ink")) if isinstance(x, dict) else ("", ""))
                    text = clean_math(text, 80)
                    if text:
                        lines_in.append(text)
                        inks.append(ink if ink in ("blue", "red", "black") else "blue")
                if not lines_in:
                    continue
                obj = {"id": aid, "type": typ, "anchorRegionId": anchor if anchor in known else "page", "title": clean_text(item.get("title"), 60), "lines": lines_in, "inks": inks}
            elif typ == "write_table":
                header = [clean_math(x, 40) for x in (item.get("header") or []) if isinstance(x, str)][:8]
                rows = [[clean_math(c, 40) for c in r if isinstance(c, str)][:8] for r in (item.get("rows") or []) if isinstance(r, list)][:14]
                rows = [r for r in rows if r]
                if not header or not rows:
                    continue
                obj = {"id": aid, "type": typ, "anchorRegionId": anchor if anchor in known else "page", "title": clean_text(item.get("title"), 60), "header": header, "rows": rows}
            elif typ == "speak":
                text = red(clean_text(item.get("text"), MAX_SPEAK_CHARS))
                if not text:
                    continue
                obj = {"id": aid, "type": typ, "anchorRegionId": anchor, "text": text}
            else:
                continue  # unknown action types are rejected
            out.append(_action_adapter.validate_python(obj))
        except ValidationError:
            continue
    return out


async def _ask_model(req: TutorRequest, known: set[str], check: CheckResponse | None) -> tuple[str, list[dict], str]:
    rid = str(req.context.requestId)
    reply = await provider.generate(TUTOR_INSTRUCTIONS, _build_prompt(req, known, check), max_tokens=900, request_id=rid)
    if reply.incomplete:
        raise ApiError("INVALID_MODEL_OUTPUT", "The tutor reply was cut off. Retry.", rid)
    try:
        obj = parse_json_object(reply.text)
    except ValueError:
        raise ApiError("INVALID_MODEL_OUTPUT", "The tutor reply could not be read. Retry.", rid)
    explanation = clean_text(obj.get("explanation"), 600)
    if not explanation:
        raise ApiError("INVALID_MODEL_OUTPUT", "The tutor reply was empty. Retry.", rid)
    return explanation, obj.get("actions") or [], settings.model


def _needs_accepted(req: TutorRequest, need_current: bool) -> None:
    rid = str(req.context.requestId)
    if not req.problem or not req.problem.accepted:
        raise ApiError("AMBIGUOUS", "Select the problem and confirm its reading first.", rid, retryable=False)
    if need_current and req.current and not req.current.accepted:
        raise ApiError("AMBIGUOUS", "Confirm the reading of your current line first.", rid, retryable=False)


def _has_y(text: str) -> bool:
    return bool(re.search(r"[yY]", text))


async def tutor(req: TutorRequest) -> TutorResponse:
    started = time.perf_counter()
    ctx = req.context
    rid = str(ctx.requestId)
    known = _known_regions(req)
    anchor = req.current.regionId if req.current else (req.problem.regionId if req.problem else ctx.regionId)

    def done(explanation: str, actions: list, check=None, verified="none", model=None) -> TutorResponse:
        return TutorResponse(
            context=ctx, explanation=explanation, actions=actions, check=check, verifiedBy=verified, model=model,
            latencyMs=int((time.perf_counter() - started) * 1000),
        )

    def plot_response(expr: str, lead: str = "") -> TutorResponse:
        try:
            plot = _plot_payload(expr)
        except MathError as e:
            raise ApiError("UNSUPPORTED", f"NOVA can't graph this line: {e.message}", rid, retryable=False)
        act = _action_adapter.validate_python({"id": f"{rid}:0", "type": "plot_function", "anchorRegionId": anchor, "plot": plot.model_dump()})
        return done((lead + " " if lead else "") + _graph_explanation(plot), [act], verified="deterministic")

    # ---- plot: fully deterministic, any equation with x and/or y
    if req.intent == "plot":
        expr = req.plotExpression or (req.current.text if req.current else None) or (req.problem.text if req.problem else None)
        if not expr:
            raise ApiError("INVALID_INPUT", "Write or select an equation like y = x^2 - 4 to graph.", rid, retryable=False)
        return plot_response(expr)

    target = req.current or req.problem

    # ---- solve: a full, verified answer (value of a "... =" line, or the solution set of an equation/inequality)
    if req.intent == "solve":
        if not target:
            raise ApiError("INVALID_INPUT", "Select the line you want solved.", rid, retryable=False)
        r = await asyncio.to_thread(solve_run, target.text, "auto")
        if r.status != "answered" or not r.answer:
            return done(f"NOVA can't solve this exactly: {r.message or 'unsupported form'}", [], verified="none")
        act = _action_adapter.validate_python({"id": f"{rid}:0", "type": "write_equation", "anchorRegionId": target.regionId, "expression": completed_line(target.text, r.answer), "purpose": "completion", "verified": True})
        note = {"solved": "Solved exactly by NOVA's maths engine.", "value": "Worked out exactly.", "simplified": "Simplified exactly.",
                "expanded": "Expanded.", "factorised": "Factorised.", "rearranged": "Rearranged exactly.", "truth": "Checked exactly.", "integral": "Integrated exactly."}.get(r.kind or "", "Worked out exactly.")
        if r.note:
            note += f" ({r.note})"
        return done(note, [act], verified="deterministic")

    # ---- lines ending "=" beyond plain arithmetic: trig values, identities, algebra, calculus
    if target and target.text.rstrip().endswith("=") and not looks_arithmetic(target.text):
        r = await asyncio.to_thread(solve_run, target.text, "finish")
        if req.intent == "complete":
            if r.status != "answered" or not r.answer:
                return done(f"NOVA can't finish this line exactly: {r.message or 'unsupported form'}", [], verified="none")
            act = _action_adapter.validate_python({"id": f"{rid}:0", "type": "write_equation", "anchorRegionId": target.regionId, "expression": completed_line(target.text, r.answer), "purpose": "completion", "verified": True})
            return done("Here is the finished line, worked out exactly by NOVA.", [act], verified="deterministic")
        if req.intent == "check":
            return done("This line isn't finished yet. Write your answer after '=', then check again.", [], verified="deterministic")
        expl, raw, model = await _ask_model(req, known, None)
        hidden = r.answer if r.status == "answered" else None
        return done(_redact_value(expl, hidden), _validate_actions(raw, req, known, None, hidden), verified="model", model=model)

    # ---- arithmetic lines (3 + 2 =, 12 / 4 = 3, 2^3 = 8)
    if target and looks_arithmetic(target.text):
        ar = check_arith(target.text)
        check = CheckResponse(context=ctx, status=ar.status, message=ar.message, scope="arithmetic_v1")  # type: ignore[arg-type]
        if req.intent in ("check", "complete") and not target.accepted:
            raise ApiError("AMBIGUOUS", "Confirm the reading of the line first.", rid, retryable=False)
        if req.intent == "complete":
            if ar.status == "incomplete" and ar.completed:
                act = _action_adapter.validate_python({"id": f"{rid}:0", "type": "write_equation", "anchorRegionId": target.regionId, "expression": ar.completed, "purpose": "completion", "verified": True})
                return done("Here is the finished line, worked out exactly by NOVA.", [act], check=check, verified="deterministic")
            if ar.status == "correct":
                return done("This line is already correct. Nothing more to complete.", [], check=check, verified="deterministic")
            if ar.status == "unsupported":
                return done(f"NOVA can't complete this safely: {ar.message}", [], check=check, verified="deterministic")
            # incorrect: corrective hint, not the answer
        if req.intent == "check" and ar.status in ("correct", "unsupported", "incomplete"):
            msg = ar.message if ar.status != "incomplete" else "This line isn't finished yet. Work out the value, write it after '=', then check again."
            return done(msg, [], check=check, verified="deterministic")
        try:
            hint_req = req.model_copy(update={"intent": "hint" if req.intent == "complete" else req.intent})
            expl, raw, model = await _ask_model(hint_req, known, check)
            expl = _redact_value(expl, ar.value)
            acts = _validate_actions(raw, hint_req, known, None, ar.value)
        except ApiError as e:
            if req.intent not in ("check", "complete"):
                raise
            log.info("arithmetic hint fell back to deterministic text: %s", e.code)
            expl, acts, model = ("Not quite. Work it out again carefully, one step at a time." if ar.status == "incorrect" else ar.message), [], None
        if ar.status == "incorrect" and not any(a.type == "highlight_region" for a in acts):
            hl =_action_adapter.validate_python({"id": f"{rid}:{len(acts)}", "type": "highlight_region", "anchorRegionId": target.regionId, "reason": "Check this answer again"})
            acts = (acts + [hl])[:MAX_ACTIONS]
        return done(expl, acts, check=check, verified="deterministic", model=model)

    # ---- graph equations (contain y): Check / Next step mean "show me the graph"
    if target and _has_y(target.text) and req.intent in ("check", "complete"):
        return plot_response(target.text, "This is an equation of a graph, so here is its graph.")

    check: CheckResponse | None = None
    if req.problem and req.current and req.problem.accepted and req.current.accepted:
        check = run_check(ctx, req.problem.text, req.current.text, True)
        if check.status == "unsupported":
            # beyond linear: compare solution sets exactly (quadratics, trig equations, ...)
            r = await asyncio.to_thread(solve_run, req.problem.text, "compare", req.current.text)
            if r.status in ("equivalent", "different", "solved"):
                msg = {"equivalent": "This line keeps the same solutions as the problem.",
                       "different": "This line has different solutions from the problem, so a step has changed the equation.",
                       "solved": "Solved: this line gives exactly the problem's solutions."}[r.status]
                check = CheckResponse(context=ctx, status=r.status, message=msg, scope="expr_v2")  # type: ignore[arg-type]

    # ---- check: deterministic verdict, model only phrases the why
    if req.intent == "check":
        _needs_accepted(req, need_current=True)
        if not req.current:
            assert req.problem is not None
            try:
                parse_equation(req.problem.text)
                return done("This is the problem line. Write your next step below it, then check that step.", [], verified="deterministic")
            except MathError as e:
                return done(f"NOVA can't check this line: {e.message}", [], verified="deterministic")
        assert check is not None
        actions: list = []
        if check.status == "different":
            actions.append(_action_adapter.validate_python({"id": f"{rid}:0", "type": "highlight_region", "anchorRegionId": req.current.regionId, "reason": "This line changes the solution"}))
        explanation = check.message
        model = None
        if check.status == "different":
            try:
                expl, raw, model = await _ask_model(req, known, check)
                explanation = _redact_answer(expl, _unique_solution(req.problem.text if req.problem else None))
                extra = [a for a in _validate_actions(raw, req, known, _unique_solution(req.problem.text if req.problem else None)) if a.type != "highlight_region"]
                for a in extra[: MAX_ACTIONS - len(actions)]:
                    a.id = f"{rid}:{len(actions)}"
                    actions.append(a)
            except ApiError as e:
                log.info("check explanation fell back to deterministic text: %s", e.code)
        return done(explanation, actions, check=check, verified="deterministic", model=model)

    # ---- complete: explicit one-step completion, validated
    if req.intent == "complete":
        _needs_accepted(req, need_current=True)
        assert req.problem is not None
        base = req.current.text if req.current else req.problem.text
        if check and check.status == "different":
            hint_req = req.model_copy(update={"intent": "hint"})
            try:
                expl, raw, model = await _ask_model(hint_req, known, check)
                acts = _validate_actions(raw, hint_req, known, _unique_solution(req.problem.text))
            except ApiError:
                expl, acts, model = "This line doesn't match the problem yet, so NOVA won't continue from it. Look again at the step before it.", [], None
            return done("Before continuing: " + expl, acts, check=check, verified="deterministic", model=model)
        if check and check.status == "solved":
            return done("This line is already solved. Nothing more to complete.", [], check=check, verified="deterministic")
        if check and check.status == "unsupported":
            return done(f"NOVA can't complete this safely: {check.message}", [], check=check, verified="deterministic")
        try:
            parse_equation(base)
        except MathError:
            # beyond linear (quadratics, trig, ...): the model proposes one step; NOVA accepts it only if the
            # solution set is provably unchanged, otherwise it falls back to the exact full solution.
            explanation, model = "", None
            try:
                expl, raw, model = await _ask_model(req, known, check)
                explanation = expl
                for item in raw if isinstance(raw, list) else []:
                    if isinstance(item, dict) and item.get("type") == "write_equation":
                        cand = clean_math(item.get("expression"))
                        if cand and _shape_eq(cand) != _shape_eq(base):
                            ok1 = await asyncio.to_thread(solve_run, req.problem.text, "compare", cand)
                            if ok1.status in ("equivalent", "solved"):
                                act = _action_adapter.validate_python({"id": f"{rid}:0", "type": "write_equation", "anchorRegionId": anchor, "expression": cand, "purpose": "completion", "verified": True})
                                return done(explanation, [act], check=check, verified="deterministic", model=model)
            except ApiError as e:
                log.info("non-linear step: model unavailable (%s)", e.code)
            r = await asyncio.to_thread(solve_run, base, "solve")
            if r.status == "answered" and r.answer:
                act = _action_adapter.validate_python({"id": f"{rid}:0", "type": "write_equation", "anchorRegionId": anchor, "expression": completed_line(base, r.answer), "purpose": "completion", "verified": True})
                return done("NOVA couldn't verify a single step here, so this is the exact solution.", [act], check=check, verified="deterministic", model=model)
            return done(f"NOVA can't take a checked next step from this line: {r.message}", [], check=check, verified="deterministic", model=model)
        proposal: str | None = None
        explanation = ""
        model = None
        try:
            expl, raw, model = await _ask_model(req, known, check)
            explanation = expl
            for item in raw if isinstance(raw, list) else []:
                if isinstance(item, dict) and item.get("type") == "write_equation":
                    cand = clean_math(item.get("expression"))
                    if _valid_completion(req.problem.text, base, cand):
                        proposal = cand
                        break
        except ApiError as e:
            log.info("completion model unavailable (%s); using deterministic step", e.code)
        if proposal is None:
            proposal = next_step(base)
            if proposal is not None and not _valid_completion(req.problem.text, base, proposal):
                proposal = None
            explanation = explanation or "Here is one next step that keeps the same solution."
        if proposal is None:
            return done("This line is already as simple as NOVA can make it in one checked step.", [], check=check, verified="none", model=model)
        act = _action_adapter.validate_python(
            {"id": f"{rid}:0", "type": "write_equation", "anchorRegionId": anchor, "expression": proposal, "purpose": "completion", "verified": True}
        )
        return done(explanation, [act], check=check, verified="deterministic", model=model)

    # ---- ask / hint / explain: model hint, validated actions
    if not req.problem and not req.current and not req.question.strip():
        raise ApiError("INVALID_INPUT", "Select some work or type a question first.", rid, retryable=False)
    answer = _unique_solution(req.problem.text if req.problem else None)
    explanation, raw, model = await _ask_model(req, known, check)
    explanation = _redact_answer(explanation, answer)
    if req.exam and not req.exam.reveal and req.intent != "complete":
        explanation = _redact_value(explanation, _final_value(req.exam.answer) or None)
    actions = await _verify_written(_validate_actions(raw, req, known, answer))
    return done(explanation, actions, check=check, verified="deterministic" if check else "model", model=model)


_TASK = re.compile(
    r"=|\?|…|\.\.\.|∪|∩|∈|⊂|⊆|∫|∑|lim|d/d|'|′|\b(derive|show|hence|verify|calculate|compute|find|solve|evaluate|simplify|factori[sz]e|expand|differentiate|derivative|integrate|"
    r"prove|sum|series|sequence|term|AP|GP|area|perimeter|volume|surface|radius|diameter|circumference|circle|triangle|square|rectangle|polygon|angle|hypotenuse|pythagoras|sector|arc|chord|tangent|cone|cylinder|sphere|cube|cm|m2|probability|mean|median|mode|variance|matrix|det|log|ln|nCr|nPr|union|intersection)\b",
    re.I,
)


async def solve_any(text: str, problem: str | None) -> dict | None:
    """Anything the exact engine can't do (functions, calculus, series, sets, ...): NOVA's maths model writes the worked solution."""
    user = f"STUDENT LINE: {text}" + (f"\nPROBLEM THEY ARE WORKING ON: {problem}" if problem and problem != text else "")
    try:
        reply = await provider.generate(SOLVE_ANY_INSTRUCTIONS, user, max_tokens=6000, effort="low")
        obj = parse_json_object(reply.text)
    except Exception as e:  # never break the page over a bonus answer
        log.warning("solve_any failed: %s", type(e).__name__)
        return None
    steps = [clean_math(x, 60) for x in (obj.get("steps") or []) if isinstance(x, str) and clean_math(x, 60)][:8]
    if not steps:
        return None
    notes = [(clean_math(x, 60) if isinstance(x, str) else "") for x in (obj.get("notes") or [])][: len(steps)]
    notes += [""] * (len(steps) - len(notes))
    keep = [i for i, st in enumerate(steps) if i == 0 or _norm_reading(st) != _norm_reading(steps[i - 1])]  # no repeated lines
    steps, notes = [steps[i] for i in keep], [notes[i] for i in keep]
    notes[-1] = notes[-1] or "answer"
    return {"kind": "solution", "steps": steps, "notes": notes, "moves": [None] * len(steps), "answer": clean_math(obj.get("answer"), 80) or steps[-1], "message": "Solved by NOVA."}


_QUESTION = re.compile(
    r"\?|^\s*[a-zθ](\s*\(\s*\w+\s*\))?\s*=\s*$|^\s*(f|g|h)\s*['′]+.*=\s*\??\s*$|^\s*d\s*[a-z]?\s*/\s*d\s*[a-z].*=\s*\??\s*$"
    r"|^\s*(find|solve|derive|prove|show|simplify|hence|evaluate|differentiate|integrate|factori[sz]e)\b",
    re.I,
)


async def _answer_question(q: str, problem: str) -> dict:
    """A question written under a problem: solve the problem (exact working with arrows when possible)."""
    target = re.match(r"^\s*([a-zθ])\s*=\s*\??\s*$", q, re.I)
    if target or re.match(r"^\s*(find|solve)\b", q, re.I):
        exact = await _auto_exact(problem, None, True)
        if exact.get("kind") == "solution":
            return exact
    return await solve_any(q, problem) or {"kind": "none"}


async def auto(text: str, problem: str | None, auto_answer: bool) -> dict:
    """Exact maths first; if that can't help and the line is a question, NOVA's maths model solves it."""
    t = re.sub(r"\s+", " ", text).strip()
    if problem and auto_answer and _QUESTION.search(t):
        # "x = ?", "x =", "f'(2) = ?", "dy/dx =", "find x", "derive ..." under a problem: answer it from the problem
        return await _answer_question(t, problem)
    res = await _auto_exact(text, problem, auto_answer)
    if res.get("kind") != "none" or not auto_answer or res.get("suggest") == "graph" or not _TASK.search(t):
        return res
    return await solve_any(t, problem) or res


async def _auto_exact(text: str, problem: str | None, auto_answer: bool) -> dict:
    """What NOVA does by itself with a freshly read line (no model): answer it, mark it, or leave it."""
    t = re.sub(r"\s+", " ", text).strip()
    if t.endswith("="):
        if not auto_answer:
            return {"kind": "none"}
        r = await asyncio.to_thread(solve_run, t, "finish")
        if r.status == "answered" and r.answer:
            return {"kind": "answer", "answer": r.answer, "message": "Worked out exactly by NOVA."}
        return {"kind": "none", "message": r.message}
    if "=" not in t:
        return {"kind": "none"}
    if looks_arithmetic(t):
        a = check_arith(t)
        if a.status in ("correct", "incorrect"):
            return {"kind": "mark", "verdict": a.status, "message": a.message if a.status == "correct" else "This answer isn't right yet."}
        return {"kind": "none", "message": a.message}
    # a working step under an equation problem: same solutions?
    if problem and _shape_eq(problem) != _shape_eq(t):
        r = check_step(problem, t)
        status = r.status
        if status == "unsupported":
            c = await asyncio.to_thread(solve_run, problem, "compare", t)
            status = c.status
        if status in ("equivalent", "solved", "different"):
            msgs = {"equivalent": "Same solutions as the problem.", "solved": "Solved correctly.", "different": "This step changes the solution."}
            return {"kind": "mark", "verdict": status, "message": msgs[status]}
        return {"kind": "none"}
    if _has_y(t) and re.search(r"[xX]", t):
        return {"kind": "none", "suggest": "graph"}  # an equation of a graph: offer to draw it
    # a statement with no unknown to find (sin 30° = 1/2) or an identity (sin²θ + cos²θ = 1)
    r = await asyncio.to_thread(solve_run, t, "solve")
    if r.status == "answered" and (r.kind == "truth" or (r.answer or "").startswith("true for every")):
        ok = (r.answer or "").startswith("true")
        return {"kind": "mark", "verdict": "correct" if ok else "incorrect", "message": "Correct." if ok else "This isn't true."}
    # no exact form (sin x + tan x = 30): solve it numerically, every root, general solution for trig
    if r.status in ("timeout", "unsupported") and auto_answer and t.count("=") == 1:
        nr = await asyncio.to_thread(solve_run, t, "numeric")
        if nr.status == "answered" and nr.answer:
            lhs, _, rhs = t.partition("=")
            var = (re.search(r"[a-zθ]", re.sub(r"sin|cos|tan|sec|cosec|cot|log|ln", "", lhs + rhs)) or ["x"])[0]
            roots = nr.answer.split(" or ")
            steps = [f"f({var}) = {nr.approx} = 0", "no exact algebra form"]
            notes = ["move everything to one side", "so solve it numerically"]
            for root in roots:
                steps.append(root + (" + 2nπ" if nr.note else ""))
                notes.append("where f changes sign" if not nr.note else "repeats every 2π")
            notes[-1] = "answer"
            return {"kind": "solution", "steps": steps[:10], "notes": notes[:10], "moves": [None] * min(10, len(steps)), "answer": nr.answer, "message": "Solved numerically by NOVA."}
    # an equation to solve (x + 3 = 4): write the whole worked solution
    if r.status == "answered" and r.kind in ("solved", "rearranged") and r.answer:
        if not auto_answer:
            return {"kind": "none", "suggest": "solve"}
        explained = explained_steps(t)
        steps = [e["text"] for e in explained] if explained else []
        notes = [e["note"] for e in explained] if explained else []
        moves = [e["move"] for e in explained] if explained else []
        if not steps:
            fact = await asyncio.to_thread(solve_run, _lhs_minus_rhs(t), "finish")
            if fact.status == "answered" and fact.kind == "factorised" and fact.answer:
                steps.append(f"{fact.answer} = 0")
            steps.append(r.answer)
            notes = (["factorise the left side", "each bracket = 0 gives a value of x"] if len(steps) == 2 else ["answer"])
            moves = [None] * len(steps)
        return {"kind": "solution", "steps": steps[:10], "notes": notes[:10], "moves": moves[:10], "answer": r.answer, "message": "Solved exactly by NOVA." + (f" ({r.note})" if r.note else "")}
    return {"kind": "none"}


def _lhs_minus_rhs(t: str) -> str:
    l, _, r = t.partition("=")
    r = r.strip()
    return f"{l.strip()} =" if r in ("0", "") else f"{l.strip()} - ({r}) ="


async def _verify_written(actions: list) -> list:
    """Every value NOVA writes onto the page is checked exactly; wrong values are corrected before writing."""
    for a in actions:
        if a.type == "write_table":
            r = await asyncio.to_thread(verify_content, "table", {"header": a.header, "rows": a.rows})
            if "rows" in r:
                a.rows = [[c[:40] for c in row] for row in r["rows"]]
                a.verifiedCells, a.corrected, a.unverifiedCells = r["verified"], r["corrected"], r["unverified"]
        elif a.type == "write_lines":
            r = await asyncio.to_thread(verify_content, "lines", {"lines": a.lines})
            if "results" in r:
                fixed, inks = [], []
                for k, (line, res) in enumerate(zip(a.lines, r["results"])):
                    ink = a.inks[k] if k < len(a.inks) else "blue"
                    if res["fixed"]:
                        fixed.append(res["fixed"][:80])
                        a.corrected += 1
                    elif res["ok"] is False:
                        continue  # a false statement with nothing to correct: never write it
                    else:
                        fixed.append(line)
                    inks.append(ink)
                    a.verified.append(res["ok"] is True or bool(res["fixed"]))
                a.lines, a.inks = fixed, inks
    return [a for a in actions if not (a.type == "write_lines" and not a.lines)]


# ------------------------------------------------------------------ question papers


async def analyze_paper_page(req) -> dict:
    """Read one page of a question paper: questions, where they are, and a verified answer key."""
    rid = str(req.requestId)
    image = decode_png(req.png, "png", rid)
    text_lines = "\n".join(f"[{l.id}] {l.text}" for l in req.lines[:250]) or "(no text layer: use bbox)"
    started = time.perf_counter()
    reply = await provider.generate(PAPER_INSTRUCTIONS, f"PAGE {req.pageIndex + 1}\nTEXT_LINES:\n{text_lines}", [image], max_tokens=6000, request_id=rid, effort="low")
    if reply.incomplete:
        raise ApiError("INVALID_MODEL_OUTPUT", "The paper reading was cut off. Retry.", rid)
    try:
        obj = parse_json_object(reply.text)
    except ValueError:
        raise ApiError("INVALID_MODEL_OUTPUT", "NOVA could not read the questions on this page. Retry.", rid)
    known = {l.id for l in req.lines}
    out = []
    for q in (obj.get("questions") or [])[:40]:
        if not isinstance(q, dict) or not clean_text(q.get("text"), 1500):
            continue
        bbox = q.get("bbox") if isinstance(q.get("bbox"), list) and len(q.get("bbox")) == 4 else []
        try:
            bbox = [max(0.0, min(1000.0, float(v))) for v in bbox]
        except (TypeError, ValueError):
            bbox = []
        item = {
            "number": clean_text(q.get("number"), 20) or str(len(out) + 1),
            "text": clean_text(q.get("text"), 1500),
            "lineIds": [str(x) for x in (q.get("lineIds") or []) if str(x) in known][:60],
            "bbox": bbox,
            "kind": q.get("kind") if q.get("kind") in ("mcq", "numeric", "expression", "equation", "proof", "other") else "other",
            "options": [clean_text(o, 120) for o in (q.get("options") or []) if isinstance(o, str)][:8],
            "answer": clean_math(q.get("answer"), 200),
            "check": clean_math(q.get("check"), 200),
        }
        await _verify_answer(item)
        out.append(item)
    return {"pageIndex": req.pageIndex, "questions": out, "latencyMs": int((time.perf_counter() - started) * 1000)}


def _final_value(answer: str) -> str:
    """'x = 4' -> '4'; '12 cm²' -> '12'; MCQ labels like '(b) 4' are left alone."""
    a = answer.strip()
    if re.match(r"^\(?[a-dA-D]\)", a):
        return a
    if a.count("=") == 1 and re.match(r"^[a-zθ]\s*=", a):
        a = a.split("=")[-1].strip()
    return re.sub(r"\s*(cm|m|km|kg|g|s|units?|sq\.?\s*units?|°c)[²³]?\s*$", "", a, flags=re.IGNORECASE).strip()


def _option_value(options: list[str], letter: str) -> str | None:
    for o in options:
        m = re.match(r"^\s*\(?([a-dA-D])\)\s*(.+)$", o)
        if m and m.group(1).lower() == letter:
            return m.group(2).strip()
    return None


async def _verify_answer(item: dict) -> None:
    check = item["check"]
    if not check:
        return
    r = await asyncio.to_thread(solve_run, check, "auto")
    if r.status != "answered" or not r.answer:
        return
    engine, model = r.answer, item["answer"]
    if r.kind == "truth" or engine.startswith("true for every"):
        # the check was a statement (2·4 + 3 = 11): true confirms the key, false leaves it unverified
        item["answerVerified"] = engine.startswith("true")
        return
    if item["kind"] == "mcq" or _letter(model):
        letter = _letter(model)
        chosen = _option_value(item["options"], letter) if letter else None
        if chosen and await _same_answer(engine, chosen):
            item["answerVerified"] = True
            return
        for o in item["options"]:  # the engine's value matches a different option: that option is the key
            m = re.match(r"^\s*\(?([a-dA-D])\)\s*(.+)$", o)
            if m and await _same_answer(engine, m.group(2).strip()):
                item.update(answer=f"({m.group(1).lower()})", answerVerified=True, corrected=letter != m.group(1).lower())
                return
        return
    if not model:
        item.update(answer=engine, answerVerified=True, corrected=True)
    elif await _same_answer(engine, model):
        item["answerVerified"] = True
    elif re.search(r"[a-zθ]", model, re.IGNORECASE) and not re.search(r"[a-zθ]", engine, re.IGNORECASE) and not re.match(r"^[a-zθ]\s*=", model):
        # the check line was not the question itself (e.g. a difference that is 0): keep the key, unverified
        return
    else:
        item.update(answer=engine, answerVerified=True, corrected=True)  # the exact engine wins


def _solution_values(ans: str) -> list[str]:
    """'x = 2 or x = 3' -> ['2', '3']; '4' -> ['4']; MCQ letters are not values."""
    a = ans.strip()
    if re.match(r"^\(?[a-dA-D]\)\s*$", a):
        return []
    vals = []
    for p in re.split(r"\s*(?:\bor\b|,|;|\band\b)\s*", a):
        p = p.strip()
        if not p:
            continue
        if "=" in p:
            p = p.split("=")[-1].strip()
        p = _final_value(p)
        if p:
            vals.append(p)
    return vals


async def _same_answer(a: str, b: str) -> bool:
    if _shape_eq(a) == _shape_eq(b):
        return True
    pa, pb = _solution_values(a), _solution_values(b)
    if not pa or len(pa) != len(pb):
        return False
    remaining = list(pb)
    for x in pa:
        hit = None
        for y in remaining:
            if _shape_eq(x) == _shape_eq(y):
                hit = y
                break
            t = await asyncio.to_thread(solve_run, f"{x} = {y}", "solve")
            if t.status == "answered" and (t.answer or "").startswith("true"):
                hit = y
                break
        if hit is None:
            return False
        remaining.remove(hit)
    return True


def _letter(s: str) -> str:
    m = re.findall(r"\(([a-dA-D])\)", s) or re.findall(r"^\s*([a-dA-D])\s*[.)]?\s*$", s)
    return m[0].lower() if m else ""


async def grade(items) -> list[dict]:
    out = []
    for it in items:
        student = (it.student or "").strip()
        if not student:
            out.append({"id": it.id, "verdict": "unanswered"})
            continue
        if it.kind == "mcq" or re.match(r"^\(?[a-dA-D]\)", it.answer.strip()):
            ok = bool(_letter(student)) and _letter(student) == _letter(it.answer)
            out.append({"id": it.id, "verdict": "correct" if ok else "incorrect", "how": "option"})
            continue
        ok = await _same_answer(it.answer, student)
        if not ok and "=" in student:
            # working that ends in the answer: compare the last line's value
            tail = student.splitlines()[-1]
            ok = await _same_answer(it.answer, tail) or await _same_answer(_final_value(it.answer), tail.split("=")[-1].strip())
        out.append({"id": it.id, "verdict": "correct" if ok else "incorrect", "how": "exact"})
    return out


def _shape_eq(t: str) -> str:
    return re.sub(r"\s+", "", t).lower()


def completed_line(text: str, answer: str) -> str:
    """'sin 30° =' + '1/2' -> 'sin 30° = 1/2'; an equation's solution stands on its own line."""
    t = text.rstrip()
    return clean_math(f"{t} {answer}", MAX_EQUATION_CHARS) if t.endswith("=") else clean_math(answer, MAX_EQUATION_CHARS)


def _valid_completion(problem: str, base: str, cand: str) -> bool:
    if not cand or len(cand) > MAX_EQUATION_CHARS:
        return False
    try:
        ps = solution_set(*parse_equation(problem))
        bs = solution_set(*parse_equation(base))
        cs = solution_set(*parse_equation(cand))
    except MathError:
        return False
    if re.sub(r"\s+", "", cand) == re.sub(r"\s+", "", base):
        return False
    return ps == cs == bs
