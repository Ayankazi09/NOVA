"""Restricted linear maths grammar (scope linear_x_v1 / linear_plot_v1).

Hand-written tokenizer + recursive-descent parser producing a small AST.
Nothing here ever calls eval/exec or a general-purpose expression parser.
All arithmetic is exact (fractions.Fraction).

Grammar (after normalisation):
    equation   := expr '=' expr
    expr       := term (('+' | '-') term)*
    term       := unary (('*' | '/') unary | implicit_factor)*
    unary      := ('+' | '-') unary | primary
    primary    := NUMBER | VAR | '(' expr ')'
"""

from __future__ import annotations

from dataclasses import dataclass
from fractions import Fraction
from typing import Union

MAX_CHARS = 160
MAX_NODES = 60
MAX_DEPTH = 12
MAX_LITERAL = Fraction(10_000)


class MathError(ValueError):
    """Input is outside the supported scope (not a learner error)."""

    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code  # syntax | unsupported | nonlinear | limits | division_by_zero
        self.message = message


# ----------------------------------------------------------------- AST


@dataclass(frozen=True)
class Num:
    value: Fraction


@dataclass(frozen=True)
class Var:
    name: str


@dataclass(frozen=True)
class Neg:
    operand: "Node"


@dataclass(frozen=True)
class Bin:
    op: str  # + - * /
    left: "Node"
    right: "Node"


Node = Union[Num, Var, Neg, Bin]


# ----------------------------------------------------------- tokenizer

_REPLACEMENTS = {
    "−": "-",  # minus sign
    "–": "-",  # en dash
    "—": "-",  # em dash
    "×": "*",  # multiplication sign
    "⋅": "*",  # dot operator
    "·": "*",  # middle dot
    "÷": "/",  # division sign
    "＝": "=",
    "[": "(",
    "]": ")",
    "{": "(",
    "}": ")",
}


def normalise(text: str) -> str:
    out = text.strip()
    for a, b in _REPLACEMENTS.items():
        out = out.replace(a, b)
    out = out.replace("X", "x").replace("Y", "y")
    return out


@dataclass(frozen=True)
class Tok:
    kind: str  # num var op lp rp eq
    text: str
    value: Fraction | None = None


def tokenize(text: str, allowed_vars: frozenset[str]) -> list[Tok]:
    if len(text) > MAX_CHARS:
        raise MathError("limits", f"Expression is longer than {MAX_CHARS} characters.")
    s = normalise(text)
    toks: list[Tok] = []
    i = 0
    while i < len(s):
        c = s[i]
        if c.isspace():
            i += 1
            continue
        if c.isdigit() or (c == "." and i + 1 < len(s) and s[i + 1].isdigit()):
            j = i
            seen_dot = False
            while j < len(s) and (s[j].isdigit() or (s[j] == "." and not seen_dot)):
                if s[j] == ".":
                    seen_dot = True
                j += 1
            lit = s[i:j]
            if lit.endswith("."):
                raise MathError("syntax", f"Number '{lit}' is incomplete.")
            value = Fraction(lit)  # exact rational from decimal string
            if abs(value) > MAX_LITERAL:
                raise MathError("limits", "Numbers larger than 10,000 are not supported.")
            toks.append(Tok("num", lit, value))
            i = j
            continue
        if c.isalpha():
            if c in allowed_vars:
                # reject identifiers like "xx", "sin", "abc"
                if i + 1 < len(s) and s[i + 1].isalpha():
                    j = i
                    while j < len(s) and s[j].isalpha():
                        j += 1
                    raise MathError("unsupported", f"'{s[i:j]}' is not supported; only {', '.join(sorted(allowed_vars))} can be used.")
                toks.append(Tok("var", c))
                i += 1
                continue
            j = i
            while j < len(s) and s[j].isalpha():
                j += 1
            raise MathError("unsupported", f"'{s[i:j]}' is not supported; only {', '.join(sorted(allowed_vars))} can be used.")
        if c in "+-*/":
            toks.append(Tok("op", c))
        elif c == "(":
            toks.append(Tok("lp", c))
        elif c == ")":
            toks.append(Tok("rp", c))
        elif c == "=":
            toks.append(Tok("eq", c))
        elif c == "^":
            raise MathError("nonlinear", "Powers are not supported in this linear scope.")
        else:
            raise MathError("syntax", f"Unexpected symbol '{c}'.")
        i += 1
    return toks


# --------------------------------------------------------------- parser


