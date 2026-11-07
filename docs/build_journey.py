"""Render docs/journey.html and docs/architecture.md from docs/journey.yaml.

Numbers come from the code (`${MAX_ROWS}` in the YAML), every commit listed must exist in git
history, and every id (meets, edges, story, steps, next) must resolve, so the outputs can't drift
from the system they describe.

uv run python docs/build_journey.py            write both files
uv run python docs/build_journey.py --check    exit 1 if either file is out of date
"""

from __future__ import annotations

import importlib
import itertools
import json
import re
import subprocess
import sys
from pathlib import Path

import yaml

HERE = Path(__file__).parent
ROOT = HERE.parent
PRIMARY = {"fr": "functional", "nfr": "nonfunctional"}
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


def connected(edges: list[dict], a: str, b: str) -> bool:
    """Is there a path from a to b, ignoring edge direction?"""
    seen, todo = {a}, [a]
    while todo:
        cur = todo.pop()
        for e in edges:
            for x, y in ((e["from"], e["to"]), (e["to"], e["from"])):
                if x == cur and y not in seen:
                    seen.add(y)
                    todo.append(y)
    return b in seen


def problems(data: dict) -> list[str]:
    """Everything wrong with the YAML's cross-references. Empty means consistent."""
    out: list[str] = []
    nodes = [n["id"] for n in data["nodes"]]
    reqs = [r["id"] for r in data["requirements"]]
    for kind, ids in (
        ("node", nodes),
        ("requirement", reqs),
        ("step", [str(s["id"]) for s in data["steps"]]),
    ):
        out += [f"duplicate {kind} id {i}" for i in sorted({i for i in ids if ids.count(i) > 1})]
    kinds = {r["id"]: r["kind"] for r in data["requirements"]}
    for n in data["nodes"]:
        if not n.get("meets"):
            out.append(f"node {n['id']} meets no requirement")
        if "primary" in n:
            want = PRIMARY.get(n["primary"])
            if want is None:
                out.append(f"node {n['id']} has primary {n['primary']}, want fr or nfr")
            elif not any(kinds.get(r) == want for r in n.get("meets", [])):
                out.append(f"node {n['id']} is primarily {n['primary']} but meets no {want} requirement")
        out += [f"node {n['id']} meets unknown {r}" for r in n.get("meets", []) if r not in reqs]
        if not any(n["id"] in s["nodes"] for s in data["steps"]):
            out.append(f"node {n['id']} is built in no step")
    for r in data["requirements"]:
        if r["kind"] not in ("functional", "nonfunctional"):
            out.append(f"requirement {r['id']} has kind {r['kind']}")
        if not any(r["id"] in n.get("meets", []) for n in data["nodes"]):
            out.append(f"requirement {r['id']} is met by no node")
    for e in data["edges"]:
        out += [
            f"edge {e['from']} to {e['to']} names unknown {x}" for x in (e["from"], e["to"]) if x not in nodes
        ]
    for t in data["thinking"]:
        out += [
            f"thinking {t['id']} has no {k}"
            for k in ("plain", "here", "fails", "check", "gap")
            if not t.get(k)
        ]
    for t in data["thinking"]:
        out += [
            f"thinking {t['id']} number {n.get('what')} has no why"
            for n in t.get("numbers", [])
            if not n.get("why")
        ]
    for key in ("flow", "citations"):
        out += [f"{key} item {i + 1} has no text" for i, x in enumerate(data[key]) if not x.get("text")]
    step_ids = [str(x["id"]) for x in data["steps"]]
    for d in data["decisions"]:
        out += [f"decision {d['id']} has no {k}" for k in ("q", "a", "evidence", "tradeoff") if not d.get(k)]
        if str(d.get("step")) not in step_ids:
            out.append(f"decision {d['id']} names unknown step {d.get('step')}")
    steps = data["story"]["steps"]
    if not 7 <= len(steps) <= 9:
        out.append(f"story has {len(steps)} steps, want 7 to 9")
    out += [f"story names unknown node {s['node']}" for s in steps if s["node"] not in nodes]
    for a, b in itertools.pairwise(steps):
        if a["node"] in nodes and b["node"] in nodes and not connected(data["edges"], a["node"], b["node"]):
            out.append(f"story goes from {a['node']} to {b['node']}, which no edges connect")
    for s in data["steps"]:
        out += [f"step {s['id']} names unknown node {n}" for n in s["nodes"] if n not in nodes]
    for x in data["next"]:
        out += [f"next {x['id']} touches unknown node {n}" for n in x["touches"] if n not in nodes]
    return out


def load() -> dict:
    """The YAML with code constants filled in, and each node's `since` derived from the steps.

    A node with no `primary` gets the kind most of its requirements have (functional on a tie)."""
    data = fill(yaml.safe_load((HERE / "journey.yaml").read_text()))
    found = problems(data)
    if found:
        raise ValueError("journey.yaml is inconsistent:\n  " + "\n  ".join(found))
    kinds = {r["id"]: r["kind"] for r in data["requirements"]}
    for n in data["nodes"]:
        n["since"] = min(s["id"] for s in data["steps"] if n["id"] in s["nodes"])
        if "primary" not in n:
            fr = sum(kinds[r] == "functional" for r in n["meets"])
            n["primary"] = "fr" if fr * 2 >= len(n["meets"]) else "nfr"
    return data


