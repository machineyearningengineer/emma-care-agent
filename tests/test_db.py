"""Guardrails for run_sql. No API calls."""

from app import db


def test_select_and_json_work():
    r = db.run_sql(
        "SELECT count(*) FROM visits v, json_each(v.activities) a WHERE json_extract(a.value, '$.name') = ?",
        ["Medication"],
    )
    assert r["rows"] == [[336]]


def test_cte_works():
    r = db.run_sql("WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i+1 FROM n WHERE i<3) SELECT i FROM n")
    assert r["rows"] == [[1], [2], [3]]


def test_write_rejected():
    for sql in [
        "DELETE FROM visits",
        "UPDATE visits SET note = 'x'",
        "INSERT INTO carers(id, name) VALUES (99, 'x')",
        "DROP TABLE visits",
        "CREATE TABLE t(x)",
    ]:
        assert "error" in db.run_sql(sql), sql
    assert db.run_sql("SELECT count(*) FROM visits")["rows"] == [[336]]


def test_attach_and_pragma_rejected():
    assert "error" in db.run_sql("ATTACH DATABASE ':memory:' AS x")
    assert "error" in db.run_sql("PRAGMA query_only = OFF")


def test_multiple_statements_rejected():
    r = db.run_sql("SELECT 1; DELETE FROM visits")
    assert "error" in r


def test_timeout():
    r = db.run_sql("WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i+1 FROM n) SELECT count(*) FROM n")
    assert "time limit" in r["error"]


def test_row_cap_and_cell_cap():
    r = db.run_sql("SELECT a.value FROM visits v, json_each(v.activities) a")
    assert r["row_count"] == db.MAX_ROWS and r["truncated"] is True
    r = db.run_sql("SELECT form_data FROM forms LIMIT 1")
    assert r["rows"][0][0].endswith("…[truncated]")
    assert r["cells_truncated"] is True and "json_extract" in r["warning"]


def test_error_is_returned_not_raised():
    assert "no such table" in db.run_sql("SELECT * FROM nope")["error"]


def test_result_size_cap():
    r = db.run_sql("SELECT note FROM visits")
    assert r["truncated"] is True and "not seen" in r["warning"]
    assert sum(len(str(row)) for row in r["rows"]) <= db.MAX_RESULT_CHARS + 1000


def test_huge_value_rejected_not_built():
    # One native call isn't interruptible by the progress handler; the length limit stops it.
    assert "too big" in db.run_sql("SELECT replace(hex(zeroblob(100000000)), '0', 'ab')")["error"]
    assert db.run_sql("SELECT printf('%.*c', 10000000, 'a')")["rows"] == [[None]]


def test_blob_is_reported_not_raised():
    assert db.run_sql("SELECT zeroblob(16)")["rows"] == [["<16 bytes>"]]
