"""Deterministic single next step for linear_x_v1 equations (used when the model's proposal fails validation)."""

from __future__ import annotations

import re
from fractions import Fraction

from .linear import Bin, MathError, Neg, Node, fmt, parse_equation, solution_set, to_linear


def _lin_text(a: Fraction, b: Fraction) -> str:
    parts = []
    if a != 0:
        parts.append("x" if a == 1 else "-x" if a == -1 else f"{fmt(a)}x")
    if b != 0 or not parts:
        if parts:
            parts.append(f"+ {fmt(b)}" if b > 0 else f"- {fmt(-b)}")
        else:
            parts.append(fmt(b))
    return " ".join(parts)


def _has_brackets_or_division(n: Node) -> bool:
    if isinstance(n, Neg):
        return isinstance(n.operand, Bin) or _has_brackets_or_division(n.operand)
    if isinstance(n, Bin):
        if n.op in "*/" and (isinstance(n.left, Bin) or isinstance(n.right, Bin)):
            return True
        if n.op == "/":
            return True
        return _has_brackets_or_division(n.left) or _has_brackets_or_division(n.right)
    return False


def _squash(s: str) -> str:
    return re.sub(r"\s+", "", s)


def next_step(current: str) -> str | None:
    """Return one simplifying step, or None if already solved / unsupported."""
    try:
        left, right = parse_equation(current)
        L, R = to_linear(left), to_linear(right)
        solution_set(left, right)
    except MathError:
        return None
    candidates: list[str] = []
    # 1. expand / simplify each side
    if _has_brackets_or_division(left) or _has_brackets_or_division(right):
        candidates.append(f"{_lin_text(L.a, L.b)} = {_lin_text(R.a, R.b)}")
    # 2. collect x terms on the left
    if R.a != 0:
        candidates.append(f"{_lin_text(L.a - R.a, L.b)} = {_lin_text(Fraction(0), R.b)}")
    a = L.a - R.a
    # 3. move constants to the right
    if L.b != 0 and a != 0:
        candidates.append(f"{_lin_text(a, Fraction(0))} = {fmt(R.b - L.b)}")
    # 4. divide by the coefficient
    if a != 0:
        candidates.append(f"x = {fmt((R.b - L.b) / a)}")
    else:
        candidates.append(f"{fmt(L.b)} = {fmt(R.b)}")
    cur = _squash(current)
    for c in candidates:
        if _squash(c) != cur:
            return c
    return None


def solution_steps(equation: str) -> list[str] | None:
    """Full worked solution of a linear equation in x, one transformation per line (None if not linear)."""
    try:
        left, right = parse_equation(equation)
        L, R = to_linear(left), to_linear(right)
    except MathError:
        return None
    steps: list[str] = []
    if _has_brackets_or_division(left) or _has_brackets_or_division(right):
        steps.append(f"{_lin_text(L.a, L.b)} = {_lin_text(R.a, R.b)}")  # expand / simplify
    a, b, d = L.a - R.a, L.b, R.b
    if R.a != 0:
        steps.append(f"{_lin_text(a, b)} = {_lin_text(Fraction(0), d)}")  # collect the x terms on the left
    if a == 0:
        steps.append(f"{fmt(b)} = {fmt(d)}")
        steps.append("true for every x" if b == d else "no solution")
    else:
        if b != 0:
            steps.append(f"{_lin_text(a, Fraction(0))} = {fmt(d)} {'-' if b > 0 else '+'} {fmt(abs(b))}")  # move the constant
            steps.append(f"{_lin_text(a, Fraction(0))} = {fmt(d - b)}")
        if a != 1:
            v = d - b
            steps.append(f"x = {fmt(v)}/{fmt(a)}" if a > 0 else f"x = {fmt(v)}/({fmt(a)})")  # divide by the coefficient
            steps.append(f"x = {fmt(v / a)}")
    out: list[str] = []
    seen = {_squash(equation)}
    for s in steps:
        if _squash(s) not in seen:
            out.append(s)
            seen.add(_squash(s))
    return out or None


