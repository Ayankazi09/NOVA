"""expr_v2: exact, deterministic maths for anything a student writes on a line.

Finish a line that ends with "=":
    3 + 2 =              -> 5                 sin 30° =          -> 1/2 (bare numbers in trig = degrees)
    tan 60 =             -> √3                sin²θ + cos²θ =    -> 1
    (a + b)² =           -> a² + 2ab + b²     x² - 5x + 6 =      -> (x - 2)(x - 3)
    d/dx (x³ + 2x) =     -> 3x² + 2           ∫ 2x dx =          -> x² + C
    lim x→0 sin x / x =  -> 1                 5! =               -> 120
    gcd(12, 18) =        -> 6                 20% of 50 =        -> 10          log_2 8 = -> 3
Solve an equation / inequality:
    x² - 5x + 6 = 0      -> x = 2 or x = 3    2x + 3 > 7         -> x > 2
    2 sin θ = 1          -> θ = 30° or θ = 150°  (0° ≤ θ < 360°)
Compare two equations (is this step equivalent to the problem?) for any algebra, not only linear.

The text is tokenised and parsed by our own grammar; SymPy objects are built directly from the parse
(never sympify/parse_expr on user text). All work runs in a separate process with a hard time limit.
"""

from __future__ import annotations

import concurrent.futures as cf
import multiprocessing
import os
import re
import threading
from dataclasses import dataclass

MAX_CHARS = 200
MAX_TOKENS = 150
TIME_LIMIT_S = 5.0

FUNC_NAMES = {
    "sin", "cos", "tan", "sec", "cosec", "csc", "cot", "sqrt", "log", "ln", "exp", "abs",
    "gcd", "hcf", "lcm", "ncr", "npr", "lim", "arcsin", "arccos", "arctan",
}
WORDS = {"theta": ("var", "theta"), "alpha": ("var", "alpha"), "beta": ("var", "beta"), "phi": ("var", "phi"),
         "pi": ("pi", "pi"), "of": ("op", "*"), "to": ("to", "to"), "infinity": ("inf", "inf"), "inf": ("inf", "inf"),
         "integral": ("int", "int")}
GREEK = {"θ": "theta", "α": "alpha", "β": "beta", "φ": "phi"}
TRIG = ("sin", "cos", "tan", "sec", "csc", "cot")


class SolveError(ValueError):
    pass


# ----------------------------------------------------------------- tokens

_REPL = [
    ("−", "-"), ("–", "-"), ("×", "*"), ("⋅", "*"), ("·", "*"), ("÷", "/"),
    ("²", "^2"), ("³", "^3"), ("⁻¹", "^-1"), ("√", " sqrt "), ("π", " pi "), ("**", "^"),
    ("[", "("), ("]", ")"), ("{", "("), ("}", ")"), ("º", "°"), ("≤", "<="), ("≥", ">="),
    ("≠", "!="), ("→", " to "), ("->", " to "), ("∞", " inf "), ("∫", " integral "),
]


def tokenize(text: str) -> list[tuple[str, str]]:
    if len(text) > MAX_CHARS:
        raise SolveError("The line is too long.")
    s = text.strip()
    for a, b in _REPL:
        s = s.replace(a, b)
    s = re.sub(r"(\d+)\s*C\s*(\d+)", r" ncr(\1,\2) ", s)  # 5C2
    s = re.sub(r"(\d+)\s*P\s*(\d+)", r" npr(\1,\2) ", s)  # 5P2
    toks: list[tuple[str, str]] = []
    i = 0
    while i < len(s):
        c = s[i]
        two = s[i : i + 2]
        if c.isspace():
            i += 1
        elif c.isdigit() or (c == "." and i + 1 < len(s) and s[i + 1].isdigit()):
            j = i
            while j < len(s) and (s[j].isdigit() or s[j] == "."):
                j += 1
            if s[i:j].count(".") > 1:
                raise SolveError(f"'{s[i:j]}' is not a number.")
            toks.append(("num", s[i:j]))
            i = j
        elif c in GREEK:
            toks.append(("var", GREEK[c]))
            i += 1
        elif c.isalpha():
            j = i
            while j < len(s) and s[j].isalpha():
                j += 1
            word = s[i:j].lower()
            i = j
            names = sorted(list(FUNC_NAMES) + list(WORDS), key=len, reverse=True)
            k = 0
            loose = 0  # consecutive single letters that are not a known name
            while k < len(word):  # split runs like "sinx", "2ab", "costheta"
                if loose >= 4:
                    raise SolveError(f"'{word}' is not something NOVA can work out.")
                for name in names:
                    if word.startswith(name, k):
                        loose = 0
                        if name in FUNC_NAMES:
                            canon = {"cosec": "csc", "hcf": "gcd", "arcsin": "asin", "arccos": "acos", "arctan": "atan"}.get(name, name)
                            toks.append(("fn", canon))
                        else:
                            toks.append(WORDS[name])
                        k += len(name)
                        break
                else:
                    ch = word[k]
                    toks.append(("e", "e") if ch == "e" else ("var", GREEK.get(ch, ch)))
                    k += 1
                    loose += 1
            if loose >= 4:
                raise SolveError(f"'{word}' is not something NOVA can work out.")
        elif two in ("<=", ">=", "!="):
            toks.append(("rel", two))
            i += 2
        elif c in "<>":
            toks.append(("rel", c))
            i += 1
        elif c == "=":
            toks.append(("rel", "="))
            i += 1
        elif c == "°":
            toks.append(("deg", c))
            i += 1
        elif c in "!%":
            toks.append(("post", c))
            i += 1
        elif c in "+-*/^(),|_":
            toks.append(("op", c))
            i += 1
        else:
            raise SolveError(f"'{c}' is not supported.")
        if len(toks) > MAX_TOKENS:
            raise SolveError("The line is too long.")
    return toks


