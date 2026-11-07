"""The stream protocol: every event the agent, a replay or the server emits, in order.

    query* → result*  (once per tool call)  →  delta*  →  done  →  suggestions
    `discard` follows any deltas written next to tool calls: the page drops that text.
    `start` (server) opens a stream; `error` (server) ends one that failed.

One definition, used by the agent, the replay, the server and the tests that check them.
"""

from __future__ import annotations

from typing import Annotated, Literal, NotRequired, TypedDict

from pydantic import Field, TypeAdapter


class Start(TypedDict):
    type: Literal["start"]
    request_id: str
    mode: str


class Query(TypedDict):
    type: Literal["query"]
    sql: str
    params: list


class Result(TypedDict):
    type: Literal["result"]
    sql: str
    params: list
    ms: float
    row_count: NotRequired[int]
    truncated: NotRequired[bool]
    cells_truncated: NotRequired[bool]
    error: NotRequired[str]


class Delta(TypedDict):
    type: Literal["delta"]
    text: str


class Discard(TypedDict):
    type: Literal["discard"]


class Usage(TypedDict):
    prompt_tokens: int
    completion_tokens: int
    cached_tokens: NotRequired[int]  # absent in recordings made before it was measured
    peak_prompt_tokens: NotRequired[int]  # the largest single call: what the model's context actually held


class Done(TypedDict):
    type: Literal["done"]
    answer: str
    trace: list[dict]
    model: str
    steps: int
    usage: Usage
    seconds: float
    timing: NotRequired[list[dict]]  # per model call: {"model_s", "prompt_tokens"}
    first_text_s: NotRequired[float | None]  # seconds until the first word of the answer appeared
    prompt: NotRequired[str]  # version of the system prompt that produced the answer
    replay: NotRequired[dict]  # present when played back from a recording


class Suggestions(TypedDict):
    type: Literal["suggestions"]
    questions: list[str]


class Error(TypedDict):
    type: Literal["error"]
    request_id: str
    detail: str


Event = Annotated[
    Start | Query | Result | Delta | Discard | Done | Suggestions | Error, Field(discriminator="type")
]
_adapter = TypeAdapter(Event)


def validate(event: dict) -> dict:
    """Raise if `event` isn't part of the protocol. For tests and anything at a boundary."""
    return _adapter.validate_python(event)
