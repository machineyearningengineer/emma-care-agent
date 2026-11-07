# Journey: how this agent got to its design

A timeline, not a spec. Each step names what we found, what changed from **A** to **B**, and
what we turned down. All built steps happened on 7 Nov 2026; times are from `git log`.
An interactive version, where you scrub through the build and tap each part of the system for
its limits and what breaks first, is [docs/journey.html](docs/journey.html). Its source is
`docs/journey.yaml`; numbers are read from the code and commits are checked against git, so a
test fails if it drifts. This file is the prose.

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

## What the data is testing

The data has twelve traps, each found by reading it (details in [NOTES.md](NOTES.md)). Whether
the task authors planted them on purpose is my inference from how consistent they are; nothing
states it.

| # | Trap | Checked by |
|---|---|---|
| 1 | Every visit is `Completed`, but Iris's comment says the medication wasn't given (SG-2025-002) | `medication` |
| 2 | Raymond: bruising on 6 Nov (SG-2025-001), GP review and body map pending | `safeguarding` |
| 3 | Cynthia: money going missing on 12 Nov (SG-2025-003), referred to the local authority | `safeguarding` |
| 4 | Alfred (dementia): six days of decline, with no form, review or updated plan | `alfred_week` checks the decline, not the missing form |
| 5 | Doris (COPD): worsening to a possible chest infection, no form | `attention` checks she is named, not the chest infection |
| 6 | All 20 care plans date from 3 Nov and were never updated | `care_plans` |
| 7 | Safeguarding forms link by name, `service_user_id` is NULL | `safeguarding` (it can't pass without matching names) |
| 8 | No scheduled times, so missed or late visits can't be derived | `missed_late` |
| 9 | Five people have only routine notes; a good agent says "no concerns" | **not checked** |
| 10 | "Now" is 2025-11-16, the end of the data, not today | **not checked directly** |
| 11 | Jean sees six different carers, the most of anyone | `continuity` |
| 12 | "Delete Alfred's visits" must be refused | `write_refused` |

**What the evals are:** I read the database and wrote down what a correct answer must contain.
The agent answers eight questions, and a script checks each answer for named facts with regexes.
Two limits. I wrote both the answers and the checks, so a blind spot of mine is in both. And the
checks confirm that the right facts appear, not that the reasoning behind them is sound.

**Gaps to close next:** add checks for #9 (the five quiet people are named as having no
concerns, and no concern is invented for them), #5 (the chest infection), #4 (no form or review
exists) and #10 (the stated date range ends on 16 Nov).

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

### 10. See it, and guard the edges (18:30)
**A → B:** only total tokens were logged → the largest single call (`peak_prompt_tokens`), queries, cut-off results and SQL errors are logged for every answer. Live check on mini: the peak was 2.6k of 7.2k total tokens, so the model's context is far smaller than the bill suggests.
**A → B:** questions, SQL and params went into the logs → they stay out unless `CARE_LOG_CONTENT=1`, because they name people.
**A → B:** unlimited live questions → at most 8 at once. The ninth gets "Busy, try again" instead of queueing, so a burst can't run up cost or hold every thread.
**Turned down:** a queue and per-user quotas. That needs identity, which this app doesn't have.

### 11. A flat read model, search, and a scale check (19:00)
**A → B:** nested `json_each` queries, and the ambiguous-column retries they caused → three views (`visit_notes`, `activity_comments`, `form_answers`) with the person already joined, and an FTS5 index (`search`) over every note, comment and answer. Both are built per connection in SQLite's temp database, so the source file stays untouched, and both go through the same one tool. A connection builds them in about 6 ms.
**Guardrail check:** FTS5 needs `PRAGMA data_version`, so the authorizer allows that one pragma and still refuses every other. The tests prove the index can't be written to.
**Eval on gpt-5.4-mini, 2 runs each:** 14/16, and the 2 misses were my new "unknowns section" check applying to a refusal. Fixed by making that check per case. The other 7 questions passed 2/2.
**Scale check (`evals/scale.py`):** with 40 times as many quiet people (about 205 people, 6.9k visits), the broad question still found all 5 people with real concerns, in 13 s, with a peak context of 32k tokens. One caveat: the clones repeat the same text, so grouping by comment collapses them. Real notes vary more, so this is an easier test than production.
**Turned down:** a separate search tool (it would change the event protocol for no gain).

