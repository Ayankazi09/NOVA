import json
import uuid

from fastapi.testclient import TestClient

from app import services
from app.main import app
from app.providers.bharatcode import ModelReply

client = TestClient(app)


class Fake:
    def __init__(self, text):
        self.text = text
        self.calls = []

    async def generate(self, instructions, text, images=None, **kw):
        self.calls.append(text)
        return ModelReply(text=self.text, latency_ms=3, incomplete=False)


def test_practice_verifies_and_corrects_answers(monkeypatch):
    reply = {
        "topic": "Linear equations",
        "questions": [
            {"text": "Solve 3x + 5 = 20", "kind": "equation", "options": [], "answer": "x = 5", "check": "3x + 5 = 20"},
            {"text": "Solve 2x - 4 = 10", "kind": "equation", "options": [], "answer": "x = 6", "check": "2x - 4 = 10"},
            {"text": "", "kind": "equation", "answer": "x = 1"},
        ],
    }
    fake = Fake(json.dumps(reply))
    monkeypatch.setattr(services, "provider", fake)
    r = client.post("/api/v1/practice", json={"requestId": str(uuid.uuid4()), "example": "3x + 2 = 11", "count": 3})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["topic"] == "Linear equations"
    qs = body["questions"]
    assert [q["number"] for q in qs] == ["1", "2"]
    assert qs[0]["answerVerified"] and not qs[0]["corrected"]
    # the model's key was wrong (x = 7): the exact engine wins
    assert qs[1]["answerVerified"] and qs[1]["corrected"] and "7" in qs[1]["answer"]
    assert "check" not in qs[0]
    assert "3x + 2 = 11" in fake.calls[0]


def test_practice_needs_topic_or_example():
    r = client.post("/api/v1/practice", json={"requestId": str(uuid.uuid4()), "count": 5})
    assert r.status_code == 422
