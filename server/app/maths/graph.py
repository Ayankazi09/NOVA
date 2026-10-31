"""graph_v2: deterministic graphs for (almost) any equation a student writes.

- y = f(x)            -> function curve (split at discontinuities)
- f(x) = g(x)         -> both sides as curves + their intersection points (the solutions)
- F(x, y) = G(x, y)   -> implicit curve via marching squares (circles, lines in any form, ...)
- expression in x     -> y = expression

Hand-written tokenizer + recursive-descent parser -> small AST -> float evaluator.
Never eval/exec. Bounded size, depth and work.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import Callable, Union

from .linear import MathError

MAX_CHARS = 200
MAX_NODES = 150
MAX_DEPTH = 24
FUNCS: dict[str, Callable[[float], float]] = {
    "sin": math.sin, "cos": math.cos, "tan": math.tan,
    "sqrt": math.sqrt, "abs": abs, "log": math.log10, "ln": math.log, "exp": math.exp,
}
CONSTS = {"pi": math.pi, "e": math.e}

# ----------------------------------------------------------------- AST


@dataclass(frozen=True)
class N:
    v: float


@dataclass(frozen=True)
class V:
    name: str


@dataclass(frozen=True)
class U:
    op: str  # neg | func name
    a: "Node"


@dataclass(frozen=True)
class B:
    op: str  # + - * / ^
    a: "Node"
    b: "Node"


Node = Union[N, V, U, B]

_REPL = {
    "−": "-", "–": "-", "—": "-", "×": "*", "⋅": "*", "·": "*", "÷": "/",
    "²": "^2", "³": "^3", "√": "sqrt", "π": "pi", "[": "(", "]": ")", "{": "(", "}": ")", "**": "^",
}


def _norm(s: str) -> str:
    s = s.strip()
    for a, b in _REPL.items():
        s = s.replace(a, b)
    return s.replace("X", "x").replace("Y", "y")


def tokenize(text: str) -> list[tuple[str, object]]:
    if len(text) > MAX_CHARS:
        raise MathError("limits", f"Equation is longer than {MAX_CHARS} characters.")
    s = _norm(text)
    out: list[tuple[str, object]] = []
    i = 0
    while i < len(s):
        c = s[i]
        if c.isspace():
            i += 1
        elif c.isdigit() or (c == "." and i + 1 < len(s) and s[i + 1].isdigit()):
            j = i
            while j < len(s) and (s[j].isdigit() or s[j] == "."):
                j += 1
            try:
                v = float(s[i:j])
            except ValueError:
                raise MathError("syntax", f"'{s[i:j]}' is not a number.")
            if abs(v) > 1e6:
                raise MathError("limits", "Numbers that large are not supported.")
            out.append(("num", v))
            i = j
        elif c.isalpha():
            j = i
            while j < len(s) and s[j].isalpha():
                j += 1
            word = s[i:j].lower()
            i = j
            # split runs like "xy", "2xsin" into known names greedily
            k = 0
            while k < len(word):
                for name in sorted(list(FUNCS) + list(CONSTS) + ["x", "y"], key=len, reverse=True):
                    if word.startswith(name, k):
                        out.append(("fn" if name in FUNCS else "const" if name in CONSTS else "var", name))
                        k += len(name)
                        break
                else:
                    raise MathError("unsupported", f"'{word}' is not something NOVA can graph. Use x, y, numbers and sin/cos/tan/sqrt/abs/log/ln.")
        elif c in "+-*/^()=":
            out.append(("op", c))
            i += 1
        elif c == ",":
            raise MathError("syntax", "Commas are not supported; use a decimal point.")
        else:
            raise MathError("syntax", f"Unexpected symbol '{c}'.")
    return out


class _P:
    def __init__(self, toks):
        self.t = toks
        self.i = 0
        self.n = 0

    def peek(self):
        return self.t[self.i] if self.i < len(self.t) else None

    def take(self):
        tok = self.t[self.i]
        self.i += 1
        return tok

    def mk(self, node, depth):
        self.n += 1
        if self.n > MAX_NODES or depth > MAX_DEPTH:
            raise MathError("limits", "Equation is too large to graph.")
        return node

    def expr(self, d):
        node = self.term(d + 1)
        while (t := self.peek()) and t[0] == "op" and t[1] in "+-":
            self.take()
            node = self.mk(B(t[1], node, self.term(d + 1)), d)
        return node

    def term(self, d):
        node = self.unary(d + 1)
        while (t := self.peek()):
            if t[0] == "op" and t[1] in "*/":
                self.take()
                node = self.mk(B(t[1], node, self.unary(d + 1)), d)
            elif t[0] in ("num", "var", "const", "fn") or (t[0] == "op" and t[1] == "("):
                node = self.mk(B("*", node, self.power(d + 1)), d)
            else:
                break
        return node

    def unary(self, d):
        t = self.peek()
        if t and t[0] == "op" and t[1] in "+-":
            self.take()
            a = self.unary(d + 1)
            return self.mk(U("neg", a), d) if t[1] == "-" else a
        return self.power(d)

    def power(self, d):
        base = self.atom(d + 1)
        t = self.peek()
        if t and t[0] == "op" and t[1] == "^":
            self.take()
            return self.mk(B("^", base, self.unary(d + 1)), d)  # right-assoc
        return base

    def atom(self, d):
        t = self.peek()
        if t is None:
            raise MathError("syntax", "The equation ends unexpectedly.")
        if t[0] == "num":
            self.take()
            return self.mk(N(t[1]), d)
        if t[0] == "const":
            self.take()
            return self.mk(N(CONSTS[t[1]]), d)
        if t[0] == "var":
            self.take()
            return self.mk(V(t[1]), d)
        if t[0] == "fn":
            self.take()
            arg = self.power(d + 1)
            return self.mk(U(t[1], arg), d)
        if t == ("op", "("):
            self.take()
            inner = self.expr(d + 1)
            if self.peek() != ("op", ")"):
                raise MathError("syntax", "A bracket is not closed.")
            self.take()
            return inner
        raise MathError("syntax", f"Unexpected '{t[1]}'.")


def _parse_side(toks) -> Node:
    if not toks:
        raise MathError("syntax", "A side of the equation is empty.")
    p = _P(toks)
    node = p.expr(0)
    if p.peek() is not None:
        raise MathError("syntax", f"Unexpected '{p.peek()[1]}'.")
    return node


def parse(text: str) -> tuple[Node, Node | None]:
    toks = tokenize(text)
    eqs = [i for i, t in enumerate(toks) if t == ("op", "=")]
    if len(eqs) > 1:
        raise MathError("syntax", "Write one equation at a time (one '=' sign).")
    if not eqs:
        return _parse_side(toks), None
    k = eqs[0]
    return _parse_side(toks[:k]), _parse_side(toks[k + 1 :])


def vars_in(n: Node | None) -> set[str]:
    if n is None or isinstance(n, N):
        return set()
    if isinstance(n, V):
        return {n.name}
    if isinstance(n, U):
        return vars_in(n.a)
    return vars_in(n.a) | vars_in(n.b)


def evaluate(n: Node, x: float, y: float = 0.0) -> float:
    try:
        if isinstance(n, N):
            return n.v
        if isinstance(n, V):
            return x if n.name == "x" else y
        if isinstance(n, U):
            a = evaluate(n.a, x, y)
            if n.op == "neg":
                return -a
            if n.op in ("sqrt",) and a < 0:
                return math.nan
            if n.op in ("log", "ln") and a <= 0:
                return math.nan
            if n.op == "exp" and a > 700:
                return math.inf
            return FUNCS[n.op](a)
        a, b = evaluate(n.a, x, y), evaluate(n.b, x, y)
        if n.op == "+":
            return a + b
        if n.op == "-":
            return a - b
        if n.op == "*":
            return a * b
        if n.op == "/":
            return math.nan if b == 0 else a / b
        if n.op == "^":
            if a < 0 and not float(b).is_integer():
                return math.nan
            if abs(b) > 64:
                return math.nan
            r = a ** b
            return r.real if isinstance(r, complex) else r
    except (OverflowError, ValueError, ZeroDivisionError):
        return math.nan
    return math.nan


def to_text(n: Node) -> str:
    if isinstance(n, N):
        v = n.v
        if abs(v - math.pi) < 1e-12:
            return "π"
        return str(int(v)) if float(v).is_integer() else f"{v:g}"
    if isinstance(n, V):
        return n.name
    if isinstance(n, U):
        inner = to_text(n.a)
        return f"-{_wrap(n.a, inner)}" if n.op == "neg" else f"{n.op}({inner})"
    a, b = to_text(n.a), to_text(n.b)
    if n.op == "^":
        return f"{_wrap(n.a, a, True)}^{_wrap(n.b, b, True)}"
    if n.op in "*/":
        a = _wrap(n.a, a) if isinstance(n.a, B) and n.a.op in "+-" else a
        b = _wrap(n.b, b) if isinstance(n.b, B) and (n.b.op in "+-" or n.op == "/") else b
        if n.op == "*" and isinstance(n.a, N) and isinstance(n.b, (V, U, B)) and not (isinstance(n.b, B) and n.b.op in "*/"):
            return f"{a}{b}"
        sym = "×" if n.op == "*" else "/"
        return f"{a} {sym} {b}"
    if n.op == "-" and isinstance(n.b, B) and n.b.op in "+-":
        b = f"({b})"
    return f"{a} {n.op} {b}"


def _wrap(node: Node, s: str, tight: bool = False) -> str:
    if isinstance(node, (N, V)) or (isinstance(node, U) and node.op != "neg"):
        return s
    return f"({s})"


# ------------------------------------------------------------- graphing


@dataclass
class Series:
    label: str
    segments: list[list[dict[str, float]]] = field(default_factory=list)


@dataclass
class Graph:
    expression: str
    normalized: str
    kind: str  # function | equation | implicit
    xMin: float
    xMax: float
    yMin: float
    yMax: float
    series: list[Series]
    points: list[dict]
    note: str = ""

    def payload(self) -> dict:
        first = self.series[0].segments if self.series else []
        return {
            "expression": self.expression, "normalized": self.normalized, "kind": self.kind,
            "xMin": self.xMin, "xMax": self.xMax, "yMin": self.yMin, "yMax": self.yMax,
            "series": [{"label": s.label, "segments": s.segments} for s in self.series],
            "points": self.points, "note": self.note,
            # v1 compatibility
            "segments": first, "checkPoints": [p for p in self.points if p.get("kind") == "check"],
            "slope": "", "intercept": "",
        }


def _finite(v: float) -> bool:
    return v == v and not math.isinf(v)


def _sample(f: Callable[[float], float], lo: float, hi: float, n: int) -> list[tuple[float, float]]:
    step = (hi - lo) / (n - 1)
    return [(lo + i * step, f(lo + i * step)) for i in range(n)]


def _y_range(values: list[float]) -> tuple[float, float]:
    vals = sorted(v for v in values if _finite(v))
    if not vals:
        return -10.0, 10.0
    lo = vals[int(0.03 * (len(vals) - 1))]
    hi = vals[int(0.97 * (len(vals) - 1))]
    if hi - lo < 1e-9:
        lo, hi = lo - 5, hi + 5
    pad = (hi - lo) * 0.12
    lo, hi = lo - pad, hi + pad
    # show the x-axis when it is reasonably close
    if lo > 0 and lo < (hi - lo) * 0.6:
        lo = -(hi - lo) * 0.05
    if hi < 0 and -hi < (hi - lo) * 0.6:
        hi = (hi - lo) * 0.05
    return lo, hi


def _split(pts: list[tuple[float, float]], ylo: float, yhi: float) -> list[list[dict[str, float]]]:
    """Break the polyline at undefined points and asymptote-like jumps; clamp far points to view."""
    span = yhi - ylo
    segs: list[list[dict[str, float]]] = []
    cur: list[dict[str, float]] = []
    prev = None
    for x, y in pts:
        if not _finite(y):
            if cur:
                segs.append(cur)
            cur, prev = [], None
            continue
        if prev is not None:
            py = prev[1]
            jump = abs(y - py) > span * 1.5 and (py - ylo) * (y - ylo) != 0 and ((py > yhi and y < ylo) or (py < ylo and y > yhi) or abs(y - py) > span * 6)
            if jump:
                if cur:
                    segs.append(cur)
                cur = []
        cy = max(ylo - span * 2, min(yhi + span * 2, y))
        cur.append({"x": round(x, 6), "y": round(cy, 6)})
        prev = (x, y)
    if cur:
        segs.append(cur)
    return [s for s in segs if len(s) >= 2]


def _roots(f: Callable[[float], float], lo: float, hi: float, n: int = 2000) -> list[float]:
    out: list[float] = []
    pts = _sample(f, lo, hi, n)
    for (x0, y0), (x1, y1) in zip(pts, pts[1:]):
        if not (_finite(y0) and _finite(y1)):
            continue
        if y0 == 0:
            out.append(x0)
            continue
        if y0 * y1 < 0:
            a, b, fa = x0, x1, y0
            for _ in range(60):
                m = (a + b) / 2
                fm = f(m)
                if not _finite(fm):
                    break
                if fa * fm <= 0:
                    b = m
                else:
                    a, fa = m, fm
            r = (a + b) / 2
            # reject sign changes across a pole (value blows up near the "root")
            if _finite(f(r)) and abs(f(r)) < 1e-6 * max(1.0, abs(y0), abs(y1)) + 1e-6:
                out.append(r)
    # touching roots (no sign change, e.g. x^2 at 0): local minima of |f| that reach ~0
    ys = [abs(y) if _finite(y) else math.inf for _, y in pts]
    scale = max([v for v in ys if v != math.inf] or [1.0])
    for k in range(1, len(pts) - 1):
        if ys[k] <= ys[k - 1] and ys[k] <= ys[k + 1] and ys[k] < scale * 1e-3:
            a, b = pts[k - 1][0], pts[k + 1][0]
            for _ in range(80):  # golden-section search on |f|
                m1, m2 = a + (b - a) * 0.382, a + (b - a) * 0.618
                if abs(f(m1)) < abs(f(m2)):
                    b = m2
                else:
                    a = m1
            r = (a + b) / 2
            if _finite(f(r)) and abs(f(r)) < 1e-9 * max(1.0, scale) and all(abs(r - o) > (hi - lo) * 1e-4 for o in out):
                out.append(r)
    out.sort()
    snapped = [0.0 if abs(r) < (hi - lo) * 1e-7 else float(f"{r:.9g}") for r in out]
    dedup: list[float] = []
    for r in snapped:
        if not dedup or abs(r - dedup[-1]) > (hi - lo) * 1e-4:
            dedup.append(r)
    return dedup[:12]


def _nice(v: float) -> float:
    r = round(v, 6)
    return 0.0 if r == 0 else r


def _marching(F: Callable[[float, float], float], x0, x1, y0, y1, n=140) -> list[list[dict[str, float]]]:
    dx, dy = (x1 - x0) / n, (y1 - y0) / n
    grid = [[F(x0 + i * dx, y0 + j * dy) for i in range(n + 1)] for j in range(n + 1)]
    finite = [abs(v) for row in grid for v in row if _finite(v)]
    if not finite:
        return []
    scale = sorted(finite)[len(finite) // 2] or 1.0
    segs = []

    def interp(xa, ya, va, xb, yb, vb):
        t = va / (va - vb) if va != vb else 0.5
        return {"x": round(xa + t * (xb - xa), 5), "y": round(ya + t * (yb - ya), 5)}

    for j in range(n):
        for i in range(n):
            a, b, c, d = grid[j][i], grid[j][i + 1], grid[j + 1][i + 1], grid[j + 1][i]
            if not all(_finite(v) for v in (a, b, c, d)):
                continue
            if max(abs(a), abs(b), abs(c), abs(d)) > scale * 50:
                continue  # near a pole: sign change is not a curve
            xa, ya = x0 + i * dx, y0 + j * dy
            corners = [(xa, ya, a), (xa + dx, ya, b), (xa + dx, ya + dy, c), (xa, ya + dy, d)]
            cross = []
            for k in range(4):
                p, q = corners[k], corners[(k + 1) % 4]
                if (p[2] < 0) != (q[2] < 0):
                    cross.append(interp(*p, *q))
            if len(cross) == 2:
                segs.append(cross)
            elif len(cross) == 4:
                segs.append(cross[:2])
                segs.append(cross[2:])
    return segs[:6000]


def graph(expression: str, x_min: float | None = None, x_max: float | None = None) -> Graph:
    text = expression.strip()
    if not text:
        raise MathError("syntax", "There is nothing to graph.")
    left, right = parse(text)
    vs = vars_in(left) | vars_in(right)
    if not vs:
        raise MathError("unsupported", "This line has no x or y, so there is nothing to graph. Graphs need a variable, like y = 2x + 1.")
    auto_x = x_min is None or x_max is None
    lo = -10.0 if x_min is None else max(-1000.0, float(x_min))
    hi = 10.0 if x_max is None else min(1000.0, float(x_max))
    if not lo < hi:
        raise MathError("limits", "xMin must be smaller than xMax.")

    # ---- y = f(x)  (or f(x) = y)
    fx: Node | None = None
    if right is None and vs == {"x"}:
        fx = left
    elif right is not None and isinstance(left, V) and left.name == "y" and "y" not in vars_in(right):
        fx = right
    elif right is not None and isinstance(right, V) and right.name == "y" and "y" not in vars_in(left):
        fx = left
    if fx is not None:
        f = lambda x: evaluate(fx, x)  # noqa: E731
        pts = _sample(f, lo, hi, 801)
        ylo, yhi = _y_range([p[1] for p in pts])
        segs = _split(pts, ylo, yhi)
        if not segs:
            raise MathError("unsupported", "This function has no real values between x = %g and %g." % (lo, hi))
        points = []
        for r in _roots(f, lo, hi)[:6]:
            points.append({"x": _nice(r), "y": 0.0, "label": f"x = {r:.4g}", "kind": "root"})
        y0 = f(0.0)
        if lo <= 0 <= hi and _finite(y0):
            points.append({"x": 0.0, "y": _nice(y0), "label": f"(0, {y0:.3g})", "kind": "intercept"})
        for cx in (-1.0, 1.0):
            v = f(cx)
            if lo <= cx <= hi and _finite(v):
                points.append({"x": cx, "y": _nice(v), "label": "", "kind": "check"})
        norm = f"y = {to_text(fx)}"
        return Graph(text, norm, "function", lo, hi, ylo, yhi, [Series(norm, segs)], points)

    # ---- f(x) = g(x): both sides, intersections are the solutions
    if right is not None and vs == {"x"}:
        fl = lambda x: evaluate(left, x)  # noqa: E731
        fr = lambda x: evaluate(right, x)  # noqa: E731
        h = lambda x: fl(x) - fr(x)  # noqa: E731
        probes = [lo, hi, 0.0, 0.37, 2.71, -3.3, (lo + hi) / 2]
        identity = all(_finite(h(x)) and abs(h(x)) < 1e-9 * max(1.0, abs(fl(x))) for x in probes)
        roots = [] if identity else _roots(h, lo, hi)
        if auto_x and not roots and not identity:
            wide = _roots(h, -1000, 1000, 8000)
            if wide:
                c = wide[0]
                half = max(10.0, abs(c) * 0.6)
                lo, hi = c - half, c + half
                roots = _roots(h, lo, hi)
        pl, pr = _sample(fl, lo, hi, 801), _sample(fr, lo, hi, 801)
        ylo, yhi = _y_range([p[1] for p in pl] + [p[1] for p in pr] + [fl(r) for r in roots])
        ln, rn = f"y = {to_text(left)}", f"y = {to_text(right)}"
        series = [Series(ln, _split(pl, ylo, yhi)), Series(rn, _split(pr, ylo, yhi))]
        points = [{"x": _nice(r), "y": _nice(fl(r)), "label": f"x = {r:.4g}", "kind": "solution"} for r in roots[:6]]
        note = ""
        if not roots:
            note = "Both sides are the same graph: every x is a solution." if identity else "The two sides never meet here: no solution in this range."
        else:
            note = "The solution is where the two graphs cross."
        return Graph(text, f"{to_text(left)} = {to_text(right)}", "equation", lo, hi, ylo, yhi, series, points, note)

    # ---- implicit F(x, y) = 0
    rhs = right if right is not None else N(0.0)
    F = lambda x, y: evaluate(left, x, y) - evaluate(rhs, x, y)  # noqa: E731
    # linear in y (e.g. 3x + 2y = 6): solve exactly for y and draw it as a function
    probe_x = [lo, hi, 0.0, 1.3, -2.7]
    linear_y = True
    for px in probe_x:
        a0, a1, a2, a5 = F(px, 0), F(px, 1), F(px, 2), F(px, 5)
        if not all(_finite(v) for v in (a0, a1, a2, a5)):
            linear_y = False
            break
        d = a1 - a0
        tol = 1e-9 * max(1.0, abs(a0), abs(a1))
        if abs(d) < tol or abs((a2 - a0) - 2 * d) > tol * 10 or abs((a5 - a0) - 5 * d) > tol * 10:
            linear_y = False
            break
    if linear_y:
        g = lambda x: -F(x, 0) / (F(x, 1) - F(x, 0)) if (F(x, 1) - F(x, 0)) != 0 else math.nan  # noqa: E731
        pts = _sample(g, lo, hi, 801)
        ylo, yhi = _y_range([p[1] for p in pts])
        norm = f"{to_text(left)} = {to_text(rhs)}"
        points = [{"x": _nice(r), "y": 0.0, "label": f"x = {r:.4g}", "kind": "root"} for r in _roots(g, lo, hi)[:4]]
        g0 = g(0.0)
        if lo <= 0 <= hi and _finite(g0):
            points.append({"x": 0.0, "y": _nice(g0), "label": f"(0, {g0:.3g})", "kind": "intercept"})
        return Graph(text, norm, "function", lo, hi, ylo, yhi, [Series(norm, _split(pts, ylo, yhi))], points)
    ylo, yhi = lo, hi
    segs = _marching(F, lo, hi, ylo, yhi)
    if not segs:
        segs = _marching(F, lo * 5, hi * 5, ylo * 5, yhi * 5)
        lo, hi, ylo, yhi = lo * 5, hi * 5, ylo * 5, yhi * 5
    if not segs:
        raise MathError("unsupported", "No points satisfy this equation in the visible range.")
    norm = f"{to_text(left)} = {to_text(rhs)}"
    return Graph(text, norm, "implicit", lo, hi, ylo, yhi, [Series(norm, segs)], [])
