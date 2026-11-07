# Journey: how this agent got to its design

A timeline, not a spec. Each step names what we found, what changed from **A** to **B**, and
what we turned down. All built steps happened on 7 Nov 2026; times are from `git log`.
The design itself is in [README.md](README.md) and the data findings in [NOTES.md](NOTES.md).

## What kind of agent this is

An agent is a **model** that picks its own next action, **tools** it can call, and a **loop**
that feeds results back until it answers. This is one, and a small one.

| Part | Here |
|---|---|
| Model | gpt-5.5 answers. gpt-5.4-mini only suggests follow-ups, outside the loop. |
| Tool | One: `run_sql`, a read-only `SELECT`. |
| Loop | `ask_stream`: plan a query, run it, read the result, repeat. At most 9 model turns. |
| Workspace | The read-only database. No memory beyond the 6 messages the page sends back. |

The model decides which queries to run, how many, and when to stop. It cannot act: no writes,
no messages. That makes it an analyst more than an assistant, on purpose. It is not
multi-agent and has no planner or self-check. An agent SDK would add tracing, not
"agent-ness", so the 100-line loop stays hand-rolled.

## Built

### 0. Look at the data first (16:05)
**Found:** every visit is `Completed`, 45 minutes, with no planned time. All the risk is in free text, and sometimes the text contradicts the status (Iris's medication). Safeguarding forms name the person instead of linking an id.
**A → B:** "answer from structured fields" → "answer from free text, and say what the records can't show". Lateness can't be measured, so the right answer is that it can't.
**Turned down:** counting statuses. They carry no signal.

### 1. Safety in the database, not the prompt (17:01)
**A → B:** a prompt that asks for read-only → SQLite refuses everything but bounded reads: `mode=ro`, `query_only`, an authorizer, a 2 s deadline, one statement per call.
**Why:** a prompt is a request and an authorizer is a guarantee. **Turned down:** one tool per report (`get_missed_visits`…), because that is the fixed-reports design the brief asks us to avoid, and a regex filter on SQL.

### 2. The schema is derived, not written (17:02)
**A → B:** a hand-written schema in the prompt → built per call from `sqlite_master`, row samples and JSON paths. The glossary holds only meaning the data can't show.
**Why:** it can't go stale, and it showed the model that every status is `Completed`. **Turned down:** a `describe_schema` tool, which costs a round trip every question.

### 3. Results are bounded, and cuts are loud (17:02, 17:12)
**A → B:** unbounded results → 200 rows, 500 characters per cell and 60k per result, with a `truncated` flag and a warning.
**Why:** 200 rows of long notes is about 25k tokens per call. **A review found three gaps:** a 400 MB `zeroblob`, cut cells with no flag, and a blob that crashed `run_sql`. Each was fixed. A hard timeout on native calls would need a subprocess, which we skipped.

### 4. The loop and its trace (17:04)
**A → B:** an answer with no visible reasoning → every query is recorded with rows, truncation and timing, and the loop stops after 8 tool turns.
**Found:** the first live run caught 3 of 5 people. The model read a few people's notes and claimed it had checked everyone. **Fixed with two rules:** read in batches so nothing is cut, and clear only people whose text was read.

### 5. Evals decide, not eyeballs (17:07)
**A → B:** judging by reading → 8 golden questions that must contain named facts, run in parallel, with a failing exit code.
**Found:** the first run failed 3 of 8, giving four general fixes: an unnest hint for nested JSON, the truncation warning, a continuity definition, and "no window named = all data".
**Found later:** mini scoped "medication" to 7 days and cleared Iris, so answers now state the date range they covered.

### 6. A page, then streaming (17:08 to 17:20)
**A → B:** a blank wait of 20 to 60 s → each query and the answer appear as they happen.
**Why:** `ask_stream` is the single implementation of the loop; `ask()` just collects its result. Text written next to tool calls is sent and then followed by `discard`. **Turned down:** a front-end framework, and a markdown library (so the renderer escapes first).

### 7. Observability and cost (17:26 to 17:32)
**A → B:** no ids and no cost view → request ids, JSON logs, token usage, cache-hit measurement and a 150k prompt-token budget.
**Found:** the broadest question used 122k prompt tokens in total on gpt-5.5, because each step re-sends the conversation.
Replay mode records real answers so the app runs with no key.

### 8. Trust in the interface (17:32 to 17:49)
**A → B:** a text answer → citations that open the source record, an "unknowns" box, follow-up chips, retry that replaces the failed turn, and Emma's palette and logo.
**Found:** "(visit 327, 2025-11-12)" turned the date into buttons, and a long placeholder suggestion clipped in the input.

### 9. Untangle audit (18:09)
**A → B:** hidden links → one `config.py`, one typed event protocol (`events.py`), SQL out of the server (`records.py`), a wall-clock bound, a prompt version hash, and strict `(visit 12)` citations.
**Found:** `.env` was only loaded because the agent module happened to import first, and `mode()` was read three times per request.

## Next, in the order we'd do it

Each step is **not built**. The order follows what would break first.

| # | Break at scale | A → B | Why |
|---|---|---|---|
| 1 | We can't see it | totals only → per-call prompt tokens, truncation rate, a recall eval on a 100x synthetic set | Missed people give no error, so recall has to be measured |
| 2 | SQL mistakes and scans | nested JSON → a flattened view (one row per note or comment) plus the README's indexes | Fewer retries, fewer steps |
| 3 | Free text is a scan | `LIKE` → FTS5, returning ids and snippets | Exact names and phrases, cheap and explainable |
| 4 | Broad questions hit the cap | the model reads a slice → tags added when records are written (fall, intake, medication, mood), ranked in SQL | An index to narrow, never to answer: the agent still reads the raw text |
| 5 | Latency and context length | one long sequential loop → shortlist with SQL, then one small context per person in parallel, then rank | Many small contexts beat one large one |
| 6 | Phrasing misses remain | keywords → embeddings combined with FTS5 | Only if step 1 shows misses of this kind |

## Transcripts

This data has none, and the design stays focused on it. Emma pitches "one meeting at a time", so
it is likely in their product. It would be a new source table:
- **Unit:** a speaker turn with a timestamp, linked to a person and a meeting.
- **Retrieval:** search small segments, then read the turns around each hit.
- **Citation:** `(meeting 7, 12:31)`, which opens the transcript at that moment.
- **Summaries:** chapter titles for navigation only, never evidence.
- **"What was decided about X?":** one small context per segment group, then reduce with citations.

## SQLite or Postgres

SQLite is enough for the agent. It has FTS5, JSON functions, window functions, WAL for
concurrent readers, and vector search through `sqlite-vec`. A year at 30k visits a day is
roughly 10 GB, which SQLite handles for reads.

Postgres would be for things around the agent: many writers ingesting at once, tenant
isolation (row-level security), replicas and failover, managed backups. If we move, the
guardrails change shape: the SQLite authorizer becomes a read-only role plus
`statement_timeout` and a `LIMIT` wrapper, in `db.py` only.

## Turned down, and why

| Idea | Why not |
|---|---|
| Summarise records before retrieval | The signal is a phrase; summaries lose it, and the user needs the real record |
| Tool per report | Fixed reports again |
| RAG or a vector database now | No measured phrasing misses; FTS5 comes first |
| Embeddings for sentiment | Risk isn't sentiment: "declined fluids" isn't negative in tone |
| An agent SDK | The loop is 100 lines, and the budget logic stays visible |
| Server-side sessions or memory | The page sends 6 messages; stateless scales, and memory is a case-management feature |
| Subprocess for hard native timeouts | A length limit covers the real risk here |
| Postgres now | SQLite does everything the agent needs |
