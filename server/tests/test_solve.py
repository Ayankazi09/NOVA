import uuid

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.maths.solve import run, solve_line

client = TestClient(app)


@pytest.mark.parametrize(
    "text,answer",
    [
        ("3 + 2 =", "5"),
        ("1/2 + 1/4 =", "3/4"),
        ("0.1 + 0.2 =", "0.3"),
        ("sin 30° =", "1/2"),
        ("sin 30 =", "1/2"),
        ("cos 60° =", "1/2"),
        ("tan 60 =", "√3"),
        ("sin 45° =", "√2/2"),
        ("sin²θ + cos²θ =", "1"),
        ("sec²θ - tan²θ =", "1"),
        ("2 sin θ cos θ =", "sin 2θ"),
        ("sin θ / cos θ =", "tan θ"),
        ("1 - cos²θ =", "sin²θ"),
        ("(a + b)^2 =", "a² + 2ab + b²"),
        ("(a - b)^2 =", "a² - 2ab + b²"),
        ("(x + 2)(x + 3) =", "x² + 5x + 6"),
        ("x^2 - 5x + 6 =", "(x - 2)(x - 3)"),
        ("d/dx (x^3 + 2x) =", "3x² + 2"),
        ("d/dx sin x =", "cos x"),
        ("∫ 2x dx =", "x² + C"),
        ("∫ cos θ dθ =", "sin θ + C"),
        ("∫_0^1 x^2 dx =", "1/3"),
        ("lim x→0 sin x / x =", "1"),
        ("5! =", "120"),
        ("gcd(12, 18) =", "6"),
        ("lcm(4, 6) =", "12"),
        ("20% of 50 =", "10"),
        ("log_2 8 =", "3"),
        ("log 1000 =", "3"),
        ("5C2 =", "10"),
        ("|3 - 7| =", "4"),
        ("sin^-1 (1/2) =", "30°"),
        ("√2 × √8 =", "4"),
    ],
)
def test_finish(text, answer):
    r = solve_line(text, time_limit=30)
    assert r.status == "answered", r.message
    assert r.answer == answer


@pytest.mark.parametrize(
    "text,answer",
    [
        ("x^2 - 5x + 6 = 0", "x = 2 or x = 3"),
        ("2x + 3 > 7", "x > 2"),
        ("x^2 < 4", "-2 < x < 2"),
        ("2 sin θ = 1", "θ = 30° or θ = 150°"),
        ("x^2 + 1 = 0", "no real solution"),
        ("2(x+1) = 2x + 2", "true for every x"),
        ("3x + 2y = 6", "y = -3x/2 + 3"),
        ("x^3 = 8", "x = 2"),
    ],
)
def test_solve(text, answer):
    r = run(text, "solve", time_limit=30)
    assert r.status == "answered", r.message
    assert r.answer == answer


@pytest.mark.parametrize(
    "a,b,status",
    [
        ("x^2 - 5x + 6 = 0", "(x-2)(x-3) = 0", "equivalent"),
        ("x^2 - 5x + 6 = 0", "x = 2", "different"),
        ("x^2 = 9", "x = 3", "different"),
        ("2(x+3)=14", "x = 4", "solved"),
    ],
)
def test_compare(a, b, status):
    assert run(a, "compare", b, time_limit=30).status == status


@pytest.mark.parametrize("text", ["5/0 =", "tan 90 =", "1 + =", "9^9^9^9 =", "import os =", "x = 2 = 3", "a" * 250])
def test_rejects_safely(text):
    r = run(text, "auto", time_limit=30)
    assert r.status in ("unsupported", "not_applicable")


@pytest.mark.parametrize("text", ["x + 1 =", "π ="])
def test_nothing_to_finish(text):
    assert solve_line(text, time_limit=30).status == "not_applicable"


def test_solve_endpoint():
    ctx = dict(requestId=str(uuid.uuid4()), pageId="p", contentRevision=1, regionId="r", sourceHash="h", selectionRevision=0, interpretationRevision=0)
    body = client.post("/api/v1/solve", json={"context": ctx, "text": "sin 30° =", "mode": "finish"}).json()
    assert body["answer"] == "1/2" and body["completed"] == "sin 30° = 1/2" and body["context"] == ctx
