"""Read-only access to the care database: the one query tool the agent gets.

Every guardrail lives here in code, not in the prompt: the model can write any
SQL it likes, and SQLite itself refuses anything that isn't a bounded read.
"""

from __future__ import annotations

import json
import sqlite3
import time
from pathlib import Path

from app.config import DB_PATH

MAX_ROWS = 200
MAX_CELL_CHARS = 500
MAX_RESULT_CHARS = 30_000  # whole result, so one query can't flood the prompt
TIMEOUT_S = 2.0
MAX_VALUE_BYTES = 1_000_000  # any string/blob SQLite builds; the timeout can't stop one native call

# Reads only. json_each/json_extract are FUNCTION calls; RECURSIVE allows WITH RECURSIVE.
_ALLOWED = {sqlite3.SQLITE_READ, sqlite3.SQLITE_SELECT, sqlite3.SQLITE_FUNCTION, sqlite3.SQLITE_RECURSIVE}


# A flat read model over the nested JSON, and a full-text index over every piece of free text.
# They live in the connection's TEMP database (the source file stays untouched) and are made
# before the connection is locked. A production database would hold them as real views and a
# persistent FTS index kept in sync by triggers.
_READ_MODEL = """
CREATE TEMP VIEW visit_notes AS
  SELECT v.id AS visit_id, v.service_user_id AS person_id, su.name AS person, c.name AS carer,
         v.start_time, v.note
  FROM visits v LEFT JOIN service_users su ON su.id = v.service_user_id
  LEFT JOIN carers c ON c.id = v.carer_id WHERE v.note IS NOT NULL AND v.note != '';
CREATE TEMP VIEW activity_comments AS
  SELECT v.id AS visit_id, v.service_user_id AS person_id, su.name AS person, v.start_time,
         json_extract(a.value, '$.name') AS activity, json_extract(a.value, '$.status') AS status,
         json_extract(a.value, '$.comment') AS comment
  FROM visits v LEFT JOIN service_users su ON su.id = v.service_user_id, json_each(v.activities) a
  WHERE json_extract(a.value, '$.comment') IS NOT NULL AND json_extract(a.value, '$.comment') != '';
CREATE TEMP VIEW form_answers AS
  SELECT f.id AS form_id, fc.name AS form, f.service_user_id AS person_id, su.name AS person,
         f.created_at, json_extract(s.value, '$.section') AS section,
         json_extract(i.value, '$.question') AS question, json_extract(i.value, '$.answer') AS answer
  FROM forms f LEFT JOIN form_configs fc ON fc.id = f.form_config_id
  LEFT JOIN service_users su ON su.id = f.service_user_id,
  json_each(f.form_data) s, json_each(s.value, '$.items') i;
CREATE VIRTUAL TABLE temp.search
  USING fts5(source UNINDEXED, id UNINDEXED, person UNINDEXED, at UNINDEXED, text);
INSERT INTO temp.search SELECT 'visit', visit_id, person, start_time, note FROM visit_notes;
INSERT INTO temp.search SELECT 'visit', visit_id, person, start_time, comment FROM activity_comments;
INSERT INTO temp.search SELECT 'form', form_id, person, created_at, question || ': ' || answer
  FROM form_answers WHERE answer IS NOT NULL;
"""


def open_readonly(path: Path = DB_PATH) -> sqlite3.Connection:
    """The file itself, read-only at the OS level: for code that reads a record, not for the agent."""
    return sqlite3.connect(f"file:{path}?mode=ro", uri=True, check_same_thread=False)


def connect(path: Path = DB_PATH) -> sqlite3.Connection:
    """The agent's connection: read-only, plus the read model, then locked to reads."""
    con = open_readonly(path)
    con.executescript(_READ_MODEL)
    con.execute("PRAGMA query_only = ON")
    con.setlimit(sqlite3.SQLITE_LIMIT_LENGTH, MAX_VALUE_BYTES)
    return con


def _authorizer(action, arg1, *_):
    # FTS5 asks for PRAGMA data_version while it searches; no other pragma is ever allowed.
    if action in _ALLOWED or (action == sqlite3.SQLITE_PRAGMA and arg1 == "data_version"):
        return sqlite3.SQLITE_OK
    return sqlite3.SQLITE_DENY


def _cell(value) -> tuple[object, bool]:
    """JSON-safe cell value, and whether it was cut."""
    if isinstance(value, bytes):
        return f"<{len(value)} bytes>", False
    if isinstance(value, str) and len(value) > MAX_CELL_CHARS:
        return value[:MAX_CELL_CHARS] + "…[truncated]", True
    return value, False


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
        kept, size, cells_cut = [], 0, False
        for r in rows[:MAX_ROWS]:
            cells = [_cell(v) for v in r]
            row = [v for v, _ in cells]
            cells_cut = cells_cut or any(cut for _, cut in cells)
            size += len(json.dumps(row, ensure_ascii=False))
            if size > MAX_RESULT_CHARS:
                truncated = True
                break
            kept.append(row)
        rows = kept
        out = {
            "columns": columns,
            "rows": rows,
            "row_count": len(rows),
            "truncated": truncated,
            "ms": round((time.perf_counter() - started) * 1000, 1),
        }
        warnings = []
        if truncated:
            warnings.append(
                f"Result cut off after {len(rows)} rows. Rows not shown were not seen: "
                "narrow the query (fewer people, shorter window) or aggregate before concluding."
            )
        if cells_cut:
            out["cells_truncated"] = True
            warnings.append(
                f"Some values were cut at {MAX_CELL_CHARS} characters. Select the fields you need "
                "(json_each / json_extract) instead of whole JSON documents."
            )
        if warnings:
            out["warning"] = " ".join(warnings)
        return out
    except sqlite3.OperationalError as e:
        msg = "query exceeded the time limit; narrow it" if "interrupted" in str(e) else str(e)
        return _error(msg, started)
    except (sqlite3.Error, ValueError) as e:
        return _error(str(e), started)
    finally:
        con.close()


def _error(message: str, started: float) -> dict:
    return {"error": message, "ms": round((time.perf_counter() - started) * 1000, 1)}