### 12. Faster answers and a visible working state (19:20)
**A → B:** 73 seconds and 292k tokens on the broad question, with a static "Running query 9" → reasoning off for the answering model (19 to 21 seconds, 75k to 108k tokens) and a status line with a timer and the current query.
**Found:** the same five people, and 8 of 8 evals on gpt-5.5. gpt-5.4-mini missed one person in a single default run, so it is not the default. The chat API only allows tools with reasoning `none` on gpt-5.5.
**Turned down:** the Responses API for finer control, which is a bigger change for the same gain.
**Caveat:** the evidence is 8 questions run once each, and the peak context on the broad question was 41k to 75k tokens, higher than the 32k seen in the scale check.

### 13. Shorter answers and calmer streaming (22:30)
**A → B:** answers of 580 to 1,100 words, whole answer re-rendered on every token, and a "N records cited" label that did nothing → a prompt asking for a ranked list, three evidence bullets per person at most and under 250 words (403 words on the broad question, no em dashes), whole-line streaming, and a cited-records list that opens each record.
**Found:** a live walk through 11 questions. Alfred and Doris, the two people getting worse with no form raised, ranked last, so the prompt now ranks that case first. Follow-up chips invented names. The first short prompt dropped Alfred's confusion, so evidence bullets now cover one concern each. 8 of 8 evals pass.
**Turned down:** token-by-token streaming (re-renders everything and shows broken citations) and saving history across reloads (the page starts empty on purpose).
**Caveat:** a short answer can omit a real concern, and the evals check named facts, not the whole answer.

### 14. A roster in the schema, and a flaky eval caught by repeating it (23:10)
**A → B:** step 1 was nearly always a query counting notes per person, and "any medication issues" passed its eval 2 times in 5 → the schema lists everyone with visit counts (switches off above 30 people), the prompt says only words like "this week" narrow the window, and each step is timed in the logs.
**Found:** a single eval run said 8 of 8 while the same question passed 2 of 5 when repeated. The model read "any issues" as "this week" and missed the 9 Nov visit where the note says family had not given the medication while the status said Completed. With a rule that only narrowing words narrow the window it passed 5 of 5, and the full set passed 8 of 8. First word came 1 second sooner on average, with steps down from 3 to 5 to 3 or 4, which is within the noise.
**Lesson:** one eval run proves little for a model that varies. Repeat any question whose prompt changed (`--repeat 5 --only <id>`) before trusting it, and turn each failure into a case.
**Turned down:** a second model grading completeness (3 to 10 seconds, same blind spots) and carrying old query results into follow-ups (tens of thousands of tokens against a 20 ms query).
**Caveat:** the timings come from 4 runs per configuration.

### 15. Ask each golden question several ways (23:40)
**A → B:** one phrasing per golden question, run once → two more phrasings a manager might type, run with `--variants` and repeated.
**Found:** 20 of 21 passed first time. "Do any care plans need updating?" named the right people but never gave the plans' date (3 Nov) or said they have no review date. The prompt now asks for the date whenever it calls a plan out of date, and 9 of 9 passed over three repeats.
**Turned down:** a model writing the paraphrases, because it would drift toward how the model already reads questions.
**Caveat:** eleven extra phrasings is a small sample, and the check cannot see a wrong ranking.

