"""Teaching-first tutor: grounded prompts, the student's own step is never done for them, explicit requests are honoured."""
import uuid

from fastapi.testclient import TestClient

from app import services
from app.main import app
from app.maths.linear import MathError, parse_equation
from app.providers.bharatcode import ModelReply
from app.schemas.models import TutorRequest

client = TestClient(app)


def body(question="", problem="2(x + 3) = 14", current=None, accepted=True, intent="ask", history=(), exam=None):
    return {
        "context": {"requestId": str(uuid.uuid4()), "pageId": "p", "contentRevision": 1, "regionId": "rC" if current else "rP", "sourceHash": "h", "selectionRevision": 0, "interpretationRevision": 1},
        "intent": intent, "question": question,
        "problem": {"regionId": "rP", "text": problem, "accepted": True},
        "current": {"regionId": "rC", "text": current, "accepted": accepted} if current else None,
        "history": [{"role": r, "text": t} for r, t in history], "plotExpression": None, "exam": exam,
        "regionIds": ["rP", "rC"] if current else ["rP"], "pageLines": [],
    }


class Fake:
    def __init__(self, text):
        self.text, self.prompts = text, []

    async def generate(self, instructions, text, *a, **k):
        self.prompts.append(text)
        return ModelReply(text=self.text, latency_ms=5, incomplete=False)


def test_structured_reply_is_short_with_detail_on_request(monkeypatch):
    fake = Fake('{"say":"The 2 multiplies both terms in the bracket.","next":"What is 2 × 3?","detail":"2(x + 3) is two groups of (x + 3).","actions":[]}')
    monkeypatch.setattr(services, "provider", fake)
    j = client.post("/api/v1/tutor", json=body("help", current="2x + 3 = 14")).json()
    assert j["explanation"] == "The 2 multiplies both terms in the bracket. What is 2 × 3?"
    assert j["detail"] == "2(x + 3) is two groups of (x + 3)."


def test_students_next_step_is_not_written_for_them(monkeypatch):
    fake = Fake('{"say":"Expand the bracket.","next":"Try it.","actions":['
                '{"type":"write_equation","anchorRegionId":"rP","expression":"2x + 6 = 14","purpose":"hint"},'
                '{"type":"write_lines","anchorRegionId":"page","title":"t","lines":[{"text":"2x + 6 = 14","ink":"blue"},{"text":"2 multiplies each term","ink":"red"}]}]}')
    monkeypatch.setattr(services, "provider", fake)
    j = client.post("/api/v1/tutor", json=body("how do I start?")).json()
    assert not [a for a in j["actions"] if a["type"] == "write_equation"]
    lines = [a for a in j["actions"] if a["type"] == "write_lines"][0]["lines"]
    assert lines == ["2 multiplies each term"]


def test_full_solution_when_explicitly_asked(monkeypatch):
    fake = Fake('{"say":"Here it is.","next":"","actions":[{"type":"write_lines","anchorRegionId":"page","title":"t","lines":["2x + 6 = 14","2x = 8","x = 4"]}]}')
    monkeypatch.setattr(services, "provider", fake)
    j = client.post("/api/v1/tutor", json=body("show me the full solution")).json()
    assert [a for a in j["actions"] if a["type"] == "write_lines"][0]["lines"] == ["2x + 6 = 14", "2x = 8", "x = 4"]
    assert "FULL SOLUTION REQUESTED" in fake.prompts[0]


def test_unrevealed_exam_never_counts_as_full_solution():
    r = TutorRequest.model_validate(body("show me the full solution", exam={"number": "1", "text": "Solve 2(x + 3) = 14", "answer": "x = 4", "reveal": False}))
    assert not services.wants_full_solution(r)


def test_unconfirmed_reading_is_confirmed_before_judging(monkeypatch):
    fake = Fake('{"say":"Did you write 2x + 8 or 2x + 6?","next":"","actions":[]}')
    monkeypatch.setattr(services, "provider", fake)
    client.post("/api/v1/tutor", json=body("is this right?", current="2x + 8 = 14", accepted=False))
    assert "READING UNCONFIRMED" in fake.prompts[0]


def test_repeated_hints_ask_for_a_new_approach(monkeypatch):
    fake = Fake('{"say":"Picture two groups.","next":"","actions":[]}')
    monkeypatch.setattr(services, "provider", fake)
    hist = [("student", "help"), ("tutor", "The 2 multiplies both terms."), ("student", "what?"), ("tutor", "2 × (x + 3) means 2x and 2 × 3.")]
    client.post("/api/v1/tutor", json=body("I still don't get it", current="2x + 3 = 14", history=hist))
    assert "change the approach" in fake.prompts[0]


def test_superscript_square_is_a_clean_error_not_a_crash():
    try:
        parse_equation("x² - 5x + 6 = 0")
    except MathError:
        pass  # handled: the exact engine then compares solution sets instead
