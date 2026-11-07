"""The one place configuration is read: environment, models, limits, and run mode.

Everything else imports from here, so no module depends on another having loaded `.env`.
"""

from __future__ import annotations

import os
from pathlib import Path

from dotenv import load_dotenv

load_dotenv()

DB_PATH = Path(os.environ.get("CARE_DB", Path(__file__).parent.parent / "sources" / "care_data.db"))

MODEL = os.environ.get("OPENAI_MODEL", "gpt-5.5")  # the app; evals default to a cheaper one
FOLLOW_UP_MODEL = os.environ.get("FOLLOW_UP_MODEL", "gpt-5.4-mini")
# Reasoning effort for the answering model. The chat API only allows tools with "none" on gpt-5.5, and on
# the broad question "none" took 19 s and 75k tokens against 51 s and 205k with reasoning on, with the
# same five people found and 8 of 8 evals passing. Set it to an empty string to leave it to the model.
REASONING_EFFORT = os.environ.get("OPENAI_REASONING_EFFORT", "none") or None

# Three independent bounds on one question; the first to trip makes the next turn the answer.
MAX_STEPS = 8  # model turns that may call tools
TOKEN_BUDGET = 150_000  # prompt tokens spent so far (every step re-sends the conversation)
DEADLINE_S = 120  # wall clock

# Cost and privacy guards for a live deployment.
MAX_CONCURRENT = 8  # live questions running at once; one more is told to retry, not queued
LOG_CONTENT = os.environ.get("CARE_LOG_CONTENT") == "1"  # questions, SQL and params can name people

# Request limits. Served to the page by /api/meta, so the page never carries its own copy.
QUESTION_CHARS = 2000
HISTORY_MESSAGES = 6  # prior messages (user and assistant) sent back with a question


def mode() -> str:
    """ "live" (calls the model) or "replay" (recorded answers). Read per request, never cached."""
    forced = os.environ.get("CARE_AGENT_MODE")
    if forced in ("live", "replay"):
        return forced
    return "live" if os.environ.get("OPENAI_API_KEY") else "replay"
