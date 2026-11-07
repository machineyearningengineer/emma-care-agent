"""One JSON object per log line: easy to grep, easy to ship to any log store.

Questions, SQL and params can name people, so they are dropped unless CARE_LOG_CONTENT=1.
"""

from __future__ import annotations

import json
import logging
import sys
import time

from app.config import LOG_CONTENT

_CONTENT_FIELDS = {"question", "sql", "params"}

log = logging.getLogger("care_agent")
if not log.handlers:
    _handler = logging.StreamHandler(sys.stdout)
    _handler.setFormatter(logging.Formatter("%(message)s"))
    log.addHandler(_handler)
    log.setLevel(logging.INFO)
    log.propagate = False


def log_event(event: str, **fields) -> None:
    if not LOG_CONTENT:
        fields = {k: v for k, v in fields.items() if k not in _CONTENT_FIELDS}
    log.info(
        json.dumps({"ts": round(time.time(), 3), "event": event, **fields}, ensure_ascii=False, default=str)
    )