# ----------------------------------------------------------------- parser (builds SymPy objects)


class _P:
    def __init__(self, toks, sp):
        self.t, self.i, self.sp = toks, 0, sp
        self.decimal = any(k == "num" and "." in v for k, v in toks)
        self.integral = False
        self.inverse_trig = False

    def peek(self, off=0):
        j = self.i + off
        return self.t[j] if j < len(self.t) else None

    def take(self):
        tok = self.t[self.i]
        self.i += 1
        return tok

    def expect(self, tok, msg):
        if self.peek() != tok:
            raise SolveError(msg)
        self.take()

    def done(self):
        if self.peek() is not None:
            raise SolveError(f"Unexpected '{self.peek()[1]}'.")

    def expr(self):
        node = self.term()
        while (t := self.peek()) and t[0] == "op" and t[1] in "+-":
            self.take()
            rhs = self.term()
            node = node + rhs if t[1] == "+" else node - rhs
        return node

    def _starts_atom(self, t):
        return t and (t[0] in ("num", "var", "pi", "e", "fn", "int", "inf") or t in (("op", "("), ("op", "|")))

    def term(self):
        node = self.unary()
        while (t := self.peek()):
            if t[0] == "op" and t[1] in "*/":
                self.take()
                rhs = self.unary()
                if t[1] == "/":
                    if rhs == 0:
                        raise SolveError("Division by zero is undefined.")
                    node = node / rhs
                else:
                    node = node * rhs
            elif self._starts_atom(t) and not self._at_dx():
                if t == ("op", "|") and self._closing_bar():
                    break
                node = node * self.power()
            else:
                break
        return node

    def _closing_bar(self):
        # a '|' that closes an abs group: count bars before this one
        return sum(1 for k in range(self.i) if self.t[k] == ("op", "|")) % 2 == 1

    def _at_dx(self):
        a, b = self.peek(), self.peek(1)
        return self.integral and a == ("var", "d") and b is not None and b[0] == "var"

    def unary(self):
        t = self.peek()
        if t and t[0] == "op" and t[1] in "+-":
            self.take()
            v = self.unary()
            return -v if t[1] == "-" else v
        return self.power()

    def power(self):
        base = self.postfix()
        if self.peek() == ("op", "^"):
            self.take()
            exp = self.unary()
            if exp.is_number and abs(exp) > 60:
                raise SolveError("That power is too large.")
            base = base**exp
        return base

    def postfix(self):
        sp = self.sp
        node = self.atom()
        while (t := self.peek()) and t[0] in ("deg", "post"):
            self.take()
            if t[0] == "deg":
                node = node * sp.pi / 180
            elif t[1] == "!":
                if not (node.is_Integer and 0 <= node <= 170):
                    raise SolveError("Factorials are for whole numbers from 0 to 170.")
                node = sp.factorial(node)
            else:
                node = node / 100
        return node

    def number(self, text):
        sp = self.sp
        return sp.Rational(text) if "." in text else sp.Integer(int(text))

    def args(self):
        self.expect(("op", "("), "Expected '('.")
        out = [self.expr()]
        while self.peek() == ("op", ","):
            self.take()
            out.append(self.expr())
        self.expect(("op", ")"), "A bracket is not closed.")
        return out

    def fn_arg(self):
        """sin 30°, sin θ, sin 2θ, √3, log 100 — an argument written without brackets."""
        if self.peek() == ("op", "("):
            a = self.args()
            return a[0] if len(a) == 1 else a
        arg = self.postfix()
        while (n := self.peek()) and n[0] in ("var", "pi", "num", "e"):
            arg = arg * self.postfix()
        if self.peek() == ("op", "^"):
            self.take()
            arg = arg ** self.unary()
        return arg

    def atom(self):
        sp = self.sp
        t = self.peek()
        if t is None:
            raise SolveError("The line ends unexpectedly.")
        if t[0] == "num":
            self.take()
            return self.number(t[1])
        if t[0] == "pi":
            self.take()
            return sp.pi
        if t[0] == "e":
            self.take()
            return sp.E
        if t[0] == "inf":
            self.take()
            return sp.oo
        if t[0] == "var":
            # d/dx ( ... )
            if t[1] == "d" and self.peek(1) == ("op", "/") and self.peek(2) == ("var", "d") and self.peek(3) and self.peek(3)[0] == "var":
                self.i += 3
                v = sp.Symbol(self.take()[1], real=True)
                body = self.fn_arg() if self.peek() == ("op", "(") else self.term()
                return sp.diff(body, v)
            self.take()
            return sp.Symbol(t[1], real=True)
        if t == ("op", "("):
            self.take()
            inner = self.expr()
            self.expect(("op", ")"), "A bracket is not closed.")
            return inner
        if t == ("op", "|"):
            self.take()
            inner = self.expr()
            self.expect(("op", "|"), "An absolute value bar is not closed.")
            return sp.Abs(inner)
        if t[0] == "int":
            return self.integral_()
        if t[0] == "fn":
            self.take()
            return self.function(t[1])
        raise SolveError(f"Unexpected '{t[1]}'.")

    def integral_(self):
        sp = self.sp
        self.take()
        lo = hi = None
        if self.peek() == ("op", "_"):
            self.take()
            lo = self.postfix()
            self.expect(("op", "^"), "Write a definite integral as ∫_a^b ... dx.")
            hi = self.postfix()
        # integrand runs until "d<var>"
        j = next((k for k in range(self.i, len(self.t) - 1) if self.t[k] == ("var", "d") and self.t[k + 1][0] == "var"), None)
        if j is None:
            raise SolveError("Finish the integral with dx (or dθ).")
        sub = _P(self.t[self.i : j], sp)
        sub.integral = True
        body = sub.expr()
        sub.done()
        v = sp.Symbol(self.t[j + 1][1], real=True)
        self.i = j + 2
        if lo is not None:
            return sp.integrate(body, (v, lo, hi))
        self.integral = True
        res = sp.integrate(body, v)
        if res.has(sp.Integral):
            raise SolveError("NOVA can't find this integral in closed form.")
        return res

    def function(self, name):
        sp = self.sp
        if name == "lim":
            if not (self.peek() and self.peek()[0] == "var"):
                raise SolveError("Write a limit as lim x→a ...")
            v = sp.Symbol(self.take()[1], real=True)
            self.expect(("to", "to"), "Write a limit as lim x→a ...")
            target = self.unary()
            body = self.term()
            return sp.limit(body, v, target)
        if name == "log" and self.peek() == ("op", "_"):  # log_2 8
            self.take()
            base = self.postfix()
            return sp.log(self.fn_arg(), base)
        power = None
        if self.peek() == ("op", "^"):  # sin^2 θ, sin^-1 x
            self.take()
            power = self.unary()
        arg = self.fn_arg()
        if name in ("gcd", "lcm", "ncr", "npr"):
            if not isinstance(arg, list) or len(arg) != 2 or not all(a.is_Integer for a in arg):
                raise SolveError(f"{name}( , ) needs two whole numbers.")
            a, b = arg
            if name == "gcd":
                return sp.gcd(a, b)
            if name == "lcm":
                return sp.lcm(a, b)
            if not (0 <= b <= a <= 1000):
                raise SolveError("Use 0 ≤ r ≤ n ≤ 1000.")
            return sp.binomial(a, b) if name == "ncr" else sp.factorial(a) / sp.factorial(a - b)
        if isinstance(arg, list):
            if name == "log" and len(arg) == 2:
                return sp.log(arg[0], arg[1])
            raise SolveError(f"{name} takes one value.")
        if name in TRIG and power == -1:
            inv = {"sin": sp.asin, "cos": sp.acos, "tan": sp.atan}.get(name)
            if inv is None:
                raise SolveError("Use sin⁻¹, cos⁻¹ or tan⁻¹.")
            self.inverse_trig = True
            return inv(arg)
        if name in ("asin", "acos", "atan"):
            self.inverse_trig = True
        if name in TRIG and arg.is_number and not arg.has(sp.pi):
            arg = arg * sp.pi / 180  # Classes 8-10 convention: sin 30 means degrees
        fn = {"sin": sp.sin, "cos": sp.cos, "tan": sp.tan, "sec": sp.sec, "csc": sp.csc, "cot": sp.cot,
              "sqrt": sp.sqrt, "log": lambda a: sp.log(a, 10), "ln": sp.log, "exp": sp.exp, "abs": sp.Abs,
              "asin": sp.asin, "acos": sp.acos, "atan": sp.atan}[name]
        val = fn(arg)
        return val**power if power is not None else val


