# Care data agent: notes for coding agents

A FastAPI app where a model answers questions about a care database by writing read-only SQL.
Design and history: README.md, JOURNEY.md, docs/journey.html. Data findings: NOTES.md.

## Run and check

```bash
uv sync
uv run uvicorn app.server:app                 # no key needed: replay mode plays recorded answers
uv run ruff check . && uv run ruff format --check . && uv run pytest -q    # free, about 4 s
npx oxlint app/static                         # the page's JS
uv run python evals/run.py                    # paid: live model, cheap by default
uv run python evals/scale.py                  # paid: recall with many more quiet people
```

## Rules that aren't obvious

- `app/config.py` is the only place that reads the environment and holds limits. Don't read `os.environ` elsewhere.
- Safety lives in `app/db.py` (SQLite read-only, authorizer, caps), never in the prompt. Don't loosen it.
- Stream events are defined in `app/events.py`. Change the type, the emitters and the page together.
- Citations are exactly `(visit 12)` or `(form 4)`. The prompt, `app/static/app.js` and a test depend on it.
- After changing a limit or `docs/journey.yaml`, run `uv run python docs/build_journey.py`; a test fails if the page is stale.
- Live runs cost money and read `.env`. Use `CARE_AGENT_MODE=replay` when you only need the app to run.
- `sources/` is the task brief and data. Don't edit it.
