"""Contract and failure tests with a mocked provider. These are NOT live recognition evidence."""

import base64
import io
import json
import uuid

import pytest
from fastapi.testclient import TestClient
from PIL import Image

from app import services
from app.errors import ApiError
from app.idempotency import cache
from app.main import app
from app.maths.steps import next_step
from app.providers import bharatcode
from app.providers.bharatcode import ModelReply, parse_json_object

client = TestClient(app)


def png(w=200, h=60) -> str:
    buf = io.BytesIO()
    Image.new("RGB", (w, h), "white").save(buf, "PNG")
    return base64.b64encode(buf.getvalue()).decode()


def ctx(**kw):
    c = dict(requestId=str(uuid.uuid4()), pageId="p1", contentRevision=3, regionId="r1", sourceHash="abc", selectionRevision=1, interpretationRevision=0)
    c.update(kw)
    return c


@pytest.fixture(autouse=True)
def _reset():
    cache.clear()
    yield


class FakeProvider:
    def __init__(self, text=None, exc=None, incomplete=False):
        self.text, self.exc, self.incomplete, self.calls = text, exc, incomplete, 0

    async def generate(self, *a, **k):
        self.calls += 1
        if self.exc:
            raise self.exc
        return ModelReply(text=self.text, latency_ms=5, incomplete=self.incomplete)


def use(monkeypatch, fake):
    monkeypatch.setattr(services, "provider", fake)
    return fake


# ---------------------------------------------------------------- recognize


def test_recognize_literal_and_echo(monkeypatch):
    use(monkeypatch, FakeProvider('```json\n{"status":"expression","rawText":"2x + 3 = 14","alternatives":["2x + 3 = 14","2x+8=14"],"needsClarification":false}\n```'))
    c = ctx()
    r = client.post("/api/v1/recognize", json={"context": c, "regionPng": png(), "regionWidth": 300, "regionHeight": 80})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["rawText"] == "2x + 3 = 14"
    assert body["alternatives"] == ["2x+8=14"]
    assert body["context"] == c


def test_recognize_rejects_non_png(monkeypatch):
    use(monkeypatch, FakeProvider("{}"))
    r = client.post("/api/v1/recognize", json={"context": ctx(), "regionPng": base64.b64encode(b"GIF89a....").decode(), "regionWidth": 1, "regionHeight": 1})
    assert r.status_code == 422 and r.json()["error"]["code"] == "INVALID_INPUT"


def test_recognize_rejects_oversize_png(monkeypatch):
    use(monkeypatch, FakeProvider("{}"))
    r = client.post("/api/v1/recognize", json={"context": ctx(), "regionPng": png(1700, 20), "regionWidth": 1, "regionHeight": 1})
    assert r.status_code == 422


@pytest.mark.parametrize(
    "exc,code,status",
    [
        (ApiError("TIMEOUT", "t"), "TIMEOUT", 504),
        (ApiError("QUOTA_LIMIT", "q"), "QUOTA_LIMIT", 429),
        (ApiError("MODEL_BUSY", "b"), "MODEL_BUSY", 503),
        (ApiError("AUTH_REQUIRED", "a", retryable=False), "AUTH_REQUIRED", 401),
    ],
)
def test_provider_failures_map_to_envelope(monkeypatch, exc, code, status):
    use(monkeypatch, FakeProvider(exc=exc))
    c = ctx()
    r = client.post("/api/v1/recognize", json={"context": c, "regionPng": png(), "regionWidth": 1, "regionHeight": 1})
    assert r.status_code == status
    err = r.json()["error"]
    assert err["code"] == code and set(err) == {"code", "message", "retryable", "requestId"}


def test_malformed_and_incomplete_output(monkeypatch):
    use(monkeypatch, FakeProvider("I think it says 2x+3"))
    r = client.post("/api/v1/recognize", json={"context": ctx(), "regionPng": png(), "regionWidth": 1, "regionHeight": 1})
    assert r.json()["error"]["code"] == "INVALID_MODEL_OUTPUT"
    use(monkeypatch, FakeProvider('{"status":"expression","rawText":"2x"}', incomplete=True))
    r = client.post("/api/v1/recognize", json={"context": ctx(), "regionPng": png(), "regionWidth": 1, "regionHeight": 1})
    assert r.json()["error"]["code"] == "INVALID_MODEL_OUTPUT"