class _Parser:
    def __init__(self, toks: list[Tok]):
        self.toks = toks
        self.pos = 0
        self.nodes = 0

    def peek(self) -> Tok | None:
        return self.toks[self.pos] if self.pos < len(self.toks) else None

    def take(self) -> Tok:
        t = self.toks[self.pos]
        self.pos += 1
        return t

    def count(self, node: Node, depth: int) -> Node:
        self.nodes += 1
        if self.nodes > MAX_NODES:
            raise MathError("limits", "Expression is too large to check.")
        if depth > MAX_DEPTH:
            raise MathError("limits", "Expression is nested too deeply.")
        return node

    def expr(self, depth: int) -> Node:
        node = self.term(depth + 1)
        while (t := self.peek()) is not None and t.kind == "op" and t.text in "+-":
            self.take()
            right = self.term(depth + 1)
            node = self.count(Bin(t.text, node, right), depth)
        return node

    def term(self, depth: int) -> Node:
        node = self.unary(depth + 1)
        while True:
            t = self.peek()
            if t is None:
                break
            if t.kind == "op" and t.text in "*/":
                self.take()
                right = self.unary(depth + 1)
                node = self.count(Bin(t.text, node, right), depth)
            elif t.kind in ("num", "var", "lp"):
                # implicit multiplication: 2x, 2(x+3), (x+1)(2), x(3)
                prev = self.toks[self.pos - 1].kind
                if t.kind == "num" and prev == "num":
                    raise MathError("syntax", "Two numbers are written next to each other.")
                if t.kind == "num" and prev == "var":
                    raise MathError("syntax", "A number written after x is ambiguous; write 2x, x*2 or x^2.")
                right = self.primary(depth + 1)
                node = self.count(Bin("*", node, right), depth)
            else:
                break
        return node

    def unary(self, depth: int) -> Node:
        t = self.peek()
        if t is not None and t.kind == "op" and t.text in "+-":
            self.take()
            operand = self.unary(depth + 1)
            return self.count(Neg(operand), depth) if t.text == "-" else operand
        return self.primary(depth)

    def primary(self, depth: int) -> Node:
        t = self.peek()
        if t is None:
            raise MathError("syntax", "Expression ends unexpectedly.")
        if t.kind == "num":
            self.take()
            return self.count(Num(t.value), depth)  # type: ignore[arg-type]
        if t.kind == "var":
            self.take()
            return self.count(Var(t.text), depth)
        if t.kind == "lp":
            self.take()
            inner = self.expr(depth + 1)
            close = self.peek()
            if close is None or close.kind != "rp":
                raise MathError("syntax", "A bracket is not closed.")
            self.take()
            return inner
        if t.kind == "rp":
            raise MathError("syntax", "A closing bracket has no matching opening bracket.")
        if t.kind == "eq":
            raise MathError("syntax", "A side of the equation is empty.")
        raise MathError("syntax", f"Unexpected '{t.text}'.")


def parse_expression(text: str, allowed_vars: frozenset[str] = frozenset({"x"})) -> Node:
    toks = tokenize(text, allowed_vars)
    if not toks:
        raise MathError("syntax", "Expression is empty.")
    if any(t.kind == "eq" for t in toks):
        raise MathError("syntax", "Expected an expression without '='.")
    p = _Parser(toks)
    node = p.expr(0)
    if p.peek() is not None:
        raise MathError("syntax", f"Unexpected '{p.peek().text}'.")  # type: ignore[union-attr]
    return node


def parse_equation(text: str, allowed_vars: frozenset[str] = frozenset({"x"})) -> tuple[Node, Node]:
    toks = tokenize(text, allowed_vars)
    eqs = [i for i, t in enumerate(toks) if t.kind == "eq"]
    if len(eqs) != 1:
        raise MathError("syntax", "An equation needs exactly one '=' sign.")
    k = eqs[0]
    left, right = toks[:k], toks[k + 1 :]
    if not left or not right:
        raise MathError("syntax", "A side of the equation is empty.")
    sides = []
    total_nodes = 0
    for part in (left, right):
        p = _Parser(part)
        node = p.expr(0)
        if p.peek() is not None:
            raise MathError("syntax", f"Unexpected '{p.peek().text}'.")  # type: ignore[union-attr]
        total_nodes += p.nodes
        sides.append(node)
    if total_nodes > MAX_NODES:
        raise MathError("limits", "Equation is too large to check.")
    return sides[0], sides[1]


# ------------------------------------------------------ linear evaluation


@dataclass(frozen=True)
class Linear:
    """a*x + b with exact rationals."""

    a: Fraction
    b: Fraction

    def __add__(self, o: "Linear") -> "Linear":
        return Linear(self.a + o.a, self.b + o.b)

    def __sub__(self, o: "Linear") -> "Linear":
        return Linear(self.a - o.a, self.b - o.b)

    def __neg__(self) -> "Linear":
        return Linear(-self.a, -self.b)


