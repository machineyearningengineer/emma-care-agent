"""The journey page can't drift from the code it describes. No API calls."""

import importlib.util
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).parent.parent
spec = importlib.util.spec_from_file_location("build_journey", ROOT / "docs" / "build_journey.py")
journey = importlib.util.module_from_spec(spec)
spec.loader.exec_module(journey)


def test_page_matches_the_yaml_and_the_code_constants():
    assert (ROOT / "docs" / "journey.html").read_text() == journey.render(), (
        "docs/journey.html is out of date: run `uv run python docs/build_journey.py`"
    )


def test_every_listed_commit_exists():
    if subprocess.run(["git", "rev-parse"], cwd=ROOT, capture_output=True).returncode != 0:
        pytest.skip("not a git checkout")
    data = journey.yaml.safe_load((ROOT / "docs" / "journey.yaml").read_text())
    assert journey.commits_exist(data) == []