def test_missing_key(monkeypatch):
    monkeypatch.setattr(bharatcode.settings.__class__, "key_configured", property(lambda s: False))
    r = client.post("/api/v1/recognize", json={"context": ctx(), "regionPng": png(), "regionWidth": 1, "regionHeight": 1})
    assert r.status_code == 401 and r.json()["error"]["code"] == "AUTH_REQUIRED"


def test_idempotency_join_and_conflict(monkeypatch):
    fake = use(monkeypatch, FakeProvider('{"status":"expression","rawText":"x = 4"}'))
    c = ctx()
    payload = {"context": c, "regionPng": png(), "regionWidth": 10, "regionHeight": 10}
    a = client.post("/api/v1/recognize", json=payload)
    calls = fake.calls
    b = client.post("/api/v1/recognize", json=payload)
    assert a.json() == b.json() and fake.calls == calls  # second request reused the first result
    payload2 = dict(payload, regionWidth=11)
    r = client.post("/api/v1/recognize", json=payload2)
    assert r.status_code == 409


def test_extra_fields_rejected():
    r = client.post("/api/v1/check", json={"context": ctx(), "problem": "x=1", "current": "x=1", "confirmed": True, "evil": 1})
    assert r.status_code == 422


# -------------------------------------------------------------------- check


def test_check_requires_confirmation():
    r = client.post("/api/v1/check", json={"context": ctx(), "problem": "2(x+3)=14", "current": "2x+3=14", "confirmed": False})
    assert r.json()["status"] == "needs_clarification"


def test_check_endpoint():
    c = ctx()
    r = client.post("/api/v1/check", json={"context": c, "problem": "2(x+3)=14", "current": "2x+3=14", "confirmed": True})
    assert r.json()["status"] == "different" and r.json()["context"] == c


def test_plot_endpoint():
    r = client.post("/api/v1/plot", json={"context": ctx(), "expression": "y = 2x + 1"})
    assert r.status_code == 200
    pts = {p["x"]: p["y"] for p in r.json()["plot"]["checkPoints"]}
    assert pts[-1.0] == -1 and pts[1.0] == 3
    r = client.post("/api/v1/plot", json={"context": ctx(), "expression": "y = x^2"})
    assert r.status_code == 200 and r.json()["plot"]["kind"] == "function"
    r = client.post("/api/v1/plot", json={"context": ctx(), "expression": "3 + 2"})
    assert r.status_code == 422 and r.json()["error"]["code"] == "UNSUPPORTED"


# -------------------------------------------------------------------- tutor


def tutor_body(intent="hint", **kw):
    b = {
        "context": ctx(regionId="r2"),
        "intent": intent,
        "question": "Why is it wrong?",
        "problem": {"regionId": "r1", "text": "2(x+3)=14", "accepted": True},
        "current": {"regionId": "r2", "text": "2x+3=14", "accepted": True},
        "regionIds": ["r1", "r2"],
    }
    b.update(kw)
    return b


def test_tutor_validates_and_filters_actions(monkeypatch):
    reply = {
        "explanation": "The 2 multiplies both terms in the bracket, so x = 4 comes later.",
        "actions": [
            {"type": "highlight_region", "anchorRegionId": "r2", "reason": "check the 3"},
            {"type": "draw_groups", "anchorRegionId": "r2", "groups": ["x + 3", "x + 3"], "caption": "two groups"},
            {"type": "run_shell", "cmd": "rm -rf /"},
            {"type": "write_equation", "anchorRegionId": "r2", "expression": "x = 4", "purpose": "completion"},
            {"type": "add_note", "anchorRegionId": "zzz", "text": "<script>x</script>"},
        ],
    }
    use(monkeypatch, FakeProvider(json.dumps(reply)))
    r = client.post("/api/v1/tutor", json=tutor_body())
    assert r.status_code == 200, r.text
    body = r.json()
    types = [a["type"] for a in body["actions"]]
    assert types == ["highlight_region", "draw_groups", "add_note"]
    assert body["actions"][2]["anchorRegionId"] == "r2"  # unknown anchor remapped to selection
    assert "<" not in body["actions"][2]["text"]
    assert "x = 4" not in body["explanation"]  # final answer not revealed in a hint
    assert body["check"]["status"] == "different"
    ids = [a["id"] for a in body["actions"]]
    assert len(set(ids)) == len(ids)


