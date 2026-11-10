"""Pydantic contracts for /api/v1. See docs/CONTRACTS.md."""

from __future__ import annotations

from typing import Annotated, Literal, Union
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

from ..config import MAX_EQUATION_CHARS, MAX_HISTORY_TURNS, MAX_NOTE_CHARS, MAX_QUESTION_CHARS, MAX_SPEAK_CHARS, MAX_TURN_CHARS

Id = Annotated[str, Field(min_length=1, max_length=80, pattern=r"^[A-Za-z0-9_\-:.]+$")]
Equation = Annotated[str, Field(max_length=MAX_EQUATION_CHARS)]


class Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


class RequestContext(Strict):
    requestId: UUID
    pageId: Id
    contentRevision: int = Field(ge=0)
    regionId: Id
    sourceHash: Annotated[str, Field(min_length=1, max_length=128)]
    selectionRevision: int = Field(ge=0)
    interpretationRevision: int = Field(ge=0)


# ------------------------------------------------------------ recognize


class RecognizeRequest(Strict):
    context: RequestContext
    regionPng: Annotated[str, Field(max_length=1_500_000)]  # base64 (optionally data: URL)
    problemPng: Annotated[str | None, Field(max_length=1_500_000)] = None
    regionWidth: int = Field(gt=0, le=20000)
    regionHeight: int = Field(gt=0, le=20000)


class RecognizeResponse(BaseModel):
    context: RequestContext
    status: Literal["expression", "incomplete", "none", "ambiguous"]
    rawText: str
    alternatives: list[str]
    needsClarification: bool
    note: str | None = None
    model: str
    latencyMs: int


# ---------------------------------------------------------------- check


class CheckRequest(Strict):
    context: RequestContext
    problem: Equation
    current: Equation
    scope: Literal["linear_x_v1"] = "linear_x_v1"
    confirmed: bool = Field(description="Learner accepted the exact readings being checked")


class CheckResponse(BaseModel):
    context: RequestContext
    status: Literal["equivalent", "different", "solved", "unsupported", "needs_clarification", "correct", "incorrect", "incomplete"]
    message: str
    problemSolution: str | None = None
    currentSolution: str | None = None
    parsedProblem: str | None = None
    parsedCurrent: str | None = None
    scope: str = "linear_x_v1"


# ----------------------------------------------------------------- plot


class PlotRequest(Strict):
    context: RequestContext
    expression: Annotated[str, Field(max_length=200)]
    xMin: float | None = Field(default=None, ge=-1000, le=1000)
    xMax: float | None = Field(default=None, ge=-1000, le=1000)


class PlotSeries(BaseModel):
    label: str
    segments: list[list[dict[str, float]]]


class PlotPayload(BaseModel):
    expression: str
    normalized: str
    kind: Literal["function", "equation", "implicit"] = "function"
    xMin: float
    xMax: float
    yMin: float
    yMax: float
    series: list[PlotSeries] = []
    points: list[dict[str, float | str]] = []
    note: str = ""
    # v1 fields kept for older notebooks
    slope: str = ""
    intercept: str = ""
    segments: list[list[dict[str, float]]] = []
    checkPoints: list[dict[str, float | str]] = []


class PlotResponse(BaseModel):
    context: RequestContext
    plot: PlotPayload
    scope: str = "graph_v2"


# ---------------------------------------------------------------- tutor


class Turn(Strict):
    role: Literal["student", "tutor"]
    text: Annotated[str, Field(max_length=MAX_TURN_CHARS)]


class Reading(Strict):
    regionId: Id
    text: Equation
    accepted: bool


class ExamQuestion(Strict):
    number: Annotated[str, Field(max_length=20)]
    text: Annotated[str, Field(max_length=1500)]
    answer: Annotated[str, Field(max_length=200)]
    reveal: bool = False  # after the test: explain the full solution