def parse_side(toks, sp) -> tuple[object, _P]:
    if not toks:
        raise SolveError("A side is empty.")
    p = _P(toks, sp)
    e = p.expr()
    p.done()
    return e, p


# ----------------------------------------------------------------- printer (handwriting-friendly text)


GREEK_OUT = {"theta": "θ", "alpha": "α", "beta": "β", "phi": "φ"}
_SUPS = str.maketrans("0123456789-", "⁰¹²³⁴⁵⁶⁷⁸⁹⁻")


def to_hand(e, sp, degrees: bool = False) -> str:
    """Readable plain maths: √3/2, sin 2θ, a² + 2ab + b², -1/2, 3x² + 2, 30°."""

    def fn_name(f):
        return {sp.sin: "sin", sp.cos: "cos", sp.tan: "tan", sp.sec: "sec", sp.csc: "cosec", sp.cot: "cot",
                sp.asin: "sin⁻¹", sp.acos: "cos⁻¹", sp.atan: "tan⁻¹"}[f]

    def p(e, ctx=0):  # ctx: 0 top, 1 product factor, 2 power base
        if degrees and e.is_number and e.is_real and not e.is_Integer and e.has(sp.pi):
            d = sp.nsimplify(e * 180 / sp.pi)
            return f"{p(d, ctx)}°"
        if e == sp.oo:
            return "∞"
        if e == -sp.oo:
            return "-∞"
        if e.is_Integer:
            s = str(e)
            return f"({s})" if ctx and e < 0 else s
        if e.is_Rational:
            s = f"{e.p}/{e.q}"
            return f"({s})" if ctx else s
        if e.is_Float:
            s = f"{float(e):.6g}"
            return f"({s})" if ctx and float(e) < 0 else s
        if e == sp.pi:
            return "π"
        if e == sp.E:
            return "e"
        if e.is_Symbol:
            return GREEK_OUT.get(e.name, e.name)
        if e.func == sp.exp:
            return f"e^({p(e.args[0])})" if not e.args[0].is_Symbol else f"e^{p(e.args[0])}"
        if e.is_Pow:
            b, x = e.args
            if x == sp.Rational(1, 2):
                return f"√{p(b, 2)}"
            if x == -sp.Rational(1, 2):
                return f"1/√{p(b, 2)}"
            if x == -1:
                return f"1/{p(b, 2)}"
            if x.is_Integer and x > 0:
                if b.func in (sp.sin, sp.cos, sp.tan, sp.sec, sp.csc, sp.cot):
                    return f"{fn_name(b.func)}{str(x).translate(_SUPS)}{p(b.args[0], 1)}"
                return f"{p(b, 2)}{str(x).translate(_SUPS)}"
            return f"{p(b, 2)}^({p(x)})"
        if e.is_Mul:
            coeff, rest = e.as_coeff_Mul()
            if coeff.is_negative:
                body = p(-e, 0)
                return f"(-{body})" if ctx else f"-{body}"
            num, den = sp.fraction(e)
            if den != 1:
                s = f"{p(num, 1)}/{p(den, 2)}"
                return f"({s})" if ctx == 2 else s
            parts = [p(f, 1) for f in (rest.args if rest.is_Mul else (rest,))]
            if len(parts) > 1 and all(x.startswith("(") for x in parts):
                parts.sort()  # (x - 2)(x - 3)
            body = ""
            for k, part in enumerate(parts):
                body += ("·" if k and (part[0].isdigit() or body[-1].isdigit() and part[0].isdigit()) else "") + part
            if coeff == 1:
                return body
            c = p(coeff, 1)
            s = f"{c}{body}" if not body[0].isdigit() else f"{c}·{body}"
            return f"({s})" if ctx == 2 else s
        if e.is_Add:
            terms = list(sp.Add.make_args(e))
            if e.free_symbols and e.is_polynomial():
                # textbook order: highest degree first, then alphabetical (a² + 2ab + b²)
                gens = sorted(e.free_symbols, key=lambda g: g.name)
                poly = sp.Poly(e, *gens)
                terms = [sp.Mul(c, *[g**k for g, k in zip(gens, m)]) for m, c in sorted(poly.terms(), key=lambda mc: (-sum(mc[0]), [-k for k in mc[0]]))]
            elif e.free_symbols:
                terms.sort(key=lambda t: (t.is_number, str(t)))  # constants last
            out = ""
            for k, t in enumerate(terms):
                s = p(t, 0)
                if k == 0:
                    out = s
                elif s.startswith("-"):
                    out += f" - {s[1:]}"
                else:
                    out += f" + {s}"
            return f"({out})" if ctx else out
        if e.func in (sp.sin, sp.cos, sp.tan, sp.sec, sp.csc, sp.cot, sp.asin, sp.acos, sp.atan):
            a = p(e.args[0], 1)
            return f"{fn_name(e.func)} {a}" if not ctx else f"({fn_name(e.func)} {a})"
        if e.func == sp.Abs:
            return f"|{p(e.args[0])}|"
        if e.func == sp.log:
            return f"ln({p(e.args[0])})" if not e.args[0].is_Symbol else f"ln {p(e.args[0])}"
        if e.func == sp.factorial:
            return f"{p(e.args[0], 2)}!"
        return str(e)

    return p(e)


