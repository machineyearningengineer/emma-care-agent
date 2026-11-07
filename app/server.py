"""HTTP front for the agent: JSON and streaming endpoints, and one static page.

Every request gets an id. It is returned to the client (header and events) and is on
every log line, so a reported problem can be found in the logs.
"""

from __future__ import annotations

import json
import logging
import sys
import time
import uuid
from pathlib import Path

from fastapi import FastAPI, HTTPException, Response
from fastapi.responses import FileResponse, StreamingResponse
from pydantic import BaseModel, Field

from app.agent import MODEL, ask, ask_stream
from app.db import connect
from app.replay import EXAMPLES, mode, replay_stream

app = FastAPI(title="Care data agent")
INDEX = Path(__file__).parent / "static" / "index.html"

log = logging.getLogger("care_agent")
if not log.handlers:
    _h = logging.StreamHandler(sys.stdout)
    _h.setFormatter(logging.Formatter("%(message)s"))
    log.addHandler(_h)
    log.setLevel(logging.INFO)
    log.propagate = False


def _log(request_id: str, event: str, **fields) -> None:
    """One JSON object per line: easy to grep, easy to ship to any log store."""
    log.info(
        json.dumps(
            {"ts": round(time.time(), 3), "request_id": request_id, "event": event, **fields},
            ensure_ascii=False,
            default=str,
        )
    )


class Turn(BaseModel):
    role: str = Field(pattern="^(user|assistant)$")
    content: str = Field(max_length=20_000)


class Ask(BaseModel):
    question: str = Field(min_length=1, max_length=2000)
    history: list[Turn] = Field(default_factory=list, max_length=12)


def _events(question: str, history: list[dict]):
    return ask_stream(question, history) if mode() == "live" else replay_stream(question)


@app.get("/")
def index():
    return FileResponse(INDEX)


@app.get("/api/meta")
def meta():
    """What the page header shows: whose data it is, how recent, and how answers are made."""
    con = connect()
    try:
        org = con.execute("SELECT name FROM org_units ORDER BY id LIMIT 1").fetchone()
        people = con.execute("SELECT count(*) FROM service_users WHERE status = 'Active'").fetchone()[0]
        first, last = con.execute("SELECT min(start_time), max(start_time) FROM visits").fetchone()
    finally:
        con.close()
    return {
        "org": org[0] if org else None,
        "people": people,
        "from": first,
        "to": last,
        "model": MODEL,
        "mode": mode(),
        "examples": EXAMPLES,
    }


@app.post("/api/ask")
def api_ask(body: Ask, response: Response):
    """Whole answer as one JSON object. For curl, scripts and evals. Always live."""
    rid = uuid.uuid4().hex[:12]
    response.headers["X-Request-ID"] = rid
    _log(rid, "ask", question=body.question, transport="json")
    try:
        result = ask(body.question, [t.model_dump() for t in body.history])
    except Exception as e:  # model or network failure: report it, don't hide it
        _log(rid, "error", error=f"{type(e).__name__}: {e}")
        raise HTTPException(status_code=502, detail=f"{type(e).__name__}: {e} (request {rid})") from e
    _log(rid, "done", steps=result["steps"], seconds=result["seconds"], **result["usage"])
    return {"request_id": rid, **result}


@app.post("/api/ask/stream")
def api_ask_stream(body: Ask):
    """The same agent as newline-delimited JSON events, so the page can show progress."""
    rid = uuid.uuid4().hex[:12]
    history = [t.model_dump() for t in body.history]
    run_mode = mode()

    def lines():
        started = time.perf_counter()
        _log(rid, "ask", question=body.question, transport="stream", mode=run_mode)
        yield _line({"type": "start", "request_id": rid, "mode": run_mode})
        try:
            for event in _events(body.question, history):
                if event["type"] == "result":
                    _log(rid, "query", **{k: v for k, v in event.items() if k != "type"})
                elif event["type"] == "done":
                    _log(rid, "done", steps=event["steps"], seconds=event["seconds"], **event["usage"])
                yield _line(event)
        except GeneratorExit:  # client went away; closing ask_stream closes the OpenAI stream
            _log(rid, "cancelled", seconds=round(time.perf_counter() - started, 1))
            raise
        except Exception as e:  # headers are already sent, so failures travel as an event
            _log(rid, "error", error=f"{type(e).__name__}: {e}")
            yield _line({"type": "error", "request_id": rid, "detail": f"{type(e).__name__}: {e}"})

    # A sync generator runs in a worker thread, so slow model calls don't block other requests.
    return StreamingResponse(
        lines(),
        media_type="application/x-ndjson",
        headers={"Cache-Control": "no-store", "X-Accel-Buffering": "no", "X-Request-ID": rid},
    )


def _line(event: dict) -> str:
    return json.dumps(event, ensure_ascii=False, default=str) + "\n"
