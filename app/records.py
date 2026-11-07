"""Reads that back the page: the data header and the record behind a citation."""

from __future__ import annotations

import json

from app.db import connect


def _one(sql: str, params: list):
    con = connect()
    try:
        return con.execute(sql, params).fetchone()
    finally:
        con.close()


def overview() -> dict:
    """Whose data this is and how recent it is."""
    con = connect()
    try:
        org = con.execute("SELECT name FROM org_units ORDER BY id LIMIT 1").fetchone()
        rows = con.execute("SELECT name FROM service_users WHERE status = 'Active' ORDER BY name")
        names = [r[0] for r in rows]
        first, last = con.execute("SELECT min(start_time), max(start_time) FROM visits").fetchone()
    finally:
        con.close()
    return {"org": org[0] if org else None, "people": len(names), "names": names, "from": first, "to": last}


def visit(visit_id: int) -> dict | None:
    """The source behind a "(visit N)" citation: the note and each activity, as recorded."""
    row = _one(
        "SELECT v.id, v.start_time, v.end_time, v.status, v.note, v.activities, su.name, c.name "
        "FROM visits v LEFT JOIN service_users su ON su.id = v.service_user_id "
        "LEFT JOIN carers c ON c.id = v.carer_id WHERE v.id = ?",
        [visit_id],
    )
    if row is None:
        return None
    keys = ["id", "start_time", "end_time", "status", "note", "activities", "person", "carer"]
    rec = dict(zip(keys, row, strict=True))
    rec["activities"] = json.loads(rec["activities"] or "[]")
    return {"kind": "visit", **rec}


def form(form_id: int) -> dict | None:
    """The source behind a "(form N)" citation: every section, question and answer."""
    row = _one(
        "SELECT f.id, f.instance_title, fc.name, f.created_at, f.entity_type, su.name, f.form_data "
        "FROM forms f LEFT JOIN form_configs fc ON fc.id = f.form_config_id "
        "LEFT JOIN service_users su ON su.id = f.service_user_id WHERE f.id = ?",
        [form_id],
    )
    if row is None:
        return None
    keys = ["id", "title", "form", "created_at", "entity_type", "person", "sections"]
    rec = dict(zip(keys, row, strict=True))
    rec["sections"] = json.loads(rec["sections"] or "[]")
    return {"kind": "form", **rec}