def _shape(t: str) -> str:
    """Compare written forms loosely: ignore spaces, brackets, multiplication dots and power notation."""
    t = t.translate(str.maketrans("⁰¹²³⁴⁵⁶⁷⁸⁹⁻", "0123456789-")).lower().replace("theta", "θ")
    return re.sub(r"[\s()·*^]", "", t)


# ----------------------------------------------------------------- finishing a line ("... =")


def _finish(toks, text, sp) -> dict:
    e, p = parse_side(toks, sp)
    if e.has(sp.zoo, sp.nan):
        raise SolveError("The value is undefined.")
    suffix = " + C" if p.integral else ""
    if not e.free_symbols:
        v = sp.nsimplify(sp.simplify(e), rational=False) if e.is_finite is not False else e
        if v.has(sp.zoo, sp.nan) or v.is_real is False:
            raise SolveError("The value is undefined (not a real number).")
        if v in (sp.oo, -sp.oo):
            return {"status": "answered", "answer": to_hand(v, sp), "kind": "value"}
        ans = f"{float(v):.6g}" if p.decimal and not v.is_Integer else to_hand(sp.radsimp(v), sp, degrees=p.inverse_trig)
        if len(ans) > 40:
            ans = f"{float(v):.6g}"
        if _shape(ans) == _shape(text.rstrip("= ")):
            return {"status": "not_applicable", "message": "This is already as simple as it gets."}
        return {"status": "answered", "answer": ans, "kind": "value", "approx": f"{float(v):.6g}"}
    written = _shape(text.rstrip("= "))
    s = sp.trigsimp(sp.simplify(e))
    if sp.count_ops(s) <= sp.count_ops(e) and _shape(to_hand(s, sp)) != written:
        return {"status": "answered", "answer": to_hand(s, sp) + suffix, "kind": "simplified"}
    x = sp.expand(e)
    if sp.count_ops(x) <= 40 and _shape(to_hand(x, sp)) != written:
        return {"status": "answered", "answer": to_hand(x, sp) + suffix, "kind": "expanded"}
    f = sp.factor(e)
    if f != e and _shape(to_hand(f, sp)) != written:
        return {"status": "answered", "answer": to_hand(f, sp) + suffix, "kind": "factorised"}
    if suffix:
        return {"status": "answered", "answer": to_hand(e, sp) + suffix, "kind": "integral"}
    return {"status": "not_applicable", "message": "This is already as simple as it gets."}


