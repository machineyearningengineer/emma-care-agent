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
    assert r.json()["answer"] == "ok" and seen["history"] == [{"role": "user", "content": "x"}]


def test_bad_input_and_model_failure(monkeypatch):
    c = TestClient(server.app)
    assert c.post("/api/ask", json={"question": ""}).status_code == 422
    assert c.post("/api/ask", json={"question": "x", "history": [{"role": "system", "content": "x"}]}).status_code == 422

    def boom(*_):
        raise RuntimeError("model down")

    monkeypatch.setattr(server, "ask", boom)
    r = c.post("/api/ask", json={"question": "x"})
    assert r.status_code == 502 and "model down" in r.json()["detail"]