def _signed(v: Fraction, x: bool) -> str:
    """'+ 2', '- 2', '+ 3x', '- x' — a term as it is written after another term."""
    mag = abs(v)
    body = ("x" if mag == 1 else f"{fmt(mag)}x") if x else fmt(mag)
    return f"{'+' if v > 0 else '-'} {body}"


def explained_steps(equation: str) -> list[dict] | None:
    """The worked solution of a linear equation in x, with what moved across '=' at each step.

    Each step: {"text": the new line, "note": why (for a beginner), "move": {"find", "becomes"} or None}.
    "find" is the term as it appears in the line above; "becomes" is how it appears in this line.
    """
    try:
        left, right = parse_equation(equation)
        L, R = to_linear(left), to_linear(right)
    except MathError:
        return None
    steps: list[dict] = []
    if _has_brackets_or_division(left) or _has_brackets_or_division(right):
        note = "open the brackets: multiply each term inside" if "(" in equation else "simplify each side"
        steps.append({"text": f"{_lin_text(L.a, L.b)} = {_lin_text(R.a, R.b)}", "note": note, "move": None})
    a, b, c, d = L.a, L.b, R.a, R.b
    if c != 0:
        # the x term on the right crosses '=' to the left with the opposite sign
        on_right = _signed(c, True).replace("+ ", "")  # as written on the right: "x", "2x", "- x"
        becomes = _signed(-c, True)
        steps.append({"text": f"{_lin_text(a, b)} {becomes} = {_lin_text(Fraction(0), d)}",
                      "note": f"{on_right.replace(' ', '')} moves across = and becomes {becomes.replace(' ', '')}",
                      "move": {"find": on_right.replace(' ', ''), "becomes": becomes}})
        steps.append({"text": f"{_lin_text(a - c, b)} = {_lin_text(Fraction(0), d)}",
                      "note": f"{_lin_text(a, Fraction(0))} {becomes} = {_lin_text(a - c, Fraction(0))}", "move": None})
        a = a - c
    if a == 0:
        steps.append({"text": f"{fmt(b)} = {fmt(d)}", "note": "the x terms cancel out", "move": None})
        steps.append({"text": "true for every x" if b == d else "no solution", "note": "", "move": None})
    else:
        if b != 0:
            term = _signed(b, False)
            becomes = _signed(-b, False)
            steps.append({"text": f"{_lin_text(a, Fraction(0))} = {fmt(d)} {becomes}",
                          "note": f"{term.replace(' ', '')} moves across = and becomes {becomes.replace(' ', '')}",
                          "move": {"find": term.replace(" ", ""), "becomes": becomes}})
            steps.append({"text": f"{_lin_text(a, Fraction(0))} = {fmt(d - b)}", "note": f"{fmt(d)} {becomes} = {fmt(d - b)}", "move": None})
        if a != 1:
            v = d - b
            coef = fmt(a)
            shown = coef if a > 0 else f"({coef})"
            steps.append({"text": f"x = {fmt(v)}/{coef}" if a > 0 else f"x = {fmt(v)}/({coef})",
                          "note": f"×{shown} moves across = and becomes ÷{shown}" if a != -1 else "the minus sign moves across =",
                          "move": {"find": f"{coef}x" if a != -1 else "-x", "becomes": f"/{coef}" if a > 0 else f"/({coef})"}})
            steps.append({"text": f"x = {fmt(v / a)}", "note": "answer", "move": None})
            q = v / a
            if q.denominator != 1:  # not a whole number: say roughly what it is
                approx = f"{float(q):.2f}".rstrip("0").rstrip(".")
                steps.append({"text": f"x ≈ {approx}", "note": f"{fmt(q.numerator)} ÷ {fmt(Fraction(q.denominator))} ≈ {approx}", "move": None})
    out: list[dict] = []
    seen = {_squash(equation)}
    for s in steps:
        if _squash(s["text"]) not in seen:
            out.append(s)
            seen.add(_squash(s["text"]))
    return out or None
