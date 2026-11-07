"""Server wiring with the agent stubbed out. No API calls."""

from fastapi.testclient import TestClient

from app import server


def test_index_and_ask(monkeypatch):
    seen = {}

    def fake_ask(question, history):
        seen.update(question=question, history=history)
        return {"answer": "ok", "trace": [], "model": "fake", "steps": 1, "usage": {}, "seconds": 0}

    monkeypatch.setattr(server, "ask", fake_ask)
    c = TestClient(server.app)
    assert "Care data agent" in c.get("/").text
    r = c.post("/api/ask", json={"question": "hi", "history": [{"role": "user", "content": "x"}]})
    assert (
        r.json()["answer"] == "ok"
        and r.json()["request_id"] == r.headers["X-Request-ID"]
        and seen["history"] == [{"role": "user", "content": "x"}]
    )


def test_bad_input_and_model_failure(monkeypatch):
    c = TestClient(server.app)
    assert c.post("/api/ask", json={"question": ""}).status_code == 422
    assert (
        c.post(
            "/api/ask", json={"question": "x", "history": [{"role": "system", "content": "x"}]}
        ).status_code
        == 422
    )

    def boom(*_):
        raise RuntimeError("model down")

    monkeypatch.setattr(server, "ask", boom)
    r = c.post("/api/ask", json={"question": "x"})
    assert r.status_code == 502 and "model down" in r.json()["detail"]


def test_stream_sends_events_and_reports_failure_as_event(monkeypatch):
    import json

    def fake_stream(question, history):
        yield {"type": "delta", "text": "hi"}
        raise RuntimeError("model down")

    monkeypatch.setattr(server, "ask_stream", fake_stream)
    monkeypatch.setenv("CARE_AGENT_MODE", "live")
    c = TestClient(server.app)
    r = c.post("/api/ask/stream", json={"question": "x"})
    events = [json.loads(line) for line in r.text.splitlines()]
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
    assert events[-1]["type"] == "done" and events[-1]["replay"]["model"]
    r = c.post("/api/ask/stream", json={"question": "something not recorded"})
    last = json.loads(r.text.splitlines()[-1])
    assert last["type"] == "error" and "OPENAI_API_KEY" in last["detail"]


def test_meta_is_derived_from_the_data():
    r = TestClient(server.app).get("/api/meta").json()
    assert r["org"] == "Brookmere Care Team" and r["people"] == 10 and r["to"] == "2025-11-16 17:30:00"
