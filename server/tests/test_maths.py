import pytest

from app.maths.linear import MathError, check_step, parse_equation, solution_set
from app.maths.arith import check_arith, looks_arithmetic
from app.maths.graph import graph


@pytest.mark.parametrize(
    "problem,current,expected",
    [
        ("2(x+3)=14", "2x+3=14", "different"),
        ("2(x+3)=14", "2x+6=14", "equivalent"),
        ("2(x+3)=14", "x+3=7", "equivalent"),
        ("2(x+3)=14", "x=4", "solved"),
        ("2(x+3)=14", "4=x", "solved"),
        ("3(x+2)=21", "x=4", "different"),
        ("3(x+2)=21", "x=5", "solved"),
        ("3(x+2)=21", "3x+6=21", "equivalent"),
        ("-2x+5=11", "-2x=6", "equivalent"),
        ("-2x+5=11", "x=-3", "solved"),
        ("-2x+5=11", "x=3", "different"),
        ("x/2+1=4", "x/2=3", "equivalent"),
        ("x/2+1=4", "x=6", "solved"),
        ("0.5x=2", "x=4", "solved"),
        ("0.5x=2", "x=1/4", "different"),
        ("3x+2=x+10", "2x=8", "equivalent"),
        ("3x+2=x+10", "x=4", "solved"),
        ("2(x+1)=2x+2", "2x+2=2x+2", "equivalent"),
        ("2(x+1)=2x+2", "0=0", "solved"),
        ("x+1=x+2", "1=2", "solved"),
        ("x+1=x+2", "x=1", "different"),
        ("2x−4=10", "2x=14", "equivalent"),
        ("6 ÷ 3 x = 4", "x=2", "solved"),
        ("2×(x−1)=8", "x=5", "solved"),
        ("1.2x = 3.6", "x=3", "solved"),
        ("(x+1)(2)=6", "x=2", "solved"),
        ("-(x-4)=1", "x=3", "solved"),
    ],
)
def test_check_classification(problem, current, expected):
    assert check_step(problem, current).status == expected


@pytest.mark.parametrize(
    "text",
    [
        "x^2=4",
        "x*x=4",
        "1/x=2",
        "sin(x)=0",
        "__import__('os')=1",
        "x==2",
        "x=2=3",
        "2x+",
        "(x+1=2",
        "x+1)=2",
        "y=2",
        "10001x=1",
        "x/0=1",
        "x2=4",
        "2 3x=1",
        "a" * 200,
        "((((((((((((((x))))))))))))))=1",
        "x;import os=1",
        "lambda: 1 = 2",
    ],
)
def test_hostile_or_unsupported_rejected(text):
    with pytest.raises(MathError):
        l, r = parse_equation(text)
        solution_set(l, r)


def test_unsupported_is_not_wrong():
    r = check_step("2(x+3)=14", "x^2=16")
    assert r.status == "unsupported"


def test_graph_linear_points():
    g = graph("y=2x+1")
    by_x = {p["x"]: p["y"] for p in g.points if p["kind"] == "check"}
    assert by_x == {-1.0: -1.0, 1.0: 3.0}
    assert g.normalized == "y = 2x + 1" and g.kind == "function"
    seg = g.series[0].segments[0]
    assert all(abs(p["y"] - (2 * p["x"] + 1)) < 1e-6 for p in seg)


@pytest.mark.parametrize(
    "expr,kind,labels",
    [
        ("y=x^2-4", "function", ["x = -2", "x = 2"]),
        ("2(x+3)=14", "equation", ["x = 4"]),
        ("3(x+2)=21", "equation", ["x = 5"]),
        ("3x+2y=6", "function", ["x = 2"]),
        ("y = x\u00b2", "function", ["x = 0"]),
    ],
)
def test_graph_kinds(expr, kind, labels):
    g = graph(expr)
    assert g.kind == kind
    got = [p["label"] for p in g.points if p["kind"] in ("root", "solution")]
    assert got == labels


def test_graph_discontinuity_split():
    g = graph("y=1/x")
    assert len(g.series[0].segments) == 2  # never joined across x = 0


def test_graph_identity_and_contradiction():
    assert "every x" in graph("2(x+1)=2x+2").note
    assert "never meet" in graph("x+1=x+2").note


def test_graph_implicit_circle():
    g = graph("x^2+y^2=25")
    assert g.kind == "implicit"
    for seg in g.series[0].segments[:50]:
        for p in seg:
            assert abs((p["x"] ** 2 + p["y"] ** 2) ** 0.5 - 5) < 0.2


@pytest.mark.parametrize("expr", ["2+3", "import os", "y=foo(x)", "x==2", "", "y=x^", "a" * 300, "__class__"])
def test_graph_rejects(expr):
    with pytest.raises(MathError):
        graph(expr)


@pytest.mark.parametrize(
    "text,status,value",
    [
        ("3 + 2 =", "incomplete", "5"),
        ("3+2=5", "correct", "5"),
        ("3+2=6", "incorrect", "5"),
        ("2 x 3 =", "incomplete", "6"),
        ("2^3 = 8", "correct", "8"),
        ("12 / 4 =", "incomplete", "3"),
        ("1/2 + 1/4 =", "incomplete", "0.75"),
        ("1/3 =", "incomplete", "1/3"),
        ("7 - 10 =", "incomplete", "-3"),
        ("5/0 =", "unsupported", None),
    ],
)
def test_arithmetic(text, status, value):
    assert looks_arithmetic(text)
    r = check_arith(text)
    assert r.status == status and r.value == value


@pytest.mark.parametrize("text", ["2x+3=14", "y=2x+1", "x=4", "3x = 6"])
def test_not_arithmetic(text):
    assert not looks_arithmetic(text)
