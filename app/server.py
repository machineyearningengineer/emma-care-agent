"""HTTP front for the agent: JSON and streaming endpoints, and one static page."""

from __future__ import annotations

import json
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse, StreamingResponse
from pydantic import BaseModel, Field

from app.agent import MODEL, ask, ask_stream
from app.db import connect

app = FastAPI(title="Care data agent")
INDEX = Path(__file__).parent / "static" / "index.html"


class Turn(BaseModel):
    role: str = Field(pattern="^(user|assistant)$")
    content: str = Field(max_length=20_000)


class Ask(BaseModel):
    question: str = Field(min_length=1, max_length=2000)
    history: list[Turn] = Field(default_factory=list, max_length=12)


@app.get("/")
def index():
    return FileResponse(INDEX)


@app.get("/api/meta")
def meta():
    """What the page header shows: whose data it is and how recent."""
    con = connect()
    try:
        org = con.execute("SELECT name FROM org_units ORDER BY id LIMIT 1").fetchone()
        people = con.execute("SELECT count(*) FROM service_users WHERE status = 'Active'").fetchone()[0]
        first, last = con.execute("SELECT min(start_time), max(start_time) FROM visits").fetchone()
    finally:
        con.close()
    return {"org": org[0] if org else None, "people": people, "from": first, "to": last, "model": MODEL}


@app.post("/api/ask")
def api_ask(body: Ask):
    """Whole answer as one JSON object. For curl, scripts and evals."""
    try:
        return ask(body.question, [t.model_dump() for t in body.history])
    except Exception as e:  # model or network failure: report it, don't hide it
        raise HTTPException(status_code=502, detail=f"{type(e).__name__}: {e}") from e


@app.post("/api/ask/stream")
def api_ask_stream(body: Ask):
    """The same agent as newline-delimited JSON events, so the page can show progress."""
    history = [t.model_dump() for t in body.history]

    def lines():
        try:
            for event in ask_stream(body.question, history):
                yield json.dumps(event, ensure_ascii=False, default=str) + "\n"
        except Exception as e:  # headers are already sent, so failures travel as an event
            yield json.dumps({"type": "error", "detail": f"{type(e).__name__}: {e}"}) + "\n"

    # A sync generator runs in a worker thread; if the client disconnects, Starlette closes it,
    # which closes the OpenAI stream inside ask_stream.
    return StreamingResponse(lines(), media_type="application/x-ndjson",
                             headers={"Cache-Control": "no-store", "X-Accel-Buffering": "no"})
