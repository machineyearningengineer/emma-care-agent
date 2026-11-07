# Start here

One path, in order. Stop after any step; each one stands alone.

## Read in this order (about 40 minutes)

1. **Watch it work (3 min).** `uv run uvicorn app.server:app`, open http://localhost:8000, ask
   "Who needs my attention this week?" Tap a citation. Tap a name.
2. **Watch one question go end to end (3 min).** Open `docs/flow.html` and press Play: nine steps from the
   keyboard to a tapped citation, with the real data at each step.
3. **Straight line and citations (5 min).** The first two sections of `docs/journey.html`: the same flow in
   words, then how a citation gets from a database row to a button.
4. **The short version (5 min).** Next section: every decision with its answer, evidence and
   trade-off. This is the cheat sheet.
5. **Press Story (3 min).** Same page. It walks one question from the browser to the database and back.
6. **Five ways to think about it (7 min).** Same page. The model is one layer of five. Open one at a time.
7. **Run the demo (5 min).** `DEMO.md`: happy path, medium path, honest negative, trap, refusal.
8. **How it was built (optional).** The step cards on the journey page, or `JOURNEY.md` as plain text.

If you only have 5 minutes: steps 1 and 2.

## One question, in a straight line

1. You type a question in the page (`app/static/app.js`).
2. `POST /api/ask/stream` (`app/server.py`) checks it and starts the agent.
3. The agent (`app/agent.py`) sends the model the question plus a prompt that already holds the
   schema, the list of people and a glossary (`app/schema.py`).
4. The model calls its one tool, `run_sql`, as many times as it needs (up to 8).
5. `run_sql` (`app/db.py`) runs a read-only query with caps on rows, size and time, and returns rows.
6. The answer streams back as lines of JSON (`app/events.py`): queries, results, text.
7. The page shows the text, turns `(visit 12)` into buttons, and opens records from
   `/api/records/visit/{id}` and `/api/records/form/{id}` (`app/records.py`).

**Citations, in one breath:** each row the model reads has its record's id, the prompt asks for `(visit 12)`
or `(form 4)`, the page turns each match into a button, a tap fetches the record and shows it beside the
sentence it supports. Full chain: journey page, "How citations work, end to end".

## Where things are

| You want to change | Open |
|---|---|
| What the model is told | `SYSTEM` in `app/agent.py` |
| What the model knows about the data | `app/schema.py` |
| Limits (rows, size, steps, time) | top of `app/db.py` and `app/agent.py` |
| Safety (read-only) | `app/db.py` |
| The page | `app/static/` (`index.html`, `app.js`, `app.css`) |
| Demo answers with no key | `app/replays.json`, rebuilt by `uv run python -m app.replay record` |
| Golden questions | `evals/questions.yaml` |
| Realistic probe questions | `evals/probes.yaml` |
| Eval results and lessons | `evals/RESULTS.md` |
| The journey page | `docs/journey.yaml`, then `uv run python docs/build_journey.py` |

## Commands

| Do | Run |
|---|---|
| Start the app | `uv run uvicorn app.server:app --reload --port 8000` |
| Tests (4 s, no key) | `uv run pytest` |
| Evals on the app's model | `uv run python evals/run.py --model gpt-5.5 --repeat 2 --variants` |
| Probe questions to read by hand | `uv run python evals/probes.py` |
| Lint | `uv run ruff check . && uv run ruff format .` |
| Rebuild the journey page | `uv run python docs/build_journey.py` |

## The other files, one line each

- `README.md`: setup, config and the design in prose.
- `DEMO.md`: the talk track and likely questions.
- `JOURNEY.md`: the build story as text (same content as the journey page).
- `NOTES.md`: what the data looks like and what it can't tell you.
- `AGENTS.md`: instructions for a coding agent working in this repo.
- `sources/TASK.md`: the original task. `sources/care_data.db`: the data.
- `docs/architecture.md`: generated from the journey. Don't edit it.
