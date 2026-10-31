"""linear_plot_v1: deterministic sampling of y = m x + b."""

from __future__ import annotations

from dataclasses import dataclass
from fractions import Fraction

from .linear import MathError, fmt, fmt_decimal, parse_equation, parse_expression, to_linear, Var, Linear

DOMAIN_LIMIT = Fraction(100)
MIN_SAMPLES, MAX_SAMPLES = 20, 500


@dataclass
class PlotData:
    expression: str
    normalized: str
    slope: str
    intercept: str
    xMin: float
    xMax: float
    yMin: float
    yMax: float
    segments: list[list[dict[str, float]]]
    checkPoints: list[dict[str, float]]


def parse_line(expression: str) -> Linear:
    text = expression.strip()
    if "=" in text:
        left, right = parse_equation(text, frozenset({"x", "y"}))
        if isinstance(left, Var) and left.name == "y":
            rhs = right
        elif isinstance(right, Var) and right.name == "y":
            rhs = left
        else:
            raise MathError("unsupported", "Write the line as y = mx + b.")
        return to_linear(rhs, "x")
    return to_linear(parse_expression(text), "x")


def describe(line: Linear) -> str:
    m, b = line.a, line.b
    if m == 0:
        return f"y = {fmt(b)}"
    mt = "" if m == 1 else "-" if m == -1 else fmt(m)
    if b == 0:
        return f"y = {mt}x"
    sign = "+" if b > 0 else "-"
    return f"y = {mt}x {sign} {fmt(abs(b))}"


def sample_line(expression: str, x_min: float = -10, x_max: float = 10, samples: int = 41) -> PlotData:
    line = parse_line(expression)
    lo, hi = Fraction(str(x_min)), Fraction(str(x_max))
    if lo < -DOMAIN_LIMIT or hi > DOMAIN_LIMIT:
        raise MathError("limits", "The x range must stay within -100 to 100.")
    if not lo < hi:
        raise MathError("limits", "xMin must be smaller than xMax.")
    if not MIN_SAMPLES <= samples <= MAX_SAMPLES:
        raise MathError("limits", f"Samples must be between {MIN_SAMPLES} and {MAX_SAMPLES}.")
    step = (hi - lo) / (samples - 1)
    pts = []
    for i in range(samples):
        x = lo + step * i
        y = line.a * x + line.b
        pts.append({"x": float(x), "y": float(y)})
    # integrity: every sample lies on the line (exact recompute)
    for p in pts:
        x = Fraction(p["x"])
        if abs(float(line.a * x + line.b) - p["y"]) > 1e-9 * max(1.0, abs(p["y"])):
            raise MathError("limits", "Plot verification failed.")
    ys = [p["y"] for p in pts]
    check_points = [{"x": float(x), "y": float(line.a * x + line.b)} for x in (Fraction(-1), Fraction(0), Fraction(1)) if lo <= x <= hi]
    return PlotData(
        expression=expression,
        normalized=describe(line),
        slope=fmt_decimal(line.a),
        intercept=fmt_decimal(line.b),
        xMin=float(lo),
        xMax=float(hi),
        yMin=min(ys),
        yMax=max(ys),
        segments=[pts],
        checkPoints=check_points,
    )
