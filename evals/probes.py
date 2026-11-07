"""Run the probe questions and print each answer for a human to read.

uv run python evals/probes.py [--model gpt-5.5] [--only id,id]
"""

import argparse
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import yaml

from app.agent import ask

ap = argparse.ArgumentParser()
ap.add_argument("--model", default="gpt-5.5")
ap.add_argument("--only")
args = ap.parse_args()
probes = yaml.safe_load((Path(__file__).parent / "probes.yaml").read_text())
if args.only:
    probes = [p for p in probes if p["id"] in args.only.split(",")]
with ThreadPoolExecutor(max_workers=4) as pool:
    results = list(pool.map(lambda p: ask(p["q"], model=args.model), probes))
for p, r in zip(probes, results, strict=True):
    print(f"\n=== {p['id']}: {p['q']}\nEXPECT: {p['expect']}")
    print(f"--- {r['steps']} steps, {r['seconds']}s, {len(r['trace'])} queries")
    print(r["answer"])