class TutorRequest(Strict):
    context: RequestContext
    intent: Literal["ask", "hint", "explain", "check", "complete", "plot", "solve"]
    question: Annotated[str, Field(max_length=MAX_QUESTION_CHARS)] = ""
    problem: Reading | None = None
    current: Reading | None = None
    history: Annotated[list[Turn], Field(max_length=MAX_HISTORY_TURNS)] = []
    plotExpression: Equation | None = None
    regionIds: Annotated[list[Id], Field(max_length=20)] = []
    pageLines: Annotated[list[Reading], Field(max_length=30)] = []  # every read line on the page, top to bottom
    exam: "ExamQuestion | None" = None


class HighlightAction(BaseModel):
    id: str
    type: Literal["highlight_region"]
    anchorRegionId: str
    reason: Annotated[str, Field(max_length=120)]


class NoteAction(BaseModel):
    id: str
    type: Literal["add_note"]
    anchorRegionId: str
    text: Annotated[str, Field(max_length=MAX_NOTE_CHARS)]


class EquationAction(BaseModel):
    id: str
    type: Literal["write_equation"]
    anchorRegionId: str
    expression: Equation
    purpose: Literal["hint", "completion"]
    verified: bool = False


class GroupsAction(BaseModel):
    id: str
    type: Literal["draw_groups"]
    anchorRegionId: str
    groups: Annotated[list[Annotated[str, Field(max_length=24)]], Field(min_length=2, max_length=4)]
    caption: Annotated[str, Field(max_length=120)] = ""


class PlotAction(BaseModel):
    id: str
    type: Literal["plot_function"]
    anchorRegionId: str
    plot: PlotPayload


class SpeakAction(BaseModel):
    id: str
    type: Literal["speak"]
    anchorRegionId: str
    text: Annotated[str, Field(max_length=MAX_SPEAK_CHARS)]


Cell = Annotated[str, Field(max_length=40)]


class LinesAction(BaseModel):
    """Content NOVA writes onto the page in handwriting (formula lists, worked lines). '=' lines are verified."""

    id: str
    type: Literal["write_lines"]
    anchorRegionId: str
    title: Annotated[str, Field(max_length=60)] = ""
    lines: Annotated[list[Annotated[str, Field(max_length=80)]], Field(min_length=1, max_length=20)]
    inks: list[Literal["blue", "red", "black"]] = []  # a teacher's colours: black = given, blue = working, red = key idea / answer
    verified: list[bool] = []
    corrected: int = 0


class TableAction(BaseModel):
    """A table written in handwriting. Cells that can be computed are verified (and corrected) exactly."""

    id: str
    type: Literal["write_table"]
    anchorRegionId: str
    title: Annotated[str, Field(max_length=60)] = ""
    header: Annotated[list[Cell], Field(min_length=1, max_length=8)]
    rows: Annotated[list[Annotated[list[Cell], Field(min_length=1, max_length=8)]], Field(min_length=1, max_length=14)]
    verifiedCells: int = 0
    corrected: int = 0
    unverifiedCells: int = 0


class FigureCircle(BaseModel):
    center: Annotated[str, Field(max_length=4)]
    radius: float = Field(gt=0, le=1e4)
    label: Annotated[str, Field(max_length=24)] = ""


class FigureLabel(BaseModel):
    between: Annotated[list[Annotated[str, Field(max_length=4)]], Field(min_length=2, max_length=2)]
    text: Annotated[str, Field(max_length=24)]


class FigureAngle(BaseModel):
    at: Annotated[str, Field(max_length=4)]
    text: Annotated[str, Field(max_length=16)] = ""


class FigureAction(BaseModel):
    """A geometry figure NOVA draws on the page: named points (maths coordinates, y up), the segments and circles
    between them, and labels. The client draws it by hand, to scale."""

    id: str
    type: Literal["draw_figure"]
    anchorRegionId: str
    title: Annotated[str, Field(max_length=60)] = ""
    points: Annotated[dict[str, Annotated[list[float], Field(min_length=2, max_length=2)]], Field(min_length=1, max_length=16)]
    segments: Annotated[list[Annotated[list[str], Field(min_length=2, max_length=2)]], Field(max_length=32)] = []
    dashed: Annotated[list[Annotated[list[str], Field(min_length=2, max_length=2)]], Field(max_length=12)] = []
    circles: Annotated[list[FigureCircle], Field(max_length=4)] = []
    sideLabels: Annotated[list[FigureLabel], Field(max_length=16)] = []
    angleLabels: Annotated[list[FigureAngle], Field(max_length=10)] = []
    rightAngles: Annotated[list[Annotated[str, Field(max_length=4)]], Field(max_length=8)] = []
    notes: Annotated[list[Annotated[str, Field(max_length=80)]], Field(max_length=5)] = []


