"""Replay mode: recorded real answers, so the app runs and demos without an OpenAI key.

Which mode runs is decided in app/config.py. Replays are recorded from live runs by
`uv run python -m app.replay record` and stored in app/replays.json with the model and date.
"""

from __future__ import annotations

import json
import re
import sys
import time
from collections.abc import Iterator
from datetime import date
from pathlib import Path

from app.events import Event

REPLAYS = Path(__file__).parent / "replays.json"

# The questions offered on the page. Replays exist for exactly these.
EXAMPLES = [
    "Who needs my attention this week?",
    "Are there any medication issues I should know about?",
    "Were any visits missed or late?",
    "What open safeguarding cases are there and what is still pending?",
    "Summarise Alfred Nkemelu's last 7 days.",
]


def _key(question: str) -> str:
    return re.sub(r"[^a-z0-9]+", " ", question.lower()).strip()


def _load() -> dict:
    return json.loads(REPLAYS.read_text()) if REPLAYS.exists() else {"answers": {}}


def replay_stream(question: str, pace: float = 1.0) -> Iterator[Event]:
    """Yield the same events as agent.ask_stream, from a recording."""
    data = _load()
    rec = data["answers"].get(_key(question))
    if rec is None:
        raise LookupError(
            "Recorded answers exist for the example questions only. Set OPENAI_API_KEY to ask anything else."
        )
    for entry in rec["trace"]:
        yield {"type": "query", "sql": entry["sql"], "params": entry.get("params", [])}
        time.sleep(0.25 * pace)
        yield {"type": "result", **entry}
    for word in re.findall(r"\S+\s*", rec["answer"]):
        time.sleep(0.012 * pace)
        yield {"type": "delta", "text": word}
    done = {k: v for k, v in rec.items() if k != "follow_ups"}
    yield {"type": "done", **done, "replay": {"recorded": data.get("recorded"), "model": rec["model"]}}
    yield {"type": "suggestions", "questions": rec.get("follow_ups", [])}


def record(questions: list[str]) -> None:
    from concurrent.futures import ThreadPoolExecutor

    from app.agent import ask, follow_ups

    def one(q: str) -> dict:
        r = ask(q)
        return {**r, "follow_ups": follow_ups(q, r["answer"])}

    with ThreadPoolExecutor(max_workers=5) as pool:
        results = list(pool.map(one, questions))
    data = {
        "recorded": date.today().isoformat(),
        "answers": {_key(q): r for q, r in zip(questions, results, strict=True)},
    }
    REPLAYS.write_text(json.dumps(data, indent=1, ensure_ascii=False) + "\n")
    print(f"recorded {len(results)} answers to {REPLAYS}")


if __name__ == "__main__" and sys.argv[1:] == ["record"]:
    record(EXAMPLES)