def test_tutor_check_works_without_model(monkeypatch):
    use(monkeypatch, FakeProvider(exc=ApiError("MODEL_BUSY", "busy")))
    r = client.post("/api/v1/tutor", json=tutor_body("check"))
    assert r.status_code == 200
    body = r.json()
    assert body["check"]["status"] == "different"
    assert body["actions"][0]["type"] == "highlight_region"


def test_tutor_check_requires_acceptance(monkeypatch):
    use(monkeypatch, FakeProvider("{}"))
    b = tutor_body("check")
    b["current"]["accepted"] = False
    r = client.post("/api/v1/tutor", json=b)
    assert r.status_code == 422 and r.json()["error"]["code"] == "AMBIGUOUS"


def test_complete_refuses_to_continue_wrong_step(monkeypatch):
    use(monkeypatch, FakeProvider(json.dumps({"explanation": "Look at the bracket.", "actions": [{"type": "write_equation", "expression": "2x=11", "purpose": "completion"}]})))
    r = client.post("/api/v1/tutor", json=tutor_body("complete"))
    body = r.json()
    assert all(a["type"] != "write_equation" or a["purpose"] != "completion" for a in body["actions"])


def test_complete_validates_model_step(monkeypatch):
    b = tutor_body("complete", current={"regionId": "r2", "text": "2x+6=14", "accepted": True})
    use(monkeypatch, FakeProvider(json.dumps({"explanation": "Subtract 6.", "actions": [{"type": "write_equation", "expression": "2x = 9", "purpose": "completion"}]})))
    body = client.post("/api/v1/tutor", json=b).json()
    eq = body["actions"][0]
    assert eq["purpose"] == "completion" and eq["verified"] and eq["expression"] == "2x = 8"  # bad model step replaced by deterministic step


def test_complete_uses_valid_model_step(monkeypatch):
    b = tutor_body("complete", current={"regionId": "r2", "text": "2x+6=14", "accepted": True})
    use(monkeypatch, FakeProvider(json.dumps({"explanation": "Subtract 6 from both sides.", "actions": [{"type": "write_equation", "expression": "2x = 14 - 6", "purpose": "completion"}]})))
    body = client.post("/api/v1/tutor", json=b).json()
    assert body["actions"][0]["expression"] == "2x = 14 - 6"


def test_plot_intent_deterministic(monkeypatch):
    fake = use(monkeypatch, FakeProvider("{}"))
    b = tutor_body("plot", plotExpression="y=2x+1")
    body = client.post("/api/v1/tutor", json=b).json()
    assert body["actions"][0]["type"] == "plot_function" and fake.calls == 0


def test_history_bounds():
    b = tutor_body(history=[{"role": "student", "text": "hi"}] * 7)
    assert client.post("/api/v1/tutor", json=b).status_code == 422
    b = tutor_body(question="q" * 1201)
    assert client.post("/api/v1/tutor", json=b).status_code == 422


def test_capabilities_no_secrets():
    body = client.get("/api/v1/capabilities").json()
    assert "keyConfigured" in body["provider"] and "visionSmokeTested" in body["provider"]
    assert "apiKey" not in json.dumps(body) and "bc_live" not in json.dumps(body)


def test_transcribe_unavailable_or_validates():
    r = client.post("/api/v1/transcribe", data={"requestId": str(uuid.uuid4())}, files={"audio": ("a.txt", b"hello", "text/plain")})
    assert r.status_code in (501, 422)


# ---------------------------------------------------------------- helpers


def test_parse_json_object_variants():
    assert parse_json_object('<think>hmm {"a":1}</think> sure: {"a": 2} trailing')["a"] == 2
    with pytest.raises(ValueError):
        parse_json_object("no json here")