Action = Annotated[
    Union[HighlightAction, NoteAction, EquationAction, GroupsAction, PlotAction, SpeakAction, LinesAction, TableAction, FigureAction],
    Field(discriminator="type"),
]


class TutorResponse(BaseModel):
    context: RequestContext
    explanation: str
    actions: list[Action]
    check: CheckResponse | None = None
    verifiedBy: Literal["deterministic", "model", "none"] = "none"
    model: str | None = None
    latencyMs: int


# ---------------------------------------------------------- capabilities


class SolveRequest(Strict):
    context: RequestContext
    text: Annotated[str, Field(min_length=1, max_length=200)]
    mode: Literal["auto", "finish", "solve"] = "finish"


class SolveResponse(BaseModel):
    context: RequestContext
    status: str
    answer: str | None = None
    completed: str | None = None
    kind: str | None = None
    message: str | None = None
    note: str | None = None


class AutoRequest(Strict):
    context: RequestContext
    text: Annotated[str, Field(min_length=1, max_length=200)]
    problem: Annotated[str | None, Field(max_length=200)] = None
    autoAnswer: bool = True
    diagramPng: Annotated[str | None, Field(max_length=1_400_000)] = None  # the student's drawing near the question (geometry)


class AutoResponse(BaseModel):
    context: RequestContext
    kind: Literal["answer", "mark", "solution", "none"]
    verdict: Literal["correct", "incorrect", "equivalent", "different", "solved", "none"] = "none"
    answer: str | None = None
    steps: list[str] = []
    notes: list[str] = []  # why each step happens, for a beginner
    moves: list[dict | None] = []  # what crossed "=" at each step: {"find", "becomes"}
    suggest: Literal["graph", "solve", "none"] = "none"
    message: str | None = None


class PaperLine(Strict):
    id: Annotated[str, Field(max_length=20)]
    text: Annotated[str, Field(max_length=400)]


class PaperAnalyzeRequest(Strict):
    requestId: UUID
    pageIndex: int = Field(ge=0, le=50)
    png: Annotated[str, Field(max_length=1_500_000)]
    lines: Annotated[list[PaperLine], Field(max_length=250)] = []


class PaperQuestion(BaseModel):
    number: str
    text: str
    lineIds: list[str] = []
    bbox: list[float] = []
    kind: str = "other"
    options: list[str] = []
    answer: str = ""
    check: str = ""
    answerVerified: bool = False
    corrected: bool = False


class PaperAnalyzeResponse(BaseModel):
    pageIndex: int
    questions: list[PaperQuestion]
    latencyMs: int


class PracticeRequest(Strict):
    requestId: UUID
    topic: Annotated[str, Field(max_length=80)] = ""
    example: Annotated[str, Field(max_length=300)] = ""
    count: int = Field(default=5, ge=1, le=10)


class PracticeQuestion(BaseModel):
    number: str
    text: str
    kind: str = "other"
    options: list[str] = []
    answer: str = ""
    answerVerified: bool = False
    corrected: bool = False


class PracticeResponse(BaseModel):
    topic: str
    questions: list[PracticeQuestion]
    latencyMs: int


class GradeItem(Strict):
    id: Annotated[str, Field(max_length=40)]
    kind: Annotated[str, Field(max_length=20)] = "other"
    answer: Annotated[str, Field(max_length=200)]
    student: Annotated[str, Field(max_length=400)] = ""


class GradeRequest(Strict):
    items: Annotated[list[GradeItem], Field(max_length=80)]


class GradeResult(BaseModel):
    id: str
    verdict: Literal["correct", "incorrect", "unanswered"]
    how: str = ""


class Capabilities(BaseModel):
    version: str
    features: dict[str, bool]
    mathScopes: list[str]
    limits: dict[str, int | float]
    provider: dict[str, object]
    speech: dict[str, object]
