"""Run the golden questions against the agent and check required facts.

uv run python evals/run.py [--model gpt-5.5] [--repeat N] [--only id,id]
Exit code is non-zero if any check fails.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import yaml

sys.path.insert(0, str(Path(__file__).parent.parent))
from app.agent import ask

EVAL_MODEL = "gpt-5.4-mini"  # cheap by default; pass --model gpt-5.5 to check the app's model

HERE = Path(__file__).parent


def check(case: dict, answer: str) -> list[str]:
    missing = [p for p in case.get("must", []) if not re.search(p, answer, re.I)]
    present = [f"NOT {p}" for p in case.get("must_not", []) if re.search(p, answer, re.I)]
    return missing + present


def run_one(case: dict, model: str) -> dict:
    try:
        r = ask(case["question"], model=model)
    except Exception as e:  # report API failures as failures, never hide them
        return {"id": case["id"], "failures": [f"error: {e}"], "answer": "", "trace": []}
    return {"id": case["id"], "failures": check(case, r["answer"]), **r}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", default=EVAL_MODEL)
    ap.add_argument("--repeat", type=int, default=1)
    ap.add_argument("--only")
    args = ap.parse_args()

    cases = yaml.safe_load((HERE / "questions.yaml").read_text())
    if args.only:
        cases = [c for c in cases if c["id"] in args.only.split(",")]
    jobs = [c for c in cases for _ in range(args.repeat)]
    with ThreadPoolExecutor(max_workers=6) as pool:
        results = list(pool.map(lambda c: run_one(c, args.model), jobs))

    tokens = 0
    for c in cases:
        runs = [r for r in results if r["id"] == c["id"]]
        passed = sum(not r["failures"] for r in runs)
        tokens += sum(sum(r.get("usage", {}).values()) for r in runs)
        print(f"{'PASS' if passed == len(runs) else 'FAIL'}  {passed}/{len(runs)}  {c['id']}")
        for r in runs:
            if r["failures"]:
                print(f"        missing: {r['failures']}")
    total = sum(not r["failures"] for r in results)
    print(f"\n{total}/{len(results)} passed on {args.model}, {tokens:,} tokens")
    (HERE / "last_run.json").write_text(json.dumps(results, indent=2, ensure_ascii=False, default=str))
    sys.exit(0 if total == len(results) else 1)


if __name__ == "__main__":
    main()
