"""The two things the prompt, the evals and the page must agree on, written once.

The page (app/static/app.js) keeps its own copy because it runs in a browser;
tests/test_contracts.py fails if that copy stops matching these.
"""

import re

# "(visit 12)", "(form 4)", "(visits 12, 15)": ids only, one kind per bracket, no ranges.
CITATION = re.compile(r"\((visits?|forms?) (\d+(?:, \d+)*)\)", re.I)
# Anything that looks like a citation, well formed or not. A match that isn't a CITATION is unlinkable.
CITATION_LIKE = re.compile(r"\((?:visits?|forms?)\s[^()]*\)", re.I)
# The heading every analytical answer ends with. The page turns it into the "can't show" box.
UNKNOWNS = re.compile(r"what i couldn.?t determine", re.I)


def unlinkable_citations(answer: str) -> list[str]:
    return [m for m in CITATION_LIKE.findall(answer) if not CITATION.fullmatch(m)]
