"""arithmetic_v1: exact checking/completion of number-only lines like "3 + 2 =", "2 x 3 = 6", "2^3 = 8".

Uses the graph_v2 tokenizer/parser (no eval) but evaluates exactly with Fractions.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from fractions import Fraction

from .graph import B, N, U, V, Node, parse, to_text, vars_in
from .linear import MathError, fmt

MAX_EXP = 12
MAX_ABS = Fraction(10) ** 15


def looks_arithmetic(text: str) -> bool:
    """Number-only line. A lone 'x' between numbers is read as multiplication (2 x 3)."""
    t = _times(text)
    return bool(re.search(r"\d", t)) and not re.search(r"[a-wyzA-WYZ]", t) and "x" not in t.lower()


def _times(text: str) -> str:
    # "2 x 3" / "2x3" with digits on both sides means multiply in an arithmetic line
    return re.sub(r"(?<=[\d)])\s*[xX×]\s*(?=[\d(])", "*", text)


def _exact(n: Node) -> Fraction:
    if isinstance(n, N):
        return Fraction(str(n.v)) if not float(n.v).is_integer() else Fraction(int(n.v))
    if isinstance(n, V):
        raise MathError("unsupported", "This line has a variable, so it is not plain arithmetic.")
    if isinstance(n, U):
        if n.op == "neg":
            return -_exact(n.a)
        raise MathError("unsupported", f"{n.op}() is not checked exactly yet.")
    a, b = _exact(n.a), _exact(n.b)
    if n.op == "+":
        r = a + b
    elif n.op == "-":
        r = a - b
    elif n.op == "*":
        r = a * b
    elif n.op == "/":
        if b == 0:
            raise MathError("division_by_zero", "Division by zero is undefined.")
        r = a / b
    else:  # ^
        if b.denominator != 1 or abs(b) > MAX_EXP:
            raise MathError("unsupported", "Only whole-number powers up to 12 are checked.")
        if a == 0 and b < 0:
            raise MathError("division_by_zero", "0 to a negative power is undefined.")
        r = a ** int(b)
    if abs(r) > MAX_ABS:
        raise MathError("limits", "The number is too large to check.")
    return r


def show(v: Fraction) -> str:
    if v.denominator == 1:
        return str(v.numerator)
    dec = v.numerator / v.denominator
    s = f"{dec:.6f}".rstrip("0").rstrip(".")
    # terminating decimals read naturally; otherwise give the fraction
    d = v.denominator
    while d % 2 == 0:
        d //= 2
    while d % 5 == 0:
        d //= 5
    return s if d == 1 else f"{fmt(v)}"


@dataclass
class ArithResult:
    status: str  # correct | incorrect | incomplete | unsupported
    message: str
    value: str | None = None
    expression: str | None = None
    completed: str | None = None


def check_arith(text: str) -> ArithResult:
    raw = _times(text.strip())
    incomplete = raw.rstrip().endswith("=")
    body = raw.rstrip().rstrip("=").rstrip() if incomplete else raw
    try:
        left, right = parse(body)
        if vars_in(left) or vars_in(right):
            raise MathError("unsupported", "This line has a variable.")
        lv = _exact(left)
    except MathError as e:
        return ArithResult("unsupported", e.message)
    expr = to_text(left)
    if right is None:
        return ArithResult("incomplete", "Work out the value of the left side.", show(lv), expr, f"{expr} = {show(lv)}")
    try:
        rv = _exact(right)
    except MathError as e:
        return ArithResult("unsupported", e.message)
    if lv == rv:
        return ArithResult("correct", f"Correct: {expr} = {show(lv)}.", show(lv), expr)
    return ArithResult("incorrect", f"Not quite: {expr} is not {show(rv)}.", show(lv), expr)