# ----------------------------------------------------------------- solving / comparing


def _pick_var(syms, sp):
    names = {s.name: s for s in syms}
    if "x" in names and "y" in names:
        return names["y"]
    for n in ("x", "theta", "y", "t", "n", "a"):
        if n in names:
            return names[n]
    return sorted(syms, key=lambda s: s.name)[0]


def _rel(op, l, r, sp):
    return {"=": sp.Eq, "<": sp.Lt, ">": sp.Gt, "<=": sp.Le, ">=": sp.Ge, "!=": sp.Ne}[op](l, r)


def _domain(v, expr, sp):
    """Angles: principal solutions 0 ≤ θ < 360°. Otherwise all reals."""
    trig = expr.has(sp.sin, sp.cos, sp.tan, sp.sec, sp.csc, sp.cot)
    if trig:
        return sp.Interval.Ropen(0, 2 * sp.pi), True
    return sp.S.Reals, False


def _fmt_set(S, v, sp, degrees):
    name = GREEK_OUT.get(v.name, v.name)
    h = lambda e: to_hand(sp.nsimplify(e) if e.is_number and not e.is_Rational else e, sp, degrees)  # noqa: E731
    if S == sp.S.EmptySet:
        return "no real solution"
    if S == sp.S.Reals or (degrees and S == sp.Interval.Ropen(0, 2 * sp.pi)):
        return f"true for every {name}"
    if isinstance(S, sp.FiniteSet):
        vals = sorted(S, key=lambda z: float(z) if z.is_real else 0)
        if len(vals) > 8:
            raise SolveError("Too many solutions to write out.")
        return " or ".join(f"{name} = {h(z)}" for z in vals)
    if isinstance(S, sp.Interval):
        lo, hi = S.start, S.end
        if lo == -sp.oo:
            return f"{name} {'<' if S.right_open else '≤'} {h(hi)}"
        if hi == sp.oo:
            return f"{name} {'>' if S.left_open else '≥'} {h(lo)}"
        return f"{h(lo)} {'<' if S.left_open else '≤'} {name} {'<' if S.right_open else '≤'} {h(hi)}"
    if isinstance(S, sp.Union):
        return " or ".join(_fmt_set(a, v, sp, degrees) for a in S.args)
    if isinstance(S, sp.Complement) and S.args[0] == sp.S.Reals and isinstance(S.args[1], sp.FiniteSet):
        return f"every {name} except " + ", ".join(h(z) for z in S.args[1])
    raise SolveError("NOVA can't write this solution set simply.")


