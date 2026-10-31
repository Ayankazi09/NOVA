import base64
import io
import json
import uuid

from fastapi.testclient import TestClient
from PIL import Image

from app import services
from app.main import app
from app.providers.bharatcode import ModelReply

client = TestClient(app)


def png():
    buf = io.BytesIO()
    Image.new("RGB", (400, 500), "white").save(buf, "PNG")
    return base64.b64encode(buf.getvalue()).decode()


class Fake:
    def __init__(self, text):
        self.text = text

    async def generate(self, *a, **k):
        return ModelReply(text=self.text, latency_ms=3, incomplete=False)


def test_analyze_verifies_and_corrects_answer_key(monkeypatch):
    qs = {"questions": [
        {"number": "1", "text": "Solve 2x + 3 = 11", "lineIds": ["l1", "zz"], "bbox": [50, 40, 950, 120], "kind": "equation", "answer": "x = 4", "check": "2x + 3 = 11"},
        {"number": "2", "text": "Find sin 30°", "lineIds": [], "bbox": [50, 140, 950, 200], "kind": "numeric", "answer": "1", "check": "sin 30° ="},
        {"number": "3", "text": "Prove that √2 is irrational", "kind": "proof", "answer": "√2 cannot be written as p/q", "check": ""},
    ]}
    monkeypatch.setattr(services, "provider", Fake(json.dumps(qs)))
    r = client.post("/api/v1/paper/analyze", json={"requestId": str(uuid.uuid4()), "pageIndex": 0, "png": png(), "lines": [{"id": "l1", "text": "1. Solve 2x + 3 = 11"}]})
    assert r.status_code == 200, r.text
    q = r.json()["questions"]
    assert q[0]["answerVerified"] and not q[0]["corrected"] and q[0]["lineIds"] == ["l1"]
    assert q[1]["answer"] == "1/2" and q[1]["corrected"]  # wrong model key fixed by the exact engine
    assert not q[2]["answerVerified"]


def test_grade():
    items = [
        {"id": "a", "answer": "x = 4", "student": "x = 4"},
        {"id": "b", "answer": "x = 4", "student": "4"},
        {"id": "c", "answer": "1/2", "student": "0.5"},
        {"id": "d", "answer": "x = 2 or x = 3", "student": "x = 3, x = 2"},
        {"id": "e", "answer": "x = 4", "student": "x = 5"},
        {"id": "f", "answer": "(b)", "kind": "mcq", "student": "b"},
        {"id": "g", "answer": "(b)", "kind": "mcq", "student": "(c)"},
        {"id": "h", "answer": "12", "student": ""},
        {"id": "i", "answer": "x = 4", "student": "2x = 8\nx = 4"},
        {"id": "j", "answer": "√3/2", "student": "√3/2"},
    ]
    out = {g["id"]: g["verdict"] for g in client.post("/api/v1/paper/grade", json={"items": items}).json()}
    assert out == {"a": "correct", "b": "correct", "c": "correct", "d": "correct", "e": "incorrect", "f": "correct", "g": "incorrect", "h": "unanswered", "i": "correct", "j": "correct"}