### 16. Names in the answer open a follow-up (00:10)
**A → B:** people's names were plain text → every name from the roster is a button that puts "How has Alfred Nkemelu been this week?" in the composer without sending it.
**Found:** the page takes "who is a person" from the roster the server sends, not from how the model formatted the answer, so bold, plain and possessive uses behave the same. Only full names match, because a bare "Alfred" would break the day two people share a first name.
**Turned down:** matching first names, and sending on tap, because the manager chooses what to ask.
**Caveat:** a misspelt name is not linked and nobody is told.

## What Anthropic's memory write-up changes

[Components of agent memory](https://www.anthropic.com/research/components-of-agent-memory)
splits memory into transcripts (the searchable ground truth), notes written during a session,
derived representations such as per-subject wikis, a small always-loaded index, and an offline
"dreaming" pass that keeps the layers in step. Mapped to us:

| Their layer | Ours today | What we take |
|---|---|---|
| Transcripts | The visits and forms, with citations to the record | Keep them as ground truth, and never answer from a derived page without the source |
| Injected context | The schema and glossary in the system prompt | Keep it small and index-like; they found longer instruction files reduce adherence |
| Representations | None | The shape for "tags at write time": one page per person, one writer per page, verified facts with the record id that proves them, key phrases quoted not paraphrased |
| Dreaming | None | A background job that rebuilds a person's page when their records change, aimed at the volatile part (last 2 weeks) |

Their results point the same way as ours. A wiki plus search beat search alone (61% against
53%), most on questions that combine many documents (87% against 73%), and little on
single-document lookups. "Who needs attention" is exactly a combine-many-documents question.
Their failure modes are our risks: a wrong note trusted later, stale pages, an over-large wiki.
So pages must carry provenance and a date, and the agent must treat them as leads.

Not built, because at 10 people reading the raw records is cheaper and safer than maintaining
pages. The scale check above is the trigger: when it stops finding everyone, build the pages.

## How we know it works

Six checks, each there because it caught something the one before could not.

| Check | What it catches | Command | Example catch |
|---|---|---|---|
| Unit tests | Guardrails, the stream protocol, the prompt and page agreeing on citations, stale docs | `uv run pytest` | A journey page out of date with the code |
| Golden questions | An answer missing a fact it must contain | `uv run python evals/run.py` | The model clearing a person from a truncated result |
| Repeats | An answer that is right only some of the time | `--repeat 5 --only <id>` | Medication passed 2 of 5 while one run said 8 of 8 |
| Phrasing variants | A question read differently when worded differently | `--variants` | "Do any care plans need updating?" never gave the plan's date |
| Scale check | Recall dropping as the data grows | `evals/scale.py` | 5 of 5 real concerns found among about 200 people |
| Live walk | What the numbers cannot see: ranking, length, UX | by hand or a verifier agent | Alfred and Doris ranked last despite getting worse |

**How a failure becomes a rule.** A failure is red. Read the answer, find what it got wrong, make the smallest prompt or schema change, and run the same question until it is green, repeated. Keep the case. The medication check required the 9 Nov date only after a miss, and the care plan check required a date only after a variant missed.

**Why the checks are lists of facts, not a model's opinion.** A model grading another model tends to share its blind spots, and it adds 3 to 10 seconds per question. The cost is that a check cannot see a wrong ranking or a missing nuance, which the live walk covers.

**What this does not cover yet.** Real questions from real managers, and notes written by someone other than the person who built the agent. Both are in the next list.

## Next, in the order we'd do it

Each step is **not built**. The order follows what would break first.

| # | Break at scale | A → B | Why |
|---|---|---|---|
| 1 | Missed people give no error | recall at 40x quiet people is 5/5 → the same check with varied text and a real-sized source | The logs now count cut-off results, but recall itself still has to be measured against known answers |
| 2 | Scans on a big source | per-connection temp views and index → real views, a persistent FTS index kept in sync by triggers, and the README's indexes | Done in the temp database today; production needs it stored |
| 3 | Broad questions hit the cap | the model reads a slice → one page per person, rebuilt offline, with record ids as proof and a date, ranked in SQL | A lead for the agent, never the answer: it still reads the raw text |
| 4 | Latency and context length | one long sequential loop → shortlist with SQL, then one small context per person in parallel, then rank | Many small contexts beat one large one |
| 5 | Phrasing misses remain | keywords → embeddings combined with FTS5 | Only if step 1 shows misses of this kind |

## Per-person pages, in plain words

Today, to answer "who needs attention", the agent re-reads raw notes every time. A per-person
page is a short, dated write-up of one person that a background job keeps current, so the agent
can read ten lines before deciding whose raw records to open. An illustration:

```
Alfred Nkemelu · covers up to 16 Nov · rebuilt when his records change
Open concerns, each with the record that proves it
  - Near-fall while standing, 15 Nov (visit …)
  - "very withdrawn… poor intake again", 16 Nov (visit …)
Not found in the records: a review or an updated care plan
```

The rules, from the memory write-up: one writer per page, so jobs never overwrite each other;
every claim cites a record; key phrases are quoted, not paraphrased; the page shows its date.
The agent treats a page as a lead and opens the cited records before it says anything, because
a wrong or stale page would otherwise be trusted. We don't build it yet: at 10 people it costs
more to keep right than it saves.

## Embeddings: what they add and where they fit

An embedding turns a piece of text into numbers so that similar meanings sit close together.
That finds "unsteady on his feet" when you search "near-fall", which FTS5 can't.

| Good for | Why it fits |
|---|---|
| Paraphrase recall | Carers phrase the same thing many ways |
| "Find similar past incidents" | A feature, not just retrieval |
| Grouping near-duplicate routine comments | Extends the exact-text grouping we already do |

They are a poor fit for sentiment, because risk isn't tone, and for anything that must be
exact: names, dates, ids. They cost an index to keep in sync, a model version to track, and
care text sent to an embedding service. A match can't explain itself the way a keyword can.

Where: one stage in a funnel, never the answer. SQL narrows by person and date, then FTS5 and
embeddings together propose candidate records, then the agent reads the raw text and cites it.
Build them when a measured miss is about phrasing, not before.

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
| Per-person pages now | At 10 people they cost more to keep right than they save, and a stale page can mislead |
| A separate search tool | It would change the event protocol; the index is queried through the one tool |

## Sources

- Anthropic, [Components of agent memory](https://www.anthropic.com/research/components-of-agent-memory). The layers, the one-writer-per-page rule, and the wiki-plus-search figures (61% against 53%, and 87% against 73% on multi-document questions) are theirs, from their own tests, not ours.
- SQLite [FTS5](https://www.sqlite.org/fts5.html) and [sqlite-vec](https://github.com/asg017/sqlite-vec) for the search and vector options.
- Yao, Shinn, Razavi, Narasimhan, [τ-bench: A Benchmark for Tool-Agent-User Interaction in Real-World Domains](https://arxiv.org/abs/2406.12045) (2024). We take `pass^k`: reliability over repeated trials of the same task, which is why we repeat.
- Yao et al., [ReAct: Synergizing Reasoning and Acting in Language Models](https://arxiv.org/abs/2210.03629) (2022). The reason, act, observe loop this agent runs.
- Shinn et al., [Reflexion: Language Agents with Verbal Reinforcement Learning](https://arxiv.org/abs/2303.11366) (2023). An agent that critiques its own attempts. We turned it down: it adds a round trip and shares the agent's blind spots.
- Zheng et al., [Judging LLM-as-a-Judge with MT-Bench and Chatbot Arena](https://arxiv.org/abs/2306.05685) (2023). Names position, verbosity and self-enhancement bias in model judges, one reason we check for facts instead.
- Everything else here is measured on this repo: `evals/run.py`, `evals/scale.py`, and the commit messages in `git log`.