@pytest.mark.parametrize(
    "cur,expected",
    [("2(x+3)=14", "2x + 6 = 14"), ("2x+6=14", "2x = 8"), ("2x=8", "x = 4"), ("3x+2=x+10", "2x + 2 = 10"), ("x=4", None)],
)
def test_next_step(cur, expected):
    assert next_step(cur) == expected


def test_recognize_disagreement_becomes_clarification(monkeypatch):
    replies = iter(['{"status":"expression","rawText":"2x + 3 = 14"}', '{"status":"expression","rawText":"2x + 8 = 14"}'])

    class Two(FakeProvider):
        async def generate(self, *a, **k):
            self.calls += 1
            return ModelReply(text=next(replies), latency_ms=5, incomplete=False)

    use(monkeypatch, Two())
    body = client.post("/api/v1/recognize", json={"context": ctx(), "regionPng": png(), "regionWidth": 1, "regionHeight": 1}).json()
    assert body["rawText"] == "2x + 3 = 14" and body["needsClarification"] and body["alternatives"] == ["2x + 8 = 14"]


def test_recognize_backslash_escape(monkeypatch):
    use(monkeypatch, FakeProvider('{"status": "expression", "rawText": "2 \\\\times 3 =", "alternatives": []}'))
    r = client.post("/api/v1/recognize", json={"context": ctx(), "regionPng": png(), "regionWidth": 1, "regionHeight": 1})
    assert r.status_code == 200, r.text
    assert r.json()["rawText"] == "2 * 3 =" and r.json()["status"] == "incomplete"


def test_tutor_arithmetic_complete(monkeypatch):
    fake = use(monkeypatch, FakeProvider("{}"))
    b = {"context": ctx(regionId="r1"), "intent": "complete", "problem": {"regionId": "r1", "text": "3 + 2 =", "accepted": True}, "regionIds": ["r1"]}
    body = client.post("/api/v1/tutor", json=b).json()
    assert body["actions"][0]["expression"] == "3 + 2 = 5" and body["actions"][0]["verified"] and fake.calls == 0


def test_tutor_arithmetic_hint_hides_value(monkeypatch):
    use(monkeypatch, FakeProvider(json.dumps({"explanation": "Count on from 3: 4, 5. So 3 + 2 = 5.", "actions": [{"type": "write_equation", "expression": "3 + 2 = 5", "purpose": "hint"}]})))
    b = {"context": ctx(regionId="r1"), "intent": "hint", "problem": {"regionId": "r1", "text": "3 + 2 =", "accepted": False}, "regionIds": ["r1"]}
    body = client.post("/api/v1/tutor", json=b).json()
    assert "= 5" not in body["explanation"] and body["actions"] == []


def test_tutor_arithmetic_check_incorrect(monkeypatch):
    use(monkeypatch, FakeProvider(exc=ApiError("MODEL_BUSY", "busy")))
    b = {"context": ctx(regionId="r1"), "intent": "check", "problem": {"regionId": "r1", "text": "3 + 2 = 6", "accepted": True}, "regionIds": ["r1"]}
    body = client.post("/api/v1/tutor", json=b).json()
    assert body["check"]["status"] == "incorrect" and body["actions"][-1]["type"] == "highlight_region"


def test_tutor_plot_any_equation(monkeypatch):
    use(monkeypatch, FakeProvider("{}"))
    for expr in ["y = x^2 - 4", "2x + 3 = 14", "x^2 + y^2 = 9"]:
        b = {"context": ctx(regionId="r1"), "intent": "plot", "current": {"regionId": "r1", "text": expr, "accepted": False}, "regionIds": ["r1"]}
        r = client.post("/api/v1/tutor", json=b)
        assert r.status_code == 200, (expr, r.text)
        assert r.json()["actions"][0]["type"] == "plot_function"


def test_tutor_check_on_graph_equation_plots(monkeypatch):
    use(monkeypatch, FakeProvider("{}"))
    b = {"context": ctx(regionId="r1"), "intent": "check", "current": {"regionId": "r1", "text": "y = 2x + 1", "accepted": True}, "regionIds": ["r1"]}
    body = client.post("/api/v1/tutor", json=b).json()
    assert body["actions"][0]["type"] == "plot_function"