def _solve(toks, rel_at, sp) -> dict:
    op = toks[rel_at][1]
    l, _ = parse_side(toks[:rel_at], sp)
    r, _ = parse_side(toks[rel_at + 1 :], sp)
    syms = (l - r).free_symbols if op == "=" else (l.free_symbols | r.free_symbols)
    if not syms:
        ok = bool(_rel(op, l, r, sp))
        letters = l.free_symbols | r.free_symbols
        if letters:
            name = GREEK_OUT.get(_pick_var(letters, sp).name, _pick_var(letters, sp).name)
            return {"status": "answered", "answer": f"true for every {name}" if ok else "no solution", "kind": "truth"}
        return {"status": "answered", "answer": "true" if ok else "false", "kind": "truth"}
    v = _pick_var(syms, sp)
    expr = l - r
    if len(syms) > 1:
        if op != "=":
            raise SolveError("Inequalities with more than one letter are not solved automatically.")
        sols = sp.solve(sp.Eq(l, r), v, dict=False)
        if not sols or len(sols) > 4:
            raise SolveError("NOVA can't rearrange this neatly.")
        name = GREEK_OUT.get(v.name, v.name)
        return {"status": "answered", "answer": " or ".join(f"{name} = {to_hand(sp.simplify(s), sp)}" for s in sols), "kind": "rearranged"}
    dom, degrees = _domain(v, expr, sp)
    if op == "=":
        S = sp.solveset(sp.Eq(l, r), v, domain=dom)
    elif op == "!=":
        S = sp.solveset(sp.Ne(l, r), v, domain=dom)
    else:
        S = sp.solveset(_rel(op, l, r, sp), v, domain=dom)
    if isinstance(S, sp.ConditionSet):
        raise SolveError("NOVA can't solve this one exactly.")
    ans = _fmt_set(S, v, sp, degrees)
    return {"status": "answered", "answer": ans, "kind": "solved", "note": "0° ≤ θ < 360°" if degrees else ""}