def _node_md(data: dict, n: dict) -> str:
    reqs = {r["id"]: r for r in data["requirements"]}
    built = [str(s["id"]) for s in data["steps"] if n["id"] in s["nodes"]]
    nxt = [f"{x['id']} {x['title']}" for x in data["next"] if n["id"] in x["touches"]]
    lines = [
        f"### {n['label']}",
        "",
        f"Layer: {n['layer']}. Built in step {n['since']}; changed in steps {', '.join(built)}.",
        "",
    ]
    lines += [f"- What it does: {n['what']}", f"- Always true: {n['invariant']}"]
    if n.get("limits"):
        lines.append("- Limits: " + "; ".join(n["limits"]))
    lines.append("- Meets: " + "; ".join(f"{i} ({reqs[i]['label']})" for i in n["meets"]))
    lines.append("- Trade-offs:")
    lines += [f"  - {t}" for t in n["tradeoffs"]]
    lines += [f"- Breaks first: {n['breaks']}", f"- At scale: {n['scale']}"]
    if nxt:
        lines.append("- Next steps touching it: " + "; ".join(nxt))
    return "\n".join(lines) + "\n"


def markdown(data: dict) -> tuple[str, dict[str, str]]:
    """The whole document, and each node's section on its own (for the page's copy button)."""
    labels = {n["id"]: n["label"] for n in data["nodes"]}
    sections = {n["id"]: _node_md(data, n) for n in data["nodes"]}
    out = [f"# {data['title']}", "", data["subtitle"], "", "## Requirements", ""]
    out += ["| Id | Kind | Requirement | Met by |", "| --- | --- | --- | --- |"]
    for r in data["requirements"]:
        by = ", ".join(n["label"] for n in data["nodes"] if r["id"] in n["meets"])
        out.append(f"| {r['id']} | {'FR' if r['kind'] == 'functional' else 'NFR'} | {r['text']} | {by} |")
    out += ["", "## One question, in a straight line", ""]
    out += [f"{i}. {x['text']} ({x['where']})" for i, x in enumerate(data["flow"], 1)]
    out += ["", "## How citations work, end to end", ""]
    out += [f"{i}. **{x['title']}.** {x['text']} ({x['where']})" for i, x in enumerate(data["citations"], 1)]
    out += ["", "## Decisions and lessons, at a glance", ""]
    for d in data["decisions"]:
        out += [
            f"### {d['q']}",
            "",
            d["a"],
            "",
            f"- Evidence: {d['evidence']}",
            f"- Trade-off: {d['tradeoff']}",
            f"- Built in step {d['step']}",
            "",
        ]
    out += [
        "",
        "## Five ways to think about it",
        "",
        "Model quality is one of five. Each fails differently.",
        "",
    ]
    for t in data["thinking"]:
        out += [f"### {t['name']}: {t['question']}", "", t["plain"], ""]
        out += ["What we did:"] + [f"- {x}" for x in t["here"]]
        if t.get("numbers"):
            out += ["", "The numbers, and why:"] + [f"- {n['what']}: {n['why']}" for n in t["numbers"]]
        out += [
            "",
            f"How it fails: {t['fails']}",
            "",
            f"How we check: {t['check']}",
            "",
            f"Gap: {t['gap']}",
            "",
        ]
    out += [f"- {x}" for x in data["threads"]]
    out += ["", "## Parts, by layer", ""]
    for layer in dict.fromkeys(n["layer"] for n in data["nodes"]):
        out += [f"Layer: {layer}", ""]
        out += [sections[n["id"]] for n in data["nodes"] if n["layer"] == layer]
    out += ["## Connections", ""]
    out += [f"- {labels[e['from']]} to {labels[e['to']]}: {e['label']}" for e in data["edges"]]
    out += ["", "## One request", "", data["story"]["title"], ""]
    out += [f"{i}. {labels[s['node']]}: {s['text']}" for i, s in enumerate(data["story"]["steps"], 1)]
    out += ["", "## How it was built", ""]
    for s in data["steps"]:
        out += [
            f"### Step {s['id']}, {s['when']} on 7 Nov: {s['title']}",
            "",
            f"- Before: {s['A']}",
            f"- After: {s['B']}",
        ]
        out.append(f"- Why: {s['why']}")
        if s.get("found"):
            out.append(f"- Found: {s['found']}")
        if s.get("rejected"):
            out.append("- Turned down: " + " ".join(s["rejected"]))
        out += [f"- Breaks next: {s['breaks']}", ""]
    out += ["## What comes next", ""]
    for x in data["next"]:
        out += [
            f"### {x['title']}",
            "",
            f"- Problem: {x['problem']}",
            f"- Build it when: {x['trigger']}",
            f"- Why not yet: {x['why_not_yet']}",
            f"- Before: {x['A']}",
            f"- After: {x['B']}",
        ]
        out += ["- Touches: " + ", ".join(labels[t] for t in x["touches"]), ""]
    return "\n".join(out).rstrip() + "\n", sections


def render_markdown() -> str:
    return markdown(load())[0]


def render() -> str:
    data = load()
    full, sections = markdown(data)
    data["md"] = {"all": full, "nodes": sections}
    payload = json.dumps(data, ensure_ascii=False).replace("</", "<\\/")
    return (HERE / "journey.template.html").read_text().replace("/*DATA*/null", payload)


def main() -> int:
    missing = commits_exist(yaml.safe_load((HERE / "journey.yaml").read_text()))
    if missing:
        print("commits not in git history:", ", ".join(missing))
        return 1
    outputs = {HERE / "journey.html": render(), HERE / "architecture.md": render_markdown()}
    if "--check" in sys.argv:
        stale = [p.name for p, text in outputs.items() if not p.exists() or p.read_text() != text]
        if stale:
            print("out of date:", ", ".join(stale))
        return 1 if stale else 0
    for path, text in outputs.items():
        path.write_text(text)
        print(f"wrote {path.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
