"""Server wiring with the agent stubbed out. No API calls."""

from fastapi.testclient import TestClient

from app import server
from app.events import validate


def test_index_static_and_input_limits(monkeypatch):
    c = TestClient(server.app)
    assert "Care data agent" in c.get("/").text
    assert c.get("/static/app.js").status_code == 200 and c.get("/static/app.css").status_code == 200
    limits = c.get("/api/meta").json()["limits"]
    assert c.post("/api/ask/stream", json={"question": ""}).status_code == 422
    assert (
        c.post("/api/ask/stream", json={"question": "x" * (limits["question_chars"] + 1)}).status_code == 422
    )
    too_long = [{"role": "user", "content": "x"}] * (limits["history_messages"] + 1)
    assert c.post("/api/ask/stream", json={"question": "x", "history": too_long}).status_code == 422
    bad_role = [{"role": "system", "content": "x"}]
    assert c.post("/api/ask/stream", json={"question": "x", "history": bad_role}).status_code == 422


def test_stream_sends_events_and_reports_failure_as_event(monkeypatch):
    import json

    seen = {}

    def fake_stream(question, history):
        seen["history"] = history
        yield {"type": "delta", "text": "hi"}
        raise RuntimeError("model down")

    monkeypatch.setattr(server, "ask_stream", fake_stream)
    monkeypatch.setenv("CARE_AGENT_MODE", "live")
    c = TestClient(server.app)
    r = c.post("/api/ask/stream", json={"question": "x", "history": [{"role": "user", "content": "h"}]})
    events = [json.loads(line) for line in r.text.splitlines()]
    assert seen["history"] == [{"role": "user", "content": "h"}]
    rid = r.headers["X-Request-ID"]
    assert r.headers["content-type"].startswith("application/x-ndjson")
    assert events[0] == {"type": "start", "request_id": rid, "mode": "live"}
    assert events[1] == {"type": "delta", "text": "hi"}
    assert events[-1]["type"] == "error" and "model down" in events[-1]["detail"]
    assert events[-1]["request_id"] == rid


def test_replay_mode_without_a_key(monkeypatch):
    import json

    from app import replay

    monkeypatch.setenv("CARE_AGENT_MODE", "replay")
    monkeypatch.setattr(replay.time, "sleep", lambda _: None)
    c = TestClient(server.app)
    assert c.get("/api/meta").json()["mode"] == "replay"
    r = c.post("/api/ask/stream", json={"question": replay.EXAMPLES[0]})
    events = [json.loads(line) for line in r.text.splitlines()]
    assert events[0]["type"] == "start" and all(validate(e) for e in events)
    assert events[-2]["type"] == "done" and events[-2]["replay"]["model"]
    assert events[-1]["type"] == "suggestions"
    r = c.post("/api/ask/stream", json={"question": "something not recorded"})
    last = json.loads(r.text.splitlines()[-1])
    assert last["type"] == "error" and "OPENAI_API_KEY" in last["detail"]


def test_meta_is_derived_from_the_data():
    r = TestClient(server.app).get("/api/meta").json()
    assert r["org"] == "Brookmere Care Team" and r["people"] == 10 and r["to"] == "2025-11-16 17:30:00"
    assert r["limits"] == {"question_chars": 2000, "history_messages": 6}


def test_citation_records():
    c = TestClient(server.app)
    v = c.get("/api/records/visit/293").json()
    assert v["person"] == "Iris Bennett" and "morning medication" in v["note"]
    med = next(a for a in v["activities"] if a["name"] == "Medication")
    assert med["status"] == "Completed" and "not to have given" in med["comment"]
    f = c.get("/api/records/form/22").json()
    assert f["form"] == "Safeguarding Enquiry Report" and f["sections"][0]["items"]
    assert c.get("/api/records/visit/99999").status_code == 404
    assert c.get("/api/records/form/0").status_code == 422