def test_questions_listed_only_in_chat_are_written_on_the_page(monkeypatch):
    """Asked to write practice questions, the model sometimes lists them in the chat and sends no action."""
    reply = {
        "explanation": "Here are 3 practice questions on linear equations:\n\n1. Solve: 3x + 7 = 22\n\n2. Solve: 5(x - 2) = 2x + 4\n\n"
        "3. A taxi charges a flat fee of 50 rupees plus 15 rupees per kilometre. If the total fare was 200 rupees, how far did the passenger travel?",
        "actions": [],
    }
    use(monkeypatch, FakeProvider(json.dumps(reply)))
    body = {"context": ctx(regionId="page"), "intent": "ask", "question": "give me 3 questions to practise on linear equations", "regionIds": []}
    r = client.post("/api/v1/tutor", json=body)
    assert r.status_code == 200, r.text
    out = r.json()
    written = [a for a in out["actions"] if a["type"] == "write_lines"]
    assert len(written) == 1 and written[0]["anchorRegionId"] == "page"
    lines = written[0]["lines"]
    assert lines[0].startswith("1. Solve: 3x + 7 = 22") and any(l.startswith("3. A taxi") for l in lines)
    assert all(len(l) <= 80 for l in lines) and len(lines) >= 4  # the long question wraps
    assert "written them on your page" in out["explanation"]


def test_ordinary_answers_are_not_written_on_the_page(monkeypatch):
    reply = {"explanation": "Two ideas:\n1. Expand the bracket first.\n2. Then collect the x terms.", "actions": []}
    use(monkeypatch, FakeProvider(json.dumps(reply)))
    r = client.post("/api/v1/tutor", json=tutor_body())  # "Why is it wrong?"
    assert r.status_code == 200, r.text
    assert not [a for a in r.json()["actions"] if a["type"] == "write_lines"]


def test_draw_figure_is_validated_and_kept(monkeypatch):
    reply = {
        "explanation": "Here is square ABCD.",
        "actions": [{
            "type": "draw_figure", "anchorRegionId": "page", "title": "Square ABCD",
            "points": {"A": [0, 0], "B": [4, 0], "C": [4, 4], "D": [0, 4], "bad": ["x", 1]},
            "segments": [["A", "B"], ["B", "C"], ["C", "D"], ["D", "A"], ["A", "Z"], ["B", "A"]],
            "dashed": [["A", "C"]],
            "sideLabels": [{"between": ["A", "B"], "text": "4 cm"}, {"between": ["A", "Q"], "text": "?"}],
            "rightAngles": ["A", "B", "C", "D", "Q"], "angleLabels": [{"at": "A", "text": "90°"}],
            "notes": ["AB = BC = CD = DA"],
        }],
    }
    use(monkeypatch, FakeProvider(json.dumps(reply)))
    body = {"context": ctx(regionId="page"), "intent": "ask", "question": "draw a square ABCD", "regionIds": []}
    r = client.post("/api/v1/tutor", json=body)
    assert r.status_code == 200, r.text
    fig = [a for a in r.json()["actions"] if a["type"] == "draw_figure"]
    assert len(fig) == 1
    f = fig[0]
    assert set(f["points"]) == {"A", "B", "C", "D"} and f["anchorRegionId"] == "page"
    assert f["segments"] == [["A", "B"], ["B", "C"], ["C", "D"], ["D", "A"]]  # unknown point and duplicate dropped
    assert f["dashed"] == [["A", "C"]] and f["rightAngles"] == ["A", "B", "C", "D"]
    assert f["sideLabels"] == [{"between": ["A", "B"], "text": "4 cm"}]


def test_draw_figure_with_nothing_to_draw_is_dropped(monkeypatch):
    reply = {"explanation": "A point.", "actions": [{"type": "draw_figure", "anchorRegionId": "page", "points": {"A": [0, 0]}, "segments": []}]}
    use(monkeypatch, FakeProvider(json.dumps(reply)))
    body = {"context": ctx(regionId="page"), "intent": "ask", "question": "draw a point", "regionIds": []}
    r = client.post("/api/v1/tutor", json=body)
    assert r.status_code == 200, r.text
    assert not [a for a in r.json()["actions"] if a["type"] == "draw_figure"]
