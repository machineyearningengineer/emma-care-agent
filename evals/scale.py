"""Does the agent still find the planted concerns when the quiet people are many times more?

Copies the database, adds clones of the five people with only routine notes (new ids and names,
same text), points the agent at the copy and asks the broad question. The five people with real
concerns must still surface. The source file is never touched.

uv run python evals/scale.py [--factor 10] [--model gpt-5.4-mini]
"""

from __future__ import annotations

import argparse
import os
import shutil
import sqlite3
import sys
import tempfile
from pathlib import Path

SOURCE = Path(__file__).parent.parent / "sources" / "care_data.db"
QUIET = ("Margaret Hughes", "Harold", "Jean Whitmore", "Patricia Lowe", "Stanley Grant")
PLANTED = ("Alfred", "Doris", "Raymond", "Iris", "Cynthia")


def build(factor: int, dest: Path) -> int:
    shutil.copy(SOURCE, dest)
    con = sqlite3.connect(dest)
    quiet = [r for r in con.execute("SELECT id, name FROM service_users") if r[1].startswith(QUIET)]
    next_user = con.execute("SELECT max(id) FROM service_users").fetchone()[0]
    next_visit = con.execute("SELECT max(id) FROM visits").fetchone()[0]
    next_form = con.execute("SELECT max(id) FROM forms").fetchone()[0]
    added = 0
    for k in range(2, factor + 1):
        for uid, name in quiet:
            next_user += 1
            row = con.execute("SELECT * FROM service_users WHERE id = ?", [uid]).fetchone()
            cols = [d[1] for d in con.execute("PRAGMA table_info(service_users)")]
            new = dict(zip(cols, row, strict=True)) | {"id": next_user, "name": f"{name} ({k})"}
            con.execute(f"INSERT INTO service_users VALUES ({','.join('?' * len(cols))})", list(new.values()))
            for table in ("visits", "forms"):
                tcols = [d[1] for d in con.execute(f"PRAGMA table_info({table})")]
                for r in con.execute(f"SELECT * FROM {table} WHERE service_user_id = ?", [uid]).fetchall():
                    if table == "visits":
                        next_visit += 1
                        new_id = next_visit
                    else:
                        next_form += 1
                        new_id = next_form
                    rec = dict(zip(tcols, r, strict=True)) | {"id": new_id, "service_user_id": next_user}
                    con.execute(
                        f"INSERT INTO {table} VALUES ({','.join('?' * len(tcols))})", list(rec.values())
                    )
                    added += table == "visits"
    con.commit()
    con.close()
    return added


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--factor", type=int, default=10)
    ap.add_argument("--model", default="gpt-5.4-mini")
    args = ap.parse_args()
    dest = Path(tempfile.mkdtemp()) / "scaled.db"
    added = build(args.factor, dest)
    os.environ["CARE_DB"] = str(dest)  # before the app imports its database path
    from app.agent import ask

    r = ask("Who needs my attention this week?", model=args.model)
    found = [p for p in PLANTED if p in r["answer"]]
    cut = sum(bool(t.get("truncated")) for t in r["trace"])
    print(
        f"+{added} visits ({args.factor}x quiet people). Found {len(found)}/5: {', '.join(found) or 'none'}"
    )
    print(f"{len(r['trace'])} queries ({cut} cut off), {r['steps']} steps, {r['seconds']}s, {r['usage']}")
    sys.exit(0 if len(found) == len(PLANTED) else 1)


if __name__ == "__main__":
    main()
