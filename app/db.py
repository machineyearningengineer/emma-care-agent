"""Read-only access to the care database: the one query tool the agent gets.

Every guardrail lives here in code, not in the prompt: the model can write any
SQL it likes, and SQLite itself refuses anything that isn't a bounded read.
"""

from __future__ import annotations

import os
import sqlite3
import time
from pathlib import Path

DB_PATH = Path(os.environ.get("CARE_DB", Path(__file__).parent.parent / "sources" / "care_data.db"))

MAX_ROWS = 200
MAX_CELL_CHARS = 500
TIMEOUT_S = 2.0

# Reads only. json_each/json_extract are FUNCTION calls; RECURSIVE allows WITH RECURSIVE.
_ALLOWED = {sqlite3.SQLITE_READ, sqlite3.SQLITE_SELECT, sqlite3.SQLITE_FUNCTION, sqlite3.SQLITE_RECURSIVE}


def connect(path: Path = DB_PATH) -> sqlite3.Connection:
    """Open the file read-only at the OS level, then lock the connection to reads."""
    con = sqlite3.connect(f"file:{path}?mode=ro", uri=True, check_same_thread=False)
    con.execute("PRAGMA query_only = ON")
    return con


def _authorizer(action, *_):
    return sqlite3.SQLITE_OK if action in _ALLOWED else sqlite3.SQLITE_DENY


def _cell(value):
    if isinstance(value, str) and len(value) > MAX_CELL_CHARS:
        return value[:MAX_CELL_CHARS] + "…[truncated]"
    return value


def run_sql(sql: str, params: list | None = None, path: Path = DB_PATH) -> dict:
    """Run one read-only statement. Returns rows or an error string, never raises.

    Errors go back to the model as text so it can repair its own SQL.
    """
    started = time.perf_counter()
    con = connect(path)
    con.set_authorizer(_authorizer)
    deadline = started + TIMEOUT_S
    # Called every N VM steps; a non-zero return aborts the query.
    con.set_progress_handler(lambda: int(time.perf_counter() > deadline), 10_000)
    try:
        # sqlite3 refuses more than one statement per execute() by itself.
        cur = con.execute(sql, params or [])
        rows = cur.fetchmany(MAX_ROWS + 1)
        columns = [d[0] for d in cur.description or []]
        truncated = len(rows) > MAX_ROWS
        rows = [[_cell(v) for v in r] for r in rows[:MAX_ROWS]]
        return {
            "columns": columns,
            "rows": rows,
            "row_count": len(rows),
            "truncated": truncated,
            "ms": round((time.perf_counter() - started) * 1000, 1),
        }
    except sqlite3.OperationalError as e:
        msg = "query exceeded the time limit; narrow it" if "interrupted" in str(e) else str(e)
        return _error(msg, started)
    except (sqlite3.Error, ValueError) as e:
        return _error(str(e), started)
    finally:
        con.close()


def _error(message: str, started: float) -> dict:
    return {"error": message, "ms": round((time.perf_counter() - started) * 1000, 1)}
