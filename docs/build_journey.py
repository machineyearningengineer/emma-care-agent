"""Render docs/journey.html from docs/journey.yaml.

Numbers come from the code (`${MAX_ROWS}` in the YAML), and every commit listed must exist in
git history, so the page can't drift from the system it describes.

uv run python docs/build_journey.py            write docs/journey.html
uv run python docs/build_journey.py --check    exit 1 if the file is out of date
"""

from __future__ import annotations

import importlib
import json
import re
import subprocess
import sys
from pathlib import Path

import yaml

HERE = Path(__file__).parent
ROOT = HERE.parent
sys.path.insert(0, str(ROOT))
MODULES = ("app.config", "app.db", "app.schema", "app.agent")


def constant(name: str):
    for module in MODULES:
        mod = importlib.import_module(module)
        if hasattr(mod, name):
            return getattr(mod, name)
    raise KeyError(f"journey.yaml uses ${{{name}}}, which is not a constant in {', '.join(MODULES)}")


def fill(node):
    if isinstance(node, str):
        return re.sub(r"\$\{(\w+)\}", lambda m: _show(constant(m.group(1))), node)
    if isinstance(node, list):
        return [fill(x) for x in node]
    if isinstance(node, dict):
        return {k: fill(v) for k, v in node.items()}
    return node


def _show(value) -> str:
    return f"{value:,}" if isinstance(value, int) else str(value)


def commits_exist(data: dict) -> list[str]:
    missing = []
    for step in data["steps"]:
        for sha in step.get("commits", []):
            ok = subprocess.run(["git", "cat-file", "-e", f"{sha}^{{commit}}"], cwd=ROOT, capture_output=True)
            if ok.returncode != 0:
                missing.append(f"step {step['id']}: {sha}")
    return missing


def render() -> str:
    data = fill(yaml.safe_load((HERE / "journey.yaml").read_text()))
    node_ids = {n["id"] for n in data["nodes"]}
    refs = [n for s in data["steps"] for n in s.get("nodes", [])] + [
        n for s in data["next"] for n in s["touches"]
    ]
    unknown = sorted(set(refs) - node_ids)
    if unknown:
        raise ValueError(f"journey.yaml names nodes that don't exist: {unknown}")
    payload = json.dumps(data, ensure_ascii=False).replace("</", "<\\/")
    return (HERE / "journey.template.html").read_text().replace("/*DATA*/null", payload)


def main() -> int:
    missing = commits_exist(yaml.safe_load((HERE / "journey.yaml").read_text()))
    if missing:
        print("commits not in git history:", ", ".join(missing))
        return 1
    html = render()
    target = HERE / "journey.html"
    if "--check" in sys.argv:
        return 0 if target.exists() and target.read_text() == html else 1
    target.write_text(html)
    print(f"wrote {target.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