def to_linear(node: Node, var: str = "x") -> Linear:
    if isinstance(node, Num):
        return Linear(Fraction(0), node.value)
    if isinstance(node, Var):
        if node.name != var:
            raise MathError("unsupported", f"Variable '{node.name}' is not supported here.")
        return Linear(Fraction(1), Fraction(0))
    if isinstance(node, Neg):
        return -to_linear(node.operand, var)
    left = to_linear(node.left, var)
    right = to_linear(node.right, var)
    if node.op == "+":
        return left + right
    if node.op == "-":
        return left - right
    if node.op == "*":
        if left.a != 0 and right.a != 0:
            raise MathError("nonlinear", "Multiplying x by x is outside the linear scope.")
        return Linear(left.a * right.b + right.a * left.b, left.b * right.b)
    if node.op == "/":
        if right.a != 0:
            raise MathError("nonlinear", "Dividing by an expression containing x is not supported.")
        if right.b == 0:
            raise MathError("division_by_zero", "Division by zero.")
        return Linear(left.a / right.b, left.b / right.b)
    raise MathError("syntax", "Unknown operator.")


# ------------------------------------------------------------ solutions


@dataclass(frozen=True)
class SolutionSet:
    kind: str  # unique | all | none
    value: Fraction | None = None

    def describe(self) -> str:
        if self.kind == "unique":
            return f"x = {fmt(self.value)}"  # type: ignore[arg-type]
        if self.kind == "all":
            return "every value of x"
        return "no value of x"


def solution_set(left: Node, right: Node) -> SolutionSet:
    diff = to_linear(left) - to_linear(right)  # a x + b = 0
    if diff.a != 0:
        return SolutionSet("unique", -diff.b / diff.a)
    if diff.b == 0:
        return SolutionSet("all")
    return SolutionSet("none")


def is_isolated(left: Node, right: Node) -> bool:
    """True for x = c or c = x where c contains no x."""

    def const(n: Node) -> bool:
        try:
            return to_linear(n).a == 0
        except MathError:
            return False

    return (isinstance(left, Var) and const(right)) or (isinstance(right, Var) and const(left))


def has_x(n: Node) -> bool:
    if isinstance(n, Var):
        return True
    if isinstance(n, Num):
        return False
    if isinstance(n, Neg):
        return has_x(n.operand)
    return has_x(n.left) or has_x(n.right)


def fmt(v: Fraction) -> str:
    if v.denominator == 1:
        return str(v.numerator)
    return f"{v.numerator}/{v.denominator}"


def fmt_decimal(v: Fraction) -> str:
    if v.denominator == 1:
        return str(v.numerator)
    s = f"{float(v):.4f}".rstrip("0").rstrip(".")
    return s


def to_text(node: Node) -> str:
    """Canonical readable rendering of an AST (for echoing parsed input)."""
    if isinstance(node, Num):
        return fmt(node.value)
    if isinstance(node, Var):
        return node.name
    if isinstance(node, Neg):
        inner = to_text(node.operand)
        return f"-({inner})" if isinstance(node.operand, Bin) else f"-{inner}"
    l, r = to_text(node.left), to_text(node.right)
    if node.op in "*/":
        if isinstance(node.left, Bin) and node.left.op in "+-":
            l = f"({l})"
        if isinstance(node.right, Bin):
            r = f"({r})"
        if node.op == "*" and isinstance(node.left, Num) and isinstance(node.right, Var | Bin):
            return f"{l}{r}"
        return f"{l} {node.op} {r}"
    if node.op == "-" and isinstance(node.right, Bin) and node.right.op in "+-":
        r = f"({r})"
    return f"{l} {node.op} {r}"


# ---------------------------------------------------------------- check


@dataclass
class CheckResult:
    status: str  # equivalent | different | solved | unsupported | needs_clarification
    message: str
    problemSolution: str | None = None
    currentSolution: str | None = None
    parsedProblem: str | None = None
    parsedCurrent: str | None = None
    errorCode: str | None = None


def check_step(problem: str, current: str) -> CheckResult:
    try:
        pl, pr = parse_equation(problem)
    except MathError as e:
        return CheckResult("unsupported", f"The problem can't be checked: {e.message}", errorCode=e.code)
    try:
        cl, cr = parse_equation(current)
    except MathError as e:
        return CheckResult("unsupported", f"This step can't be checked: {e.message}", errorCode=e.code)
    try:
        ps = solution_set(pl, pr)
        cs = solution_set(cl, cr)
    except MathError as e:
        return CheckResult("unsupported", e.message, errorCode=e.code)

    base = dict(
        problemSolution=ps.describe(),
        currentSolution=cs.describe(),
        parsedProblem=f"{to_text(pl)} = {to_text(pr)}",
        parsedCurrent=f"{to_text(cl)} = {to_text(cr)}",
    )
    if ps != cs:
        return CheckResult(
            "different",
            "This line has a different solution from the problem, so a step has changed the equation.",
            **base,
        )
    solved = False
    if ps.kind == "unique" and is_isolated(cl, cr):
        solved = True
    elif ps.kind in ("all", "none") and not has_x(cl) and not has_x(cr):
        solved = True
    if solved:
        return CheckResult("solved", f"Solved: {ps.describe()}.", **base)
    return CheckResult("equivalent", "This line keeps the same solution as the problem.", **base)
