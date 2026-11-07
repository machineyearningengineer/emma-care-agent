"""HTTP front for the agent: one JSON endpoint and one static page."""

from __future__ import annotations

from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field

from app.agent import ask

app = FastAPI(title="Care data agent")
INDEX = Path(__file__).parent / "static" / "index.html"


class Turn(BaseModel):
    role: str = Field(pattern="^(user|assistant)$")
    content: str


class Ask(BaseModel):
    question: str = Field(min_length=1, max_length=2000)
    history: list[Turn] = Field(default_factory=list, max_length=12)


@app.get("/")
def index():
    return FileResponse(INDEX)


@app.post("/api/ask")
def api_ask(body: Ask):
    # Plain def: FastAPI runs it in a worker thread, so slow model calls don't block others.
    try:
        return ask(body.question, [t.model_dump() for t in body.history])
    except Exception as e:  # model or network failure: report it, don't hide it
        raise HTTPException(status_code=502, detail=f"{type(e).__name__}: {e}") from e
