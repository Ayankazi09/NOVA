import uuid

import pytest
from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def call(text, problem=None, auto_answer=True):
    ctx = dict(requestId=str(uuid.uuid4()), pageId="p", contentRevision=1, regionId="r", sourceHash="h", selectionRevision=0, interpretationRevision=0)
    r = client.post("/api/v1/auto", json={"context": ctx, "text": text, "problem": problem, "autoAnswer": auto_answer})
    assert r.status_code == 200, r.text
    return r.json()


@pytest.mark.parametrize(
    "text,problem,kind,verdict,answer",
    [
        ("4 + 2 =", None, "answer", "none", "6"),
        ("sin 30° =", None, "answer", "none", "1/2"),
        ("4 + 2 = 6", None, "mark", "correct", None),
        ("4 + 2 = 7", None, "mark", "incorrect", None),
        ("sin 30 = 1/2", None, "mark", "correct", None),
        ("sin 30 = 1", None, "mark", "incorrect", None),
        ("sin²θ + cos²θ = 1", None, "mark", "correct", None),
        ("2x + 3 = 14", "2(x + 3) = 14", "mark", "different", None),
        ("2x + 6 = 14", "2(x + 3) = 14", "mark", "equivalent", None),
        ("x = 4", "2(x + 3) = 14", "mark", "solved", None),
        ("(x-2)(x-3) = 0", "x^2 - 5x + 6 = 0", "mark", "equivalent", None),
        ("2x + 3 = 14", None, "solution", "none", None),
        ("3 + 2", None, "none", "none", None),
    ],
)
def test_auto(text, problem, kind, verdict, answer):
    body = call(text, problem)
    assert body["kind"] == kind and body["verdict"] == verdict
    if answer:
        assert body["answer"] == answer


def test_auto_answer_off_still_marks():
    assert call("4 + 2 =", auto_answer=False)["kind"] == "none"
    assert call("4 + 2 = 7", auto_answer=False)["verdict"] == "incorrect"


@pytest.mark.parametrize(
    "text,steps",
    [
        ("x + 3 = 4", ["x = 4 - 3", "x = 1"]),
        ("2x + 3 = 11", ["2x = 11 - 3", "2x = 8", "x = 8/2", "x = 4"]),
        ("2(x + 3) = 14", ["2x + 6 = 14", "2x = 14 - 6", "2x = 8", "x = 8/2", "x = 4"]),
        ("x^2 - 5x + 6 = 0", ["(x - 2)(x - 3) = 0", "x = 2 or x = 3"]),
    ],
)
def test_auto_writes_worked_solution(text, steps):
    body = call(text)
    assert body["kind"] == "solution" and body["steps"] == steps


def test_auto_graph_equation_suggests_graph():
    body = call("y = 4x")
    assert body["kind"] == "none" and body["suggest"] == "graph"
