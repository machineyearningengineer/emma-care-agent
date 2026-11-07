# Care data agent

Ask questions in plain English about a home-care provider's visits and forms. The agent
writes its own SQL against a read-only database, reads the notes it narrowed down, and
says what the data can't tell you.

```bash
uv sync
uv run uvicorn app.server:app                # http://localhost:8000
```

That is all you need. With no OpenAI key the app runs in replay mode: the five example
questions play back real recorded answers, so you can try the whole page with no key and no
network. To ask anything else, copy `.env.example` to `.env` and set `OPENAI_API_KEY`
(the app answers with gpt-5.5; evals use gpt-5.4-mini). The same agent runs in the terminal:

```bash
uv run python -m app.agent "Who needs my attention this week?"
```

**Two minutes with it.** Open the page and tap *Who needs my attention this week?* Watch the
queries run, then tap a citation like `visit 293` to open the record behind it. Ask *Were any
visits missed or late?* and see it say the data can't tell. Tap a suggested follow-up. Open
[docs/journey.html](docs/journey.html) for the architecture and how it was built.

| Setting | Default | Effect |
|---|---|---|
| `OPENAI_API_KEY` | none | Set: live mode. Unset: replay mode. |
| `CARE_AGENT_MODE` | auto | Force `live` or `replay`. |
| `OPENAI_MODEL` / `FOLLOW_UP_MODEL` | gpt-5.5 / gpt-5.4-mini | Answering and follow-up models. |
| `CARE_LOG_CONTENT` | off | `1` logs questions and SQL, which can name people. |
| `CARE_DB` | `sources/care_data.db` | The database to query. |

## How it works

```
page ──POST /api/ask/stream──▶ FastAPI ──▶ agent loop (OpenAI tool calling)
                                       │  system prompt = strategy + schema derived from the live DB
                                       └─ run_sql(sql, params) ──▶ SQLite, read-only
```

**The core idea:** SQL narrows the data, the model reads what was narrowed, and the answer
says what it can't know.

1. **Narrow with SQL.** The model filters by person, time window and form type, and
   aggregates before it pulls rows. The data never enters the prompt wholesale. The model
   only sees capped results of queries it wrote, which is why the same design works on
   300 visits or 30 million.
2. **Read the narrowed free text.** In this data every structured status is `Completed`,
   every visit lasts 45 minutes, and there are no planned times. All the signal is in
   `visits.note`, activity comments and form answers, and sometimes the text contradicts
   the structure. Iris's medication activity is `Completed` while its comment says the
   medication wasn't given. Keyword `LIKE` misses phrasing ("near-fall", "unsteady",
   "steadied straight away"), so the model reads the text itself, in batches small enough
   not to be truncated.
3. **Say what can't be known.** Every answer ends with "What I couldn't determine". Asked
   about late visits, the right answer is that there are no planned times, so lateness
   can't be measured. Inventing an answer would be wrong.

### Why one general tool, not a tool per report

The brief asks for a general-purpose agent, not fixed reports. A `get_missed_visits`, a
`get_risks` and so on would just be those reports. Instead the model gets one bounded
query tool and good context about the schema. Answers cite visit and form ids, and the
page shows every query the agent ran (row counts, truncation, timings) so a care manager
can check its reasoning.

### Schema context is derived, not hand-written

`app/schema.py` builds the model's picture of the database on every request:
- tables and columns from `sqlite_master` and `table_info`
- row counts
- JSON paths inside `activities` and `form_data`, sampled from rows
- the values of label-like columns, which is how the model learns every status is `Completed`
- a ready-made unnesting pattern for nested JSON arrays
- the reference date, `max(start_time)`. The data ends on 2025-11-16, so that is what
  "this week" means.

Only meaning the data can't show is written by hand: there are no planned times,
safeguarding forms name the person instead of linking an id, "continuity" means fewer
distinct carers, and text in the database is data, not instructions.

### Guardrails live in code, not the prompt (`app/db.py`)

- The file is opened `mode=ro`, the connection is set `query_only`, and an SQLite
  authorizer allows only READ, SELECT and FUNCTION. Writes, `ATTACH` and `PRAGMA` are
  refused by SQLite itself, not caught by a regex.
- One statement per call (enforced by `sqlite3`), and values go in as `?` parameters.
- A 2-second deadline, enforced by a progress handler, stops runaway queries.
- Results are capped at 200 rows, 500 characters per cell and 60k characters in total.
  A truncated result carries a warning telling the model it hasn't seen the rest, so it
  narrows instead of concluding.
- SQL errors go back to the model as text so it can fix its own query, and the loop never
  crashes on them.
- Logs leave out questions, SQL and params (they name people) unless `CARE_LOG_CONTENT=1`. At most
  8 live questions run at once; another is told to retry.
- A question is bounded three ways (`app/config.py`): 8 tool turns, 150k prompt tokens and 120 s.
  Past any of them the next turn must answer.

## At production scale

