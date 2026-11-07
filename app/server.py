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

from fastapi import FastAPI, HTTPException
from fastapi import Path as PathParam
from fastapi.responses import FileResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from app import records
from app.agent import PROMPT_VERSION, ask_stream
from app.config import HISTORY_MESSAGES, MODEL, QUESTION_CHARS, mode
from app.replay import EXAMPLES, replay_stream

app = FastAPI(title="Care data agent")
STATIC = Path(__file__).parent / "static"
INDEX = STATIC / "index.html"
app.mount("/static", StaticFiles(directory=STATIC), name="static")

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
    question: str = Field(min_length=1, max_length=QUESTION_CHARS)
    history: list[Turn] = Field(default_factory=list, max_length=HISTORY_MESSAGES)


@app.get("/")
def index():
    return FileResponse(INDEX)


@app.get("/api/meta")
def meta():
    """What the page needs before the first question: the data, the mode, and the limits to respect."""
    return {
        **records.overview(),
        "model": MODEL,
        "mode": mode(),
        "examples": EXAMPLES,
        "limits": {"question_chars": QUESTION_CHARS, "history_messages": HISTORY_MESSAGES},
    }


@app.get("/api/records/visit/{visit_id}")
def visit_record(visit_id: int = PathParam(ge=1)):
    return records.visit(visit_id) or _missing("visit", visit_id)


@app.get("/api/records/form/{form_id}")
def form_record(form_id: int = PathParam(ge=1)):
    return records.form(form_id) or _missing("form", form_id)


def _missing(kind: str, record_id: int):
    raise HTTPException(status_code=404, detail=f"No {kind} {record_id}")


@app.post("/api/ask/stream")
def api_ask_stream(body: Ask):
    """The agent as newline-delimited JSON events (app/events.py), so the page can show progress."""
    rid = uuid.uuid4().hex[:12]
    history = [t.model_dump() for t in body.history]
    run_mode = mode()  # once per request: the start event and the events that follow agree

    def lines():
        started = time.perf_counter()
        _log(rid, "ask", question=body.question, mode=run_mode, prompt=PROMPT_VERSION)
        yield _line({"type": "start", "request_id": rid, "mode": run_mode})
        events = ask_stream(body.question, history) if run_mode == "live" else replay_stream(body.question)
        try:
            for event in events:
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
            # LookupError is an expected, user-facing message (replay has no answer); others show their type.
            detail = str(e) if isinstance(e, LookupError) else f"{type(e).__name__}: {e}"
            yield _line({"type": "error", "request_id": rid, "detail": detail})

    # A sync generator runs in a worker thread, so slow model calls don't block other requests.
    return StreamingResponse(
        lines(),
        media_type="application/x-ndjson",
        headers={"Cache-Control": "no-store", "X-Accel-Buffering": "no", "X-Request-ID": rid},
    )


def _line(event: dict) -> str:
    return json.dumps(event, ensure_ascii=False, default=str) + "\n"
