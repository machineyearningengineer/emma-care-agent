"""Contracts between the prompt, the recordings and the page. No API calls."""

import json
import re
from pathlib import Path

from app import agent, contract
from app.replay import EXAMPLES, REPLAYS, _key

STATIC = Path(agent.__file__).parent / "static"


def _page_citation():
    """The page's citation pattern, read from app.js so the test can't drift from it."""
    src = (STATIC / "app.js").read_text()
    return re.compile(re.search(r"const CITE = /(.+)/gi;", src).group(1), re.I)


def test_the_page_and_the_contract_agree_on_citations_and_the_gaps_heading():
    assert _page_citation().pattern == contract.CITATION.pattern
    page = (STATIC / "app.js").read_text()
    assert "what i couldn['\u2019]?t determine" in page  # the page's copy of contract.UNKNOWNS
    heading = "What I couldn't determine:"
    assert heading in agent.SYSTEM and contract.UNKNOWNS.search(heading)


def test_prompt_citation_format_is_what_the_page_links():
    cite = _page_citation()
    for example in ("(visit 12)", "(form 4)", "(visits 12, 15)"):
        assert cite.fullmatch(example)
    assert "(visit <id>) or (form <id>)" in agent.SYSTEM and "(visits 12, 15)" in agent.SYSTEM
    assert not cite.fullmatch("(visit 12, 2025-11-12)")  # a date inside the brackets isn't a citation


def test_every_recorded_answer_ends_with_what_it_could_not_determine():
    answers = json.loads(REPLAYS.read_text())["answers"]
    assert set(answers) == {_key(q) for q in EXAMPLES}
    for key, rec in answers.items():
        assert re.search(r"what i couldn.?t determine", rec["answer"], re.I), key


def test_every_recorded_citation_is_one_the_page_links():
    cite = _page_citation()
    for rec in json.loads(REPLAYS.read_text())["answers"].values():
        for m in re.findall(r"\((?:visits?|forms?)\s[^()]*\)", rec["answer"]):
            assert cite.fullmatch(m), m


def test_cited_ids_reads_every_id_in_every_bracket():
    assert contract.cited_ids("a (visit 12) b (form 4) c (visits 15, 16)") == [
        ("visit", 12),
        ("form", 4),
        ("visit", 15),
        ("visit", 16),
    ]
    assert contract.cited_ids("(visit 12, visits 15)") == []  # not a citation, so it is flagged elsewhere