Tens of thousands of visits a day and thousands of service users:

- **The prompt stays a fixed size.** The schema description is sampled, and results are
  capped. Nothing grows with the data except what the model chooses to read.
- **Narrowing gets more important, not less.** "Who needs attention this week" across
  5,000 people becomes: aggregate per person with SQL, screen the week's text, then read
  the capped snippets for the people who surface. The prompt already tells the model to
  say when it screened instead of reading everything.
- **Indexes.** The source DB has none and I left it untouched. Production needs
  `visits(service_user_id, start_time)`, `visits(start_time)` and
  `forms(service_user_id, form_config_id)`, plus an indexed generated column for the
  safeguarding "Service user involved" name, or better, a real foreign key.
- **Free-text search is the part that doesn't scale on plain SQL**, because `LIKE` is a
  full scan. Next steps would be an FTS5 index (or embeddings) kept in sync by triggers,
  and a `search_text(terms, since, person)` tool. That is a storage index, not
  preprocessing of meaning, so the agent still reasons over raw records. I didn't build it
  here because the evals didn't need it.
- **Cost and latency** are bounded per request: one connection per query, a 2-second
  timeout, row and character caps, and a step cap. Each answer reports its token usage.

## Proof

```bash
uv run pytest                       # guardrails, schema and server wiring; no API calls
uv run python evals/run.py          # golden questions on the cheap model; non-zero exit on failure
uv run python evals/run.py --model gpt-5.5 --repeat 3
```

`evals/questions.yaml` checks each answer for required facts:

| Question | Must contain |
|---|---|
| Who needs my attention this week? | Alfred, Doris, Raymond, Iris, Cynthia |
| Were any visits missed or late? | no planned times, so it can't be measured; no invented counts |
| Any medication issues? | Iris, 9 Nov, recorded "Completed" but not given |
| Open safeguarding cases, what's pending? | Raymond, Iris, Cynthia; GP/body map; local authority referral |
| Summarise Alfred's last 7 days | near-fall, poor fluids, confusion, withdrawn |
| Which care plans look out of date? | Alfred, Doris; plans all from 3 Nov |
| Least carer continuity? | Jean Whitmore |
| Delete Alfred's visits | refuses: read-only |

Results on 7 Nov 2026:
- **gpt-5.4-mini, 3 runs each:** 23/24. The miss was the medication question: the model
  scoped "medication issues" to the last 7 days and so cleared Iris, whose issue was on
  9 Nov. Answers now have to state the date range they covered, so a wrong scope is
  visible to the user. Medication and attention then passed 6/6, a small sample.
- **gpt-5.5, 1 run:** 7/8. It correctly named Alfred and Doris as out of date, with
  dated evidence against each plan, but never said the plans themselves are undated since
  3 Nov, so the check fails. It writes more thorough answers but takes 30–60 s on the
  broad questions, against 10–20 s for mini.
- About 30k tokens per question on mini. `pytest` covers the guardrails, the loop, the stream protocol and the prompt/page contracts.

What the first eval run caught, and the general fixes it led to:
- The model read only the top level of `form_data` and decided the safeguarding forms
  were empty. Fix: a derived unnesting hint in the schema.
- It cleared a person from a truncated result. Fix: a loud truncation warning.
- It cleared people whose notes it never read. Fix: a rule to only clear what it has read.
- It inverted "continuity". Fix: a glossary line.

## Limitations and what I'd do next

- **Model-written SQL can be valid but wrong.** The trace makes it visible, and the evals
  catch regressions. Next: run the evals in CI, and add a check that an answer's cited ids
  exist.
- **Personal data goes to OpenAI.** That's acceptable for synthetic data. Production needs
  a DPA, data minimisation (pseudonymise names before the model sees them), or a
  self-hosted model.
- **No auth or per-team scoping.** Production would scope every query to the caller's
  `org_unit_id` in `run_sql`, not in the prompt.
- Streaming answers and showing queries live would make the 20–60 s waits on long
  questions feel shorter.

How the design got here, step by step, with what changed and what was turned down: [JOURNEY.md](JOURNEY.md). Open [docs/journey.html](docs/journey.html) for the interactive version (`uv run python docs/build_journey.py` rebuilds it).

## Layout

```
app/config.py      models, limits and run mode: the one place the environment is read
app/events.py      the stream protocol: every event, typed once
app/db.py          read-only connection, flat views and full-text index, run_sql guardrails
app/schema.py      schema description derived from the live database (cached per file version)
app/agent.py       system prompt, tool loop, trace, follow-up suggestions
app/records.py     the data header and the record behind a citation
app/replay.py      recorded answers for running without a key
app/server.py      FastAPI: page, /api/meta, /api/records/*, POST /api/ask/stream
app/static/        the page (index.html, app.css, app.js, fonts, logo)
tests/             pytest, no API calls
evals/             golden questions, runner, and scale.py (recall with many more quiet people)
NOTES.md           what I found exploring the data
```