def _compare(problem: str, current: str, sp) -> dict:
    """Same solution set => equivalent step (or solved if the step isolates the variable)."""
    pt, ct = tokenize(problem), tokenize(current)

    def eqn(toks):
        rels = [k for k, t in enumerate(toks) if t[0] == "rel"]
        if len(rels) != 1 or toks[rels[0]][1] != "=":
            raise SolveError("Expected one equation with one '='.")
        l, _ = parse_side(toks[: rels[0]], sp)
        r, _ = parse_side(toks[rels[0] + 1 :], sp)
        return l, r

    pl, pr = eqn(pt)
    cl, cr = eqn(ct)
    syms = (pl - pr).free_symbols | (cl - cr).free_symbols
    if len(syms) != 1:
        raise SolveError("Checking needs exactly one unknown.")
    v = next(iter(syms))
    dom, _ = _domain(v, pl - pr, sp)
    ps = sp.solveset(sp.Eq(pl, pr), v, domain=dom)
    cs = sp.solveset(sp.Eq(cl, cr), v, domain=dom)
    if isinstance(ps, sp.ConditionSet) or isinstance(cs, sp.ConditionSet):
        raise SolveError("NOVA can't check this one exactly.")
    if ps != cs:
        return {"status": "different", "answer": None, "kind": "compare"}
    isolated = (cl == v and not cr.free_symbols) or (cr == v and not cl.free_symbols)
    return {"status": "solved" if isolated else "equivalent", "answer": None, "kind": "compare"}


# ----------------------------------------------------------------- verifying content NOVA writes


_UNDEF = re.compile(r"^(not defined|undefined|nd|n\.d\.|∞|infinity|-|—)$", re.IGNORECASE)
_ANGLE = re.compile(r"^-?[\d.]+\s*°?$|π")


def _truth(text: str, sp) -> bool | None:
    """True/False for a statement with nothing to solve for (or an identity); None if it is not checkable."""
    toks = tokenize(text)
    rels = [k for k, t in enumerate(toks) if t[0] == "rel"]
    if len(rels) != 1 or toks[rels[0]][1] != "=":
        return None
    l, _ = parse_side(toks[: rels[0]], sp)
    r, _ = parse_side(toks[rels[0] + 1 :], sp)
    d = sp.simplify(sp.trigsimp(l - r))
    if d == 0:
        return True
    if not d.free_symbols:
        return False
    return None


def _value(expr: str, sp) -> tuple[str | None, bool]:
    """(answer, undefined?) for an expression."""
    toks = tokenize(expr)
    try:
        r = _finish(toks, expr + " =", sp)
    except SolveError as e:
        return None, "undefined" in str(e)
    return (r.get("answer") if r.get("status") == "answered" else None), False


def _verify_lines(lines: list[str]) -> list[dict]:
    import sympy as sp

    out = []
    for line in lines:
        try:
            ok = _truth(line, sp)
        except SolveError:
            ok = None
        except Exception:
            ok = None
        fixed = None
        if ok is False:
            lhs = line.split("=")[0].strip()
            try:
                val, _ = _value(lhs, sp)
                if val:
                    fixed = f"{lhs} = {val}"
            except Exception:
                fixed = None
        out.append({"ok": ok, "fixed": fixed})
    return out


def _cell_expr(fn: str, arg: str) -> str:
    fn, arg = fn.strip(), arg.strip()
    if re.search(r"θ|theta|\bx\b", fn):
        return re.sub(r"θ|theta|\bx\b", f"({arg})", fn)
    return f"{fn} ({arg})"


def _verify_table(header: list[str], rows: list[list[str]]) -> dict:
    import sympy as sp

    transposed = len(header) > 1 and all(_ANGLE.search(h.strip() or "x") for h in header[1:] if h.strip())
    fixed_rows = [list(r) for r in rows]
    stats = {"verified": 0, "corrected": 0, "unverified": 0}
    for i, row in enumerate(rows):
        for j in range(1, len(row)):
            cell = row[j].strip()
            fn, arg = (row[0], header[j]) if transposed else (header[j] if j < len(header) else "", row[0])
            if not fn.strip() or not arg.strip():
                stats["unverified"] += 1
                continue
            expr = _cell_expr(fn, arg)
            try:
                val, undefined = _value(expr, sp)
            except Exception:
                val, undefined = None, False
            if undefined:
                if _UNDEF.match(cell):
                    stats["verified"] += 1
                else:
                    fixed_rows[i][j] = "not defined"
                    stats["corrected"] += 1
                continue
            if val is None:
                stats["unverified"] += 1
                continue
            try:
                same = _truth(f"{expr} = {cell}", sp) if cell and not _UNDEF.match(cell) else False
            except Exception:
                same = False
            if same:
                stats["verified"] += 1
            else:
                fixed_rows[i][j] = val
                stats["corrected"] += 1
    return {"rows": fixed_rows, **stats}


def _safe_batch(kind: str, payload: dict) -> dict:
    try:
        if kind == "lines":
            return {"results": _verify_lines(payload["lines"])}
        return _verify_table(payload["header"], payload["rows"])
    except Exception as e:
        return {"error": type(e).__name__}


