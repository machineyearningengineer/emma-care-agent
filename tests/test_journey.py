"""The architecture page and markdown can't drift from the code or the YAML. No API calls."""

import copy
import importlib.util
import re
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).parent.parent
DOCS = ROOT / "docs"
spec = importlib.util.spec_from_file_location("build_journey", DOCS / "build_journey.py")
journey = importlib.util.module_from_spec(spec)
spec.loader.exec_module(journey)

RAW = journey.yaml.safe_load((DOCS / "journey.yaml").read_text())
DATA = journey.load()


def test_html_is_current():
    assert (DOCS / "journey.html").read_text() == journey.render(), (
        "run `uv run python docs/build_journey.py`"
    )


def test_markdown_is_current():
    assert (DOCS / "architecture.md").read_text() == journey.render_markdown(), (
        "run `uv run python docs/build_journey.py`"
    )


def test_check_flag_agrees_with_the_files():
    run = subprocess.run(
        ["uv", "run", "python", "docs/build_journey.py", "--check"], cwd=ROOT, capture_output=True
    )
    assert run.returncode == 0, run.stdout.decode()


def test_every_listed_commit_exists():
    if subprocess.run(["git", "rev-parse"], cwd=ROOT, capture_output=True).returncode != 0:
        pytest.skip("not a git checkout")
    assert journey.commits_exist(RAW) == []


def test_every_id_resolves_and_every_requirement_is_met():
    assert journey.problems(DATA) == []
    reqs = {r["id"] for r in DATA["requirements"]}
    assert {r for n in DATA["nodes"] for r in n["meets"]} == reqs
    assert all(n["meets"] for n in DATA["nodes"])
    assert {r["kind"] for r in DATA["requirements"]} == {"functional", "nonfunctional"}


def test_the_checker_catches_broken_references():
    cases = {
        "meets": lambda d: d["nodes"][0]["meets"].append("nope"),
        "edge": lambda d: d["edges"].append({"from": "page", "to": "nope", "label": "x"}),
        "story": lambda d: d["story"]["steps"][2].update(node="nope"),
        "next": lambda d: d["next"][0]["touches"].append("nope"),
        "step": lambda d: d["steps"][1]["nodes"].append("nope"),
        "unmet": lambda d: [n.update(meets=[m for m in n["meets"] if m != "fr-refuse"]) for n in d["nodes"]],
        "no meets": lambda d: d["nodes"][0].update(meets=[]),
        "primary kind": lambda d: d["nodes"][0].update(primary="maybe"),
        "primary unmet": lambda d: d["nodes"][0].update(primary="nfr", meets=["fr-ask"]),
        "disconnected": lambda d: d.update(
            edges=[e for e in d["edges"] if "records" not in (e["from"], e["to"])]
        ),
    }
    for name, break_it in cases.items():
        bad = copy.deepcopy(DATA)
        break_it(bad)
        assert journey.problems(bad), f"problems() missed: {name}"


def test_numbers_come_from_the_code():
    text = (DOCS / "architecture.md").read_text()
    assert "${" not in text
    assert f"{journey.constant('MAX_ROWS'):,} rows" in text


def test_prose_avoids_the_marks_of_machine_writing():
    text = (DOCS / "journey.yaml").read_text()
    assert "\u2014" not in text and "\u2013" not in text, "no em or en dashes"
    banned = r"\b(leverage|robust|seamless|crucial|testament|landscape|delve|ensure|not just)\b"
    assert not re.search(banned, text, re.I)


def test_markdown_covers_every_part_and_step():
    md = (DOCS / "architecture.md").read_text()
    for n in DATA["nodes"]:
        assert f"### {n['label']}" in md
    for s in DATA["steps"]:
        assert f"### Step {s['id']}," in md
    assert len(re.findall(r"^\| (fr|nfr)-", md, re.M)) == len(DATA["requirements"])


def test_every_node_declares_an_honest_primary_kind():
    kinds = {r["id"]: r["kind"] for r in DATA["requirements"]}
    for n in RAW["nodes"]:
        assert n.get("primary") in ("fr", "nfr"), f"{n['id']} needs primary: fr or nfr"
        want = journey.PRIMARY[n["primary"]]
        assert any(kinds[r] == want for r in n["meets"])
    assert {n["primary"] for n in DATA["nodes"]} == {"fr", "nfr"}


def test_primary_defaults_to_the_majority_kind():
    raw = copy.deepcopy(RAW)
    for n in raw["nodes"]:
        n.pop("primary", None)
    assert journey.problems(raw) == []


def test_page_text_has_no_dashes_and_the_template_stays_small():
    html = (DOCS / "journey.template.html").read_text()
    assert "\u2014" not in html and "\u2013" not in html
    assert len(html.splitlines()) < 700