def verify_content(kind: str, payload: dict, time_limit: float = 12.0) -> dict:
    fut = _get_pool().submit(_safe_batch, kind, payload)
    try:
        return fut.result(timeout=time_limit)
    except cf.TimeoutError:
        _reset_pool()
        return {"error": "timeout"}
    except cf.process.BrokenProcessPool:
        _reset_pool()
        return {"error": "broken"}


# ----------------------------------------------------------------- worker


def _work(text: str, mode: str, other: str | None) -> dict:
    import sympy as sp

    if mode == "compare":
        return _compare(text, other or "", sp)
    toks = tokenize(text)
    rels = [k for k, t in enumerate(toks) if t[0] == "rel"]
    if len(rels) > 1:
        raise SolveError("Write one equation or inequality at a time.")
    if rels and rels[0] == len(toks) - 1 and toks[-1][1] == "=":
        if mode == "solve":
            return {"status": "not_applicable", "message": "There is nothing to solve: the line ends with '='."}
        return _finish(toks[:-1], text, sp)
    if not rels:
        return _finish(toks, text, sp) if mode != "solve" else {"status": "not_applicable", "message": "There is no equation to solve."}
    if mode == "finish":
        return {"status": "not_applicable", "message": "Only lines that end with '=' are finished automatically."}
    return _solve(toks, rels[0], sp)


def _safe_work(text: str, mode: str, other: str | None) -> dict:
    try:
        return _work(text, mode, other)
    except SolveError as e:
        return {"status": "unsupported", "message": str(e)}
    except (RecursionError, MemoryError, OverflowError):
        return {"status": "unsupported", "message": "This is too large to work out."}
    except Exception as e:  # sympy internals: never crash the request
        return {"status": "unsupported", "message": f"NOVA can't work this out exactly ({type(e).__name__})."}


_pool: cf.Executor | None = None
_lock = threading.Lock()
# Serverless hosts (Vercel/Lambda) have no /dev/shm, so a process pool cannot start there: use threads.
_THREADS = os.environ.get("NOVA_MATHS_THREADS") == "1" or bool(os.environ.get("VERCEL"))


def _get_pool() -> cf.Executor:
    global _pool, _THREADS
    with _lock:
        if _pool is None:
            if not _THREADS:
                try:
                    _pool = cf.ProcessPoolExecutor(max_workers=1, mp_context=multiprocessing.get_context("spawn"))
                except (OSError, NotImplementedError, PermissionError):
                    _THREADS = True
            if _pool is None:
                _pool = cf.ThreadPoolExecutor(max_workers=4, thread_name_prefix="nova-maths")
        return _pool


def _reset_pool() -> None:
    global _pool
    with _lock:
        if _pool is not None:
            for proc in list(getattr(_pool, "_processes", {}).values()):
                proc.kill()
            _pool.shutdown(wait=False, cancel_futures=True)
        _pool = None


@dataclass
class SolveResult:
    status: str  # answered | not_applicable | unsupported | timeout | different | equivalent | solved
    answer: str | None = None
    kind: str | None = None
    message: str | None = None
    approx: str | None = None
    note: str | None = None


def run(text: str, mode: str = "auto", other: str | None = None, time_limit: float = TIME_LIMIT_S) -> SolveResult:
    """mode: finish (line ends with '='), solve (equation/inequality), auto (either), compare (text vs other)."""
    text = re.sub(r"\s+", " ", text or "").strip()
    try:
        tokenize(text)  # cheap validation in-process before paying for the worker
        if other is not None:
            tokenize(other)
    except SolveError as e:
        return SolveResult("unsupported", message=str(e))
    fut = _get_pool().submit(_safe_work, text, mode, other)
    try:
        r = fut.result(timeout=time_limit)
    except cf.TimeoutError:
        _reset_pool()  # kill the stuck worker so the next request starts clean
        return SolveResult("timeout", message="That took too long to work out exactly.")
    except cf.process.BrokenProcessPool:
        _reset_pool()
        return SolveResult("unsupported", message="NOVA can't work this out exactly.")
    return SolveResult(**r)


def solve_line(text: str, time_limit: float = TIME_LIMIT_S) -> SolveResult:
    text = re.sub(r"\s+", " ", text or "").strip()
    if not text.endswith("="):
        return SolveResult("not_applicable", message="Only lines that end with '=' are finished automatically.")
    return run(text, "finish", time_limit=time_limit)


def warm_up() -> None:
    """Start the worker and import SymPy ahead of the first student request."""
    try:
        run("1 + 1 =", "finish", time_limit=30)
    except Exception:
        pass
