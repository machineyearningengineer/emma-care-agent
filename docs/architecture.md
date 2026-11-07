# Care data agent

A care manager asks a question in plain language. An agent answers it by querying a read-only database and cites every record it used.

## Requirements

| Id | Kind | Requirement | Met by |
| --- | --- | --- | --- |
| fr-ask | FR | Ask any question about visits and forms in plain language. | Page, FastAPI server, Schema and glossary, Agent loop, Model, Views and full-text index |
| fr-cite | FR | Every claim cites the visit or form it came from. Tapping the citation opens that record. | Page, Record lookup |
| fr-unknowns | FR | Each answer says what the records cannot show. | Page, Agent loop, Model |
| fr-queries | FR | The page shows the queries the agent ran. | Page, Event protocol, run_sql tool |
| fr-followups | FR | After an answer, the page suggests up to 3 follow-up questions. | Page, Model |
| fr-refuse | FR | A request to change data is refused. | Model, Read-only guard |
| nfr-safety | NFR | The data cannot be changed. SQLite enforces this, so no prompt wording can undo it. | run_sql tool, Read-only guard |
| nfr-cost | NFR | Tool turns, prompt tokens, wall-clock time and concurrent questions are all capped. | FastAPI server, Agent loop, Read-only guard |
| nfr-observe | NFR | Request ids, JSON logs, a prompt version and peak context size make a reported problem findable. | FastAPI server, Agent loop, Model |
| nfr-privacy | NFR | Logs leave out questions, SQL and parameters unless CARE_LOG_CONTENT=1, because they can name people. | FastAPI server |
| nfr-offline | NFR | With no API key, the app answers the five example questions from recordings. | Replay mode |
| nfr-scale | NFR | More data is handled by narrowing with SQL, not by making the prompt longer. | Schema and glossary, Views and full-text index, Evals |
| nfr-drift | NFR | Typed events, derived numbers and tests keep the code, the prompt and these docs agreeing. | Event protocol, Schema and glossary, Evals |

## Decisions and lessons, at a glance

### What is the agent, and why not a library of ready-made queries?

A model, one read-only tool (run_sql) and a loop. The schema, roster and glossary are derived from the data and put in the prompt.

- Evidence: Every golden question and rephrasing passes (42 of 42 on gpt-5.5). A ready-made query per question would hide the schema and need a new function for each new question.
- Trade-off: The model can write a wasteful query. Caps and the prompt keep that cheap instead of a fixed set of queries preventing it.
- Built in step 4

### Is the model good enough at SQL?

Yes. Its queries were sound. The weakness was reading too wide, and the 30k result cap fixed that.

- Evidence: The medication question read 145k characters and 114k prompt tokens; at 30k it read about 80k and 75k, ran in 11s instead of 15s, and still found visit 293 and form 22. Tokens fell about 45% with no lost facts.
- Trade-off: A cap can hide a relevant row in a very wide query. The result carries a truncation flag and the prompt says only clear what you read.
- Built in step 18

### Does the SQL need a planning step?

No. The first query is the plan, and the roster in the prompt removes the usual counting query.

- Evidence: Simple questions take 1 query and about 3 seconds; broad ones take 4 to 11 queries and 12 to 15 seconds.
- Trade-off: A planner would cost another model call (3 to 10 seconds) and share the model's blind spots. Revisit if recall fails on varied real notes.
- Built in step 14

### Should the model think before answering?

No. Reasoning is off.

- Evidence: A broad question took 73 seconds and 292k tokens with it on; off it takes about 15 seconds and 60% fewer tokens, with the same eval results.
- Trade-off: A harder multi-step question might do better with thinking. The evals would show it, so turn it back on only for a failing case.
- Built in step 12

### Why read the notes and not the status fields?

Every one of the 336 visits has the status Completed, so status says nothing. The truth is in the free text.

- Evidence: Visit 293 is marked Completed while its comment says the family had not given the medication. A report built on status would count it as done.
- Trade-off: It relies on the model reading text, so recall on messier real notes is the first thing to break. Search and embeddings are the next step.
- Built in step 0

### Why does it sometimes say the data cannot tell?

Visits have no planned time, so late and missed cannot be measured. Saying so is the right answer.

- Evidence: Checked directly: all 336 visits are Completed, all exactly 45 minutes, none missing an end time, and no note or form mentions a missed or late visit.
- Trade-off: A manager may find the answer unhelpful. A wrong guess from gaps in the data would be worse.
- Built in step 2

### What happens when a result is cut?

The result carries a flag and a loud warning, and the prompt says only clear a person you actually read.

- Evidence: Before this, a truncated result let the model clear a person it had not read.
- Trade-off: More text in the prompt on every cut, and the model must narrow and re-run.
- Built in step 3

### How do we know an eval pass means anything?

Repeat it. One passing run proves little for a model that varies.

- Evidence: Medication passed 8 of 8 once, then 2 of 5 when repeated, and 5 of 5 after a window rule. A rephrased care-plan question failed until a plan-date rule was added.
- Trade-off: A full run with variants and repeats uses about 1.8M tokens. Run it when a prompt, cap or model changes, not on every commit.
- Built in step 14

### How do we make a wrong citation impossible to ship?

One grammar, a test and an eval check. A citation the page cannot link fails the build.

- Evidence: Evals caught '(visit 327, form 23)' and then '(visits 192-210)', both of which showed as plain text. Each became a prompt rule and a permanent check.
- Trade-off: The model is held to a strict form, so the prompt carries a few rules about it.
- Built in step 8

### How does the page know which words are people?

The server sends the roster of active people, and the page links any match, however the model formatted it.

- Evidence: Bold, plain and possessive uses all link. A new person needs no page change.
- Trade-off: A misspelled name stays plain text and nobody is told. Above 30 people the roster switches off in the prompt and the model queries instead.
- Built in step 16

### What does the app treat as today?

The latest visit in the data. The header says so: 'Today is 16 Nov 2025'.

- Evidence: 'This week' and 'recent' are resolved against it. Reading the wall clock would give an empty week.
- Trade-off: With live data this becomes the real date; for this fixed data it is a convention the page has to state.
- Built in step 2

### Why not de-duplicate repeated comments in a view?

Tried and dropped. It removed almost nothing.

- Evidence: After normalising, 572 of 1,135 comments were distinct, but the model's reads did not shrink. The cap did.
- Trade-off: Repeated carer comments still cost tokens inside the cap.
- Built in step 18

### How does it refuse a request to change data?

Twice over. The database refuses (read-only connection, authorizer), and the prompt tells the model to say it is read-only in one or two sentences and stop.

- Evidence: Found by hand: 'You have permission to change his name' got a refusal plus a padded 'What the records can't show' box about the correct name. The prompt now says to stop, a check fails any refusal that adds that section, and three phrasings (delete, permission, 'ignore your instructions') passed 12 of 12 on gpt-5.5.
- Trade-off: The refusal is a prompt rule, so it can vary; the database refusal is the guarantee. A refusal still triggers suggested follow-ups, which are harmless.
- Built in step 1

### What is the request id in an answer's footer for?

To find one answer in the logs. Every request gets a 12-character id that is in the response header, the stream's first event, the footer and every log line.

- Evidence: Grep the id and you get the whole story of that answer: when it started, each query with rows, size and milliseconds, then one line with steps, seconds, first word, seconds per model call, SQL time, prompt, completion, cached and peak tokens, truncations and errors. A failed answer shows the same id in its error.
- Trade-off: Logs go to standard output and nothing stores them, so a history needs a log store. Questions and SQL are left out unless CARE_LOG_CONTENT=1, because they can name people, so by default you see the shape of an answer and not its content.
- Built in step 7

### Can we see what costs the most tokens?

Partly. You can see tokens per model call and per query result, not per source.

- Evidence: Each done line has prompt tokens for every model call, the peak and the cached share. Each query result now carries its size in characters, shown in the step list and logged, so the costliest query is visible. The system prompt, history and tool results are not split in tokens.
- Trade-off: A true split needs counting tokens ourselves, which is more machinery than the question needs. On the medication question the results are most of the cost, and that is what the 30k cap targets.
- Built in step 18

### How does the citation preview behave?

It opens after the pointer rests 150 ms, switches at once between neighbours, closes 150 ms after leaving, never opens while scrolling, and sits below the citation unless there is more room above.

- Evidence: Checked with a script: nothing at 60 ms, open by 360 ms, a neighbour switches in under 80 ms, closed within 280 ms of leaving, and a hover that scrolled under a still pointer stays closed. The timings and the keep-clear-of-the-edge rule are borrowed from the receipts app.
- Trade-off: Names do not get a preview, only a click menu, because a name appears many times in one answer. The preview is for touch-less pointers only; on touch you tap the record.
- Built in step 19

### What did we leave out on purpose?

Sign-in, saved history, embeddings, a planner, per-person pages and hover previews on names.

- Evidence: Each has a trigger in 'What breaks next'. Names open a short menu on click, because a name appears many times in one answer and a hover on each would be noise.
- Trade-off: A manager cannot share a link to an answer, and recall is untested on real, varied notes.
- Built in step 17


## Five ways to think about it

Model quality is one of five. Each fails differently.

### The problem: What counts as a right answer?

Before any model work, decide what a good answer is. For a care manager it means finding the people who need attention, saying what the records show, and saying what they cannot show. The data sets traps. A status can say Completed while the comment says the medication was not given, and there are no planned times, so lateness cannot be measured.

What we did:
- The requirements at the top of this page
- Eight golden questions in evals/questions.yaml, one of which must be refused
- A glossary in the schema that states what the data cannot show

How it fails: A fluent answer to the wrong question, such as a number of missed visits when the data cannot measure them.

How we check: Golden questions with required facts, one that must refuse a write, and one that must say something cannot be measured.

Gap: The questions come from one person's reading of the data. No real manager has shaped them yet.

### Judgement: Does it reason well from what it reads?

This is the model and the instructions it follows. It covers which model answers, how much it thinks first, and how the prompt tells it to choose a time window, compare sources and write the answer.

What we did:
- gpt-5.5 with reasoning off, about 15 seconds for a broad question
- The system prompt in app/agent.py, versioned by a hash sent with every answer
- A cheaper model that only suggests follow-ups, outside the loop

The numbers, and why:
- Model gpt-5.5, reasoning none: Reasoning off made a broad question about three times faster with about 60% fewer tokens, and the evals still passed. It is also the only reasoning setting this model accepts with tools on this endpoint.

How it fails: Wrong scope ("any issues" read as "this week"), clearing a person whose notes it never read, or a long answer that hides the point.

How we check: Repeats and rephrased questions, plus reading the answers.

Gap: We have no evidence yet that thinking longer helps. A drop in recall on varied notes is the signal to try it.

### Capability: What can it see and do?

The tool and the data it can reach. There is one read-only SQL tool, and we tell it about the database up front so it does not have to explore.

What we did:
- run_sql, one read-only SELECT per call
- A schema, a roster of people and a glossary, all derived from the data
- Views that join names to notes, and a full-text search index
- Caps on rows, cell length and result size

The numbers, and why:
- 200 rows per query: Enough to read one person's notes for a fortnight. A bigger result is flagged as cut off, so the model narrows the query instead of guessing about the rest.
- 500 characters per cell: A typical note is far shorter. Longer text is cut and marked, so one long field cannot fill the prompt.
- 30,000 characters per result: About 8k tokens. This caps the whole result, so a wide query cannot flood the prompt. Halved from 60k after an audit: the medication question read 75-83k characters instead of 145k, used 72-78k prompt tokens instead of 114k and ran in 11s instead of 15s, and still found visit 293 and form 22. The 42 required facts in the evals still passed.
- 2.0 second query limit: SQL on this data takes milliseconds, so 2 seconds only stops a runaway statement.
- 30 people in the roster: The roster in the prompt costs about 30 tokens a person. Above this it switches off and the model queries instead.

How it fails: It cannot find what it needs, a result is so large it floods the prompt, or a cut-off result looks complete.

How we check: Guardrail tests, a loud truncation warning in the result, and the scale check.

Gap: A second tool is worth adding only if recall fails.

### Control: What stops it going wrong or costing too much?

Limits around the loop. The model chooses its own steps, and the code decides how far it may go. The three limits on one question are independent, and the first to trip wins. The cap on live questions protects the server as a whole. None of the numbers has been tuned against real traffic; they are about double what we have seen.

What we did:
- A read-only connection with an authorizer that allows only reads
- Three independent limits on one question (steps, prompt tokens, time). The first to trip makes the next turn the answer
- A cap on live questions at once, then a busy message
- Text in the database is treated as data, never as instructions

The numbers, and why:
- 8 steps: A step is one model turn that may ask for queries. Broad questions use 3 to 5 and simple ones 1 to 2, so this is about double the worst seen. It catches a model that keeps querying without converging. At the limit the next turn must answer with no tools.
- 150,000 prompt tokens: Every step resends the whole conversation, so tokens grow faster than steps. A broad question uses 35k to 75k in total, so this is about double. It is the cost guard, and it keeps runs short of the long-context quality drop, which we have not measured. At the limit the next turn must answer.
- 120 seconds: The normal wait is about 15 seconds and the slowest seen about 20. This is a safety net for a stalled API, not a target. It stops new steps from starting and does not cancel one already running. The API client has its own 90 second timeout.
- 8 live questions at once: Each holds a server thread and an open model stream for about 15 seconds. 8 is a guess for one care team. It protects the API rate limit and the bill. The ninth gets a busy message and is not queued, because a queue hides overload.

How it fails: A runaway loop, an instruction hidden in a note, a cost spike, or one slow question starving the others.

How we check: A test for each limit, and per-step timings in the logs.

Gap: There is no sign-in or per-team scoping. Production would scope every query to the caller's team in code.

### Trust: Can a person rely on it, and can we tell when it is wrong?

Everything that lets a person check an answer and lets us notice mistakes. Citations open the record behind a claim. A box lists what the records cannot show. The page says which model wrote the answer. The agent and the page share typed events. Evals run before changes ship.

What we did:
- Tappable citations and names
- The "what I couldn't determine" box and "Written by gpt-5.5"
- app/events.py, the typed contract between agent and page
- Evals with repeats and rephrasings, and logs with a request id

The numbers, and why:
- 6 messages of history: Three question and answer pairs. Enough for a follow-up like "what about her?", and older turns are dropped so cost stays flat. The server rejects more than this.
- 2,000 characters per question: A long paste is not a question. The page and the server read the same number from one config.

How it fails: An answer that is right but cannot be checked, or wrong with nobody noticing.

How we check: Contract tests between prompt and page, the evals, and a live walk through real questions.

Gap: Real questions from managers, and notes written by someone other than the builder.

- Contracts hold the layers together. Typed events, the citation grammar and one config file stop them drifting apart, which is why a test checks the prompt and the page agree.
- A feedback loop improves the first two layers without fine-tuning. A failure becomes a rule and a permanent test case.

## Parts, by layer

Layer: Browser

### Page

Layer: Browser. Built in step 6; changed in steps 6, 8, 9, 12, 13, 16, 17, 19.

- What it does: One column of turns. Each turn has a state (starting, querying, writing, done, failed or stopped) and the page is drawn from that state.
- Always true: The DOM is derived from the turn state. Nothing reads state back from the DOM.
- Limits: Questions up to 2,000 characters; Sends the last 6 messages with each question
- Meets: fr-ask (Ask in plain language); fr-cite (Cited claims); fr-unknowns (States the gaps); fr-queries (Shows its queries); fr-followups (Suggests follow-ups)
- Trade-offs:
  - Plain JavaScript with no framework or build step. It costs hand-written rendering code.
  - Citations are record ids that the page fetches on tap. An id that does not exist shows an error in the record dialog.
- Breaks first: Nothing yet. Text is revealed a few characters per frame and only the changing line is touched, which is fine at answer sizes.
- At scale: No change. It is static files.

Layer: Server

### FastAPI server

Layer: Server. Built in step 6; changed in steps 6, 7, 9, 10, 16, 19.

- What it does: One streaming endpoint, POST /api/ask/stream, plus record lookups and the page. Every request gets an id that appears on every event and log line.
- Always true: At most 8 live questions run at once. The next one is told to retry, not queued.
- Limits: 8 live questions at once; Logs omit questions, SQL and parameters unless CARE_LOG_CONTENT=1
- Meets: fr-ask (Ask in plain language); nfr-cost (Bounded cost); nfr-observe (Traceable); nfr-privacy (Private logs)
- Trade-offs:
  - A hard cap with a "busy" reply. It costs some refused questions at peak, and it needs no queue.
  - Each stream runs in a worker thread. This is simple to write and holds one thread per live question.
  - No per-user quotas, because the app has no user identity.
- Breaks first: Each live question holds a worker thread for up to 120 seconds before the final answer turn starts.
- At scale: An async client or a queue, and per-user quotas, which need identity first.
- Next steps touching it: n4 Fan out per person

### Event protocol

Layer: Server. Built in step 9; changed in steps 9.

- What it does: One definition of every event the agent, a replay or the server can emit. Tests validate real streams against it.
- Always true: Each stream runs query, result, delta, done, suggestions. Discard and error are the only exceptions.
- Meets: nfr-drift (Cannot drift); fr-queries (Shows its queries)
- Trade-offs:
  - Typed dicts checked in tests, not a schema service. A new event type needs one edit and one test.
- Breaks first: Nothing. The protocol lived in a docstring until the step 9 audit.
- At scale: Version the events once a second client exists.

### Record lookup

Layer: Server. Built in step 8; changed in steps 8.

- What it does: Turns a citation such as (visit 293) into the full record behind it, by primary key.
- Always true: A citation holds ids only, in the exact form (visit 12) or (form 4). Dates stay in the sentence.
- Meets: fr-cite (Cited claims)
- Trade-offs:
  - Lookup by id. It costs a second request when a citation is tapped, and the answer stays small.
- Breaks first: Any id can be fetched. There is no auth and no organisation scoping.
- At scale: Scope every lookup to the caller's organisation.

### Replay mode

Layer: Server. Built in step 7; changed in steps 7.

- What it does: Recorded real answers for the five example questions, so the app runs with no API key and no network.
- Always true: Replay and live emit the same events, so the page cannot tell them apart.
- Meets: nfr-offline (Runs offline)
- Trade-offs:
  - Recordings go stale when the prompt changes. They store the model and date, and they are re-recorded by one command.
- Breaks first: Only the five example questions have recordings. Any other question gets a message to set OPENAI_API_KEY.
- At scale: Not used in production.

Layer: Agent

### Schema and glossary

Layer: Agent. Built in step 2; changed in steps 2, 14.

- What it does: The model's picture of the database. It is derived from the live file and cached per file version. The glossary holds only meaning the data cannot show.
- Always true: Facts the data can show are computed. Hand-written text covers only what the data cannot say.
- Limits: Samples 200 rows per table
- Meets: fr-ask (Ask in plain language); nfr-drift (Cannot drift); nfr-scale (Scales by narrowing)
- Trade-offs:
  - Derived on load, not written by hand. It cannot go stale, and sampling can miss rare values.
  - We turned down a describe_schema tool, which would add a round trip to every question.
- Breaks first: Sampling misses rare values and rare JSON paths in a big table.
- At scale: Stratified sampling, or a stored profile refreshed offline.
- Next steps touching it: n3 One page per person

### Agent loop

Layer: Agent. Built in step 4; changed in steps 4, 7, 10, 14, 15.

- What it does: The model plans a query, the code runs it, the result goes back to the model, and this repeats. ask_stream is the only implementation of the loop.
- Always true: Three bounds apply to every question. When the first trips, the next model turn has tools switched off and must answer.
- Limits: 8 tool turns; 150,000 prompt tokens; 120 seconds
- Meets: fr-ask (Ask in plain language); fr-unknowns (States the gaps); nfr-cost (Bounded cost); nfr-observe (Traceable)
- Trade-offs:
  - A cut-off still produces an answer from what was read. It costs completeness on broad questions, and the answer has to say so.
  - Prompt tokens are counted per call and summed, so the budget tracks cost. The peak call is logged separately to show real context size.
  - We turned down letting the model run until it stops by itself, because one confused question could spend without limit.
- Breaks first: Recall on broad questions. The model reads a slice of the notes and can answer confidently, and a missed person raises no error.
- At scale: Shortlist people with SQL, give each one a small context in parallel, then rank.
- Next steps touching it: n1 Measure recall with varied text; n3 One page per person; n4 Fan out per person

### Model

Layer: Agent. Built in step 4; changed in steps 4, 12, 13, 18.

- What it does: gpt-5.5 writes the queries and the answer. A cheaper model, gpt-5.4-mini, only suggests follow-ups, outside the loop. One question makes 3 to 5 calls to gpt-5.5, each carrying the same system prompt, the last 6 messages, the question and everything read so far, plus one short call to gpt-5.4-mini after the answer.
- Always true: The prompt carries a version hash. It is logged and returned with every answer.
- Meets: fr-ask (Ask in plain language); fr-unknowns (States the gaps); fr-followups (Suggests follow-ups); fr-refuse (Refuses writes); nfr-observe (Traceable)
- Trade-offs:
  - {'Follow-ups fail soft': 'an error gives an empty list and a log line, never a failed answer.'}
  - The prompt tells the model to refuse writes. This is a courtesy, and the database refusal is what enforces it.
- Breaks first: Answer quality drops as context grows. Each step re-sends the whole conversation, so prompt tokens grow with every step.
- At scale: Smaller contexts per person, and prompt caching, whose hit rate is already measured.

Layer: Data

### run_sql tool

Layer: Data. Built in step 1; changed in steps 1, 11.

- What it does: The agent's only tool. It takes one SELECT with parameters. Errors go back to the model as text so it can fix its own SQL.
- Always true: There is one tool, so there is one place where queries are checked.
- Meets: fr-queries (Shows its queries); nfr-safety (Read-only)
- Trade-offs:
  - Free-form SQL instead of a tool per report. It allows any question, and the model can write valid SQL that is wrong.
  - Every query is recorded in the trace, so a wrong one can be seen.
- Breaks first: Model-written SQL can be valid and wrong, such as a join that drops people.
- At scale: A flatter read model gives fewer wrong queries.

### Read-only guard

Layer: Data. Built in step 1; changed in steps 1, 3.

- What it does: SQLite itself refuses anything except bounded reads. The prompt is never the safety.
- Always true: The file is opened mode=ro with query_only on, an authorizer allows only reads, and each call runs one statement.
- Limits: 200 rows, 500 characters per cell, 30,000 characters per result; 2.0 second query deadline; Strings or blobs over 1,000,000 bytes cannot be built
- Meets: nfr-safety (Read-only); nfr-cost (Bounded cost); fr-refuse (Refuses writes)
- Trade-offs:
  - Authorizer rules instead of a regex on SQL. It costs a short allow-list to maintain, and it cannot be bypassed by odd syntax.
  - Caps cut results, and a cut sets a flag and a warning the model sees. We turned down a subprocess for hard timeouts, since the length limit covers the real risk.
- Breaks first: LIKE and json_each scan whole tables, so a big source hits the 2.0 second deadline.
- At scale: Real indexes. On Postgres, a read-only role and statement_timeout.
- Next steps touching it: n2 Store the read model

### Views and full-text index

Layer: Data. Built in step 11; changed in steps 11.

- What it does: Three flat views (one row per note, comment or form answer, with the person joined) and an FTS5 index over all free text. They are built in each connection's temp database.
- Always true: The source file is never written, and the agent cannot write to the index.
- Meets: nfr-scale (Scales by narrowing); fr-ask (Ask in plain language)
- Trade-offs:
  - Rebuilt for every connection. That takes about 6 ms at this size and needs no sync logic.
  - Search finds candidates fast, but the prompt still tells the model to read the text, because carers phrase things in many ways.
- Breaks first: The rebuild on every connection grows with the data.
- At scale: Real views and a persistent index kept in sync by triggers.
- Next steps touching it: n2 Store the read model; n5 Embeddings, if measured

Layer: Checks

### Evals

Layer: Checks. Built in step 5; changed in steps 5, 11, 14, 15.

- What it does: Eight golden questions with required facts, each also asked two or three other ways and repeated. One is a write request that must be refused. A scale check adds many quiet people and confirms the real concerns still surface.
- Always true: A prompt change is measured against the same questions, asked several ways, more than once.
- Limits: A full run on gpt-5.5 is about 300k tokens; with phrasing variants about 950k
- Meets: nfr-drift (Cannot drift); nfr-scale (Scales by narrowing)
- Trade-offs:
  - Checks look for facts in the answer. They are cheap and repeatable, and they do not judge reasoning or ranking.
  - A single run hid a question that passed 2 times in 5, so any prompt change is repeated before it is trusted.
  - We turned down scoring with another model, which adds seconds and shares the same blind spots.
- Breaks first: One person wrote the answers, the checks and the rephrasings, so blind spots are in all three.
- At scale: Labelled data and phrasings from someone who did not write the agent, and a sample of real questions.
- Next steps touching it: n1 Measure recall with varied text

## Connections

- Page to FastAPI server: question (NDJSON stream)
- Page to Record lookup: tap a citation
- FastAPI server to Event protocol: typed events
- FastAPI server to Replay mode: no API key
- FastAPI server to Agent loop: live question
- Agent loop to Model: prompt
- Schema and glossary to Agent loop: schema
- Agent loop to run_sql tool: SQL and params
- run_sql tool to Agent loop: result as text
- run_sql tool to Read-only guard: SELECT
- Read-only guard to run_sql tool: rows
- Read-only guard to Views and full-text index: views and FTS
- Record lookup to Read-only guard: SELECT by id
- Evals to Agent loop: golden questions

## One request

Priya, a care manager, opens the page at 8am and asks: Who needs my attention this week?

1. Page: Priya taps the first example question. The page sends it with the last 6 messages to POST /api/ask/stream.
2. FastAPI server: The server gives the request an id, checks the question is at most 2,000 characters, and takes one of 8 live slots.
3. Schema and glossary: The agent builds the prompt. It includes the schema, derived from the live database, and the reference date, so "this week" means the 7 days up to that date.
4. Model: The model plans a query. It filters by date window and form type before it reads any notes.
5. run_sql tool: The model calls run_sql with a SELECT. The page shows the SQL as it runs.
6. Read-only guard: SQLite runs the query read-only against the views and the full-text index. The result stops at 200 rows and 30,000 characters.
7. Model: The rows go back as text. The model reads them, runs more queries if it needs to, and writes the answer with citations such as (visit 293).
8. Page: The answer streams in. Below it the page shows a box of what the records cannot show, and up to 3 follow-up chips.
9. Record lookup: Priya taps (visit 293). The page fetches that visit by id and shows the carer, the time, the status and the note.

## How it was built

### Step 0, 16:05 on 7 Nov: Look at the data first

- Before: answer from structured fields
- After: answer from free text, and say what is absent
- Why: Every visit is Completed, lasts 45 minutes, and has no planned time. All the risk is in free text, and sometimes the text contradicts the status.
- Found: Iris's medication is marked Completed, but the comment says it wasn't given.
- Turned down: Counting statuses, which carry no signal.
- Breaks next: Nothing yet. This step is only reading.

### Step 1, 17:01 on 7 Nov: Safety in the database

- Before: a prompt that asks for read-only
- After: SQLite refuses everything except bounded reads
- Why: A model can be talked out of a prompt. It cannot talk SQLite out of an authorizer.
- Turned down: A tool per report, which is the fixed-reports design the brief avoids. A regex filter on SQL.
- Breaks next: LIKE and json_each scan the whole table.

### Step 2, 17:02 on 7 Nov: The schema is derived

- Before: a hand-written schema in the prompt
- After: built per call from the live file
- Why: It cannot go stale. It also showed the model that every status is Completed.
- Turned down: A describe_schema tool, which adds a round trip to every question.
- Breaks next: Sampling misses rare values in a big table.

### Step 3, 17:02 on 7 Nov: Results are bounded, and cuts are flagged

- Before: unbounded rows
- After: caps on rows, cell length and total size, with a truncation flag and a warning
- Why: 200 rows of long notes is about 25k tokens in one call.
- Found: A review found three gaps: a 400 MB zeroblob, cut cells with no flag, and a blob that crashed the tool.
- Turned down: A subprocess for hard native timeouts. A length limit covers the real risk.
- Breaks next: A cap gives the model a slice. It can read a slice and answer confidently.

### Step 4, 17:04 on 7 Nov: The loop and its trace

- Before: an answer with no visible reasoning
- After: every query recorded, and a step limit
- Why: A reviewer can see why it answered as it did.
- Found: The first live run caught 3 of 5 people. It read a few people's notes and claimed it had checked everyone.
- Turned down: Letting the model run until it stops by itself.
- Breaks next: Recall on broad questions, and tokens that grow with every step.

### Step 5, 17:07 on 7 Nov: Evals decide

- Before: judging by reading
- After: golden questions with required facts
- Why: A prompt change has to be measured.
- Found: The first run failed 3 of 8 questions and led to four general fixes. Later, the mini model scoped medication to 7 days and cleared Iris, so answers now state their date range.
- Turned down: Scoring with another model, which would share the same blind spots.
- Breaks next: One person wrote the answers and the checks. They confirm facts appear, not that the reasoning is right.

### Step 6, 17:08 on 7 Nov: A page, then streaming

- Before: a 20 to 60 second blank wait
- After: queries and text appear as they happen
- Why: ask_stream is the one implementation of the loop, so every caller runs the same code.
- Turned down: A front-end framework. A markdown library. The renderer escapes text first instead.
- Breaks next: Each live question holds a thread until it finishes.

### Step 7, 17:26 on 7 Nov: Request ids and a token budget

- Before: no ids and no cost view
- After: request ids, JSON logs, token counts, a prompt-token budget, and replay mode
- Why: A reported problem has to be findable, and cost has to be capped whatever the model wants.
- Found: The broadest question used 122k prompt tokens in total, because each step re-sends the conversation.
- Turned down: Retrying silently. Failures are shown.
- Breaks next: Total tokens say little about what the model's context actually held.

### Step 8, 17:44 on 7 Nov: Citations people can open

- Before: a text answer
- After: tappable citations, a box for what the records cannot show, follow-up chips, Emma's look
- Why: A care manager needs to check where a claim came from.
- Found: A date inside a citation became buttons, and a long suggestion clipped the input.
- Turned down: Side chats and pasted objects, which were out of scope. Autofilling a suggested question. A phone has no Tab key, so there are chips.
- Breaks next: Any record id can be fetched with no auth.

### Step 9, 18:09 on 7 Nov: Untangle audit

- Before: hidden links, and a protocol that lived in a docstring
- After: one config module, typed events, record reads out of the server, three run bounds
- Why: Code that changes together should sit together, and a convention should be something a test can check.
- Found: .env was only loaded because the agent module happened to import first, and the run mode was read three times per request.
- Turned down: Keeping /api/ask. It duplicated the stream endpoint, so it was deleted.
- Breaks next: Nothing new. It removed ways to break.

### Step 10, 18:30 on 7 Nov: Peak context, quiet logs, a concurrency cap

- Before: total tokens, names in logs, unlimited questions
- After: peak context logged, content-free logs, at most 8 live questions
- Why: Totals re-count the conversation at every step. The peak call shows what the model actually held.
- Found: On a live run the peak was 2.6k tokens against 7.2k in total.
- Turned down: A queue and per-user quotas. They need user identity, which this app doesn't have.
- Breaks next: The cap protects cost but is not a quota per person.

### Step 11, 19:00 on 7 Nov: A flat read model, search, and a scale check

- Before: nested json_each queries
- After: three views and an FTS5 index, through the same one tool
- Why: Fewer ambiguous-column retries, and a cheap way to find where words occur.
- Found: With 40 times as many quiet people (about 205 in all) the broad question still found all five real concerns in 13 s. The clones repeat their text, so this is easier than production.
- Turned down: A separate search tool, which would change the event protocol for no gain.
- Breaks next: The index is rebuilt for each connection. That is fine here and slow at scale.

### Step 12, 19:20 on 7 Nov: Faster answers and a visible working state

- Before: 73 seconds and 292k tokens on the broad question, with a static "Running query 9"
- After: reasoning off for the answering model, and a live status line with a timer and the current query
- Why: Most of the wait was the model thinking before each query. Turning that off cut time by two thirds and tokens by more than half.
- Found: On the broad question gpt-5.5 took 51 to 73 seconds with reasoning on and 19 to 21 seconds with it off. All five people were still found and 8 of 8 evals passed. gpt-5.4-mini missed one person in a single default run.
- Turned down: The Responses API for finer control of reasoning: a bigger change for the same gain. gpt-5.4-mini as the default: one run missed a person.
- Breaks next: Less thinking can cost depth on hard questions. The evidence is 8 questions, run once each.

### Step 13, 22:30 on 7 Nov: Shorter answers and calmer streaming

- Before: answers of 580 to 1,100 words, text re-rendered on every token, and "N records cited" that did nothing when tapped
- After: a prompt that asks for a ranked list, at most 3 evidence bullets per person and under 250 words, whole-line streaming, and a cited-records list you can open
- Why: A manager acts on an answer in seconds. Long answers hid the point, and half-written lines flashed in with half-formed citations.
- Found: A live walk through 11 questions found long answers, a ranking that put the two people getting worse with no form raised last, invented names in follow-up chips, and raw dashes in the question list. The first short prompt dropped Alfred's confusion, so the evidence rule now asks for one bullet per concern.
- Turned down: Streaming every token: it re-renders the whole answer each time and shows broken citations. Saving history across reloads: not yet, the page starts empty on purpose.
- Breaks next: A short answer can leave out a real concern. The evals check the named facts, not the whole answer.

### Step 14, 23:10 on 7 Nov: A roster in the schema, and a flaky eval caught by repeating it

- Before: step 1 was nearly always a query that counted notes per person, and "any medication issues" passed its eval 2 times in 5
- After: the schema lists everyone with their visit counts, the prompt says only words like "this week" narrow the window, and every step is timed
- Why: The count query cost about 2.5 seconds of the 7 before the first word, and the model was reading "any issues" as "this week", which hid a 9 Nov problem.
- Found: Run once, the eval looked fine, because 8 of 8 passed on a lucky run. Run five times it passed 2 of 5, and 0 of 5 with the roster before the window rule. After the rule it passed 5 of 5 and the full set passed 8 of 8. First word moved from 7 to 8 seconds to 6 to 7, and steps from 3 to 5 down to 3 or 4. That gain is small and the runs vary.
- Turned down: A second model that grades whether the answer is complete: it adds 3 to 10 seconds and shares the first model's blind spots. Re-sending old query results on follow-ups: tens of thousands of tokens against a query that costs 20 milliseconds.
- Breaks next: The roster lists every person, so at about 200 people it becomes 8k tokens. It switches itself off above 30 people and the model queries instead.

### Step 15, 23:40 on 7 Nov: Ask each golden question several ways

- Before: one phrasing per golden question, run once
- After: two more phrasings per question that a manager might type, run with --variants and repeated
- Why: The medication miss came from a phrasing, not a missing fact. The way to find the next one is to change the words and keep the check.
- Found: 20 of 21 passed on the first run of the variants. The failure was "Do any care plans need updating?", which named the right people but never said the plans date from 3 Nov or have no review date. A rule to give the plan's date fixed it, and 9 of 9 passed over three repeats.
- Turned down: A model that writes the paraphrases: it would drift toward how the model already reads questions, which is the blind spot.
- Breaks next: Eleven extra phrasings is a small sample. The check is a list of required facts, so it cannot see a wrong ranking or a missing nuance.

### Step 16, 00:10 on 7 Nov: Names in the answer open a follow-up

- Before: people's names were plain text in the answer
- After: every name from the roster is a button that puts "How has Alfred Nkemelu been this week?" in the composer, without sending it
- Why: A manager acts on people, so the next question is usually about one. The tap saves typing and uses wording the evals already check.
- Found: The page decides who is a person from the roster the server sends, not from how the model wrote the answer, so bold, plain and possessive uses all behave the same. Only full names match; a bare "Alfred" stays plain because the rule must never guess.
- Turned down: Matching first names: it breaks the day two people share one. Sending the question on tap: the manager should choose what to ask.
- Breaks next: A name the model misspells is not linked, and nobody notices. The roster is the one list, so a new person needs no page change.

### Step 17, 00:40 on 7 Nov: A name opens four fixed questions

- Before: tapping a name filled the composer with one question
- After: tapping a name opens a small menu of four questions (this week, what changed against the week before, is the care plan current, is there an open safeguarding case) that fill the composer
- Why: Managers act on people. The four questions are the ones a manager keeps asking about a person, so a fixed list saves typing at no cost and needs no extra model call.
- Found: Run for one person, all four answered in 6 to 10 seconds in 2 steps. "What changed since last week" described changes inside the week, so the question now says "this week compared with the week before", and the answer then compared both weeks.
- Turned down: A model that writes drill-downs for each name: another call per tap for questions that barely vary. Sending the question on tap: the manager chooses what to ask.
- Breaks next: The four are the same for everyone. A person with no safeguarding history still gets that question, and the answer is a short no.

### Step 18, 01:20 on 7 Nov: Read less, cite plainly

- Before: the medication question read 145k characters of results and 114k prompt tokens in 11 queries
- After: results cap at 30k characters; the prompt says never to write citation ranges
- Why: An audit of the SQL the model chose showed it writes sound queries but reads wide, because a text search over every comment returns far more than it needs. Capping the result makes it narrow the query instead, at no loss of facts.
- Found: A view of de-duplicated comments looked promising but removed almost nothing (572 of 1135 were distinct after normalising), so it was dropped. Repeated evals then caught "(visits 192-210)", which the page cannot link, so the prompt now forbids ranges and the eval check fails on them.
- Turned down: A domain library of ready-made queries: it hides the schema from the model and grows with every new question. An explicit planning step: the roster already removes the counting query, and the first query is the plan.
- Breaks next: A cap this size can hide a relevant row in a very wide query. The truncation warning tells the model, and it must narrow and re-run before clearing anyone.

### Step 19, 21:10 on 7 Nov: A second untangle audit

- Before: the database path read in two places, the citation pattern written three times, the gaps heading in the prompt, the page and the evals, three floating layers each placing itself, and four scripts that edited sys.path to find the app
- After: config owns the path, app/contract.py owns the citation pattern and the heading (a test fails if the page's copy drifts), one log helper, one placement rule for the name menu and the citation preview, and the project installs as a package so imports just work
- Why: Pieces that must agree should sit in one place or be checked by a test. The audit used the untangle-codebase method: list every hidden link, needless link and surplus, write the fix above the problems it resolves, and count what is left.
- Found: Records read through the agent's connection, so each citation lookup built the search index it never uses. The question limit was in the HTML, the config and a JavaScript default; the page now takes it from the server. A refusal and its follow-up chips showed an empty 'N queries' box, now hidden.
- Turned down: Splitting ask_stream into smaller functions: it is long but reads in one straight line, and the pieces would share state through arguments. A hover preview on names: a name appears many times in an answer, and the click menu already offers the four questions. Removing comments and tests as the skill offers: not asked for, and the tests are the contract checks.
- Breaks next: The page keeps its own copy of the citation pattern because a browser cannot import Python. The contract test is what stops it drifting.

## What comes next

### Measure recall with varied text

- Problem: Today the agent finds all five real concerns when the quiet people repeat the same text. Real notes vary, so we do not know whether it would still find them. A missed person gives no error.
- Build it when: Now. It is the one thing we cannot see.
- Why not yet: It needs a bigger test set with varied text, ideally written by someone other than me.
- Before: five of five on repeated text
- After: the same check with varied text and a source of realistic size
- Touches: Evals, Agent loop

### Store the read model

- Problem: The flat views and the search index are rebuilt for every query the agent runs. That takes about 6 ms on this data and would take far longer on a large database.
- Build it when: When the source is big enough that per-connection builds hurt.
- Why not yet: At this size, rebuilding is simpler than keeping a stored index in sync.
- Before: temp views and an index built per connection
- After: real views, a persistent FTS index kept in sync by triggers, and real indexes
- Touches: Views and full-text index, Read-only guard

### One page per person

- Problem: To answer who needs attention, the agent re-reads the raw notes on every question. With thousands of people that is slow and costly.
- Build it when: When the scale check stops finding everyone, or broad questions get slow.
- Why not yet: A page that is stale or wrong can mislead. At 10 people, reading the raw records is cheaper and safer.
- Before: the agent re-reads raw notes every time
- After: a dated, cited page per person, rebuilt offline, used as a lead and checked against the records
- Touches: Agent loop, Schema and glossary

### Fan out per person

- Problem: One agent reads everyone in one long conversation. Past a certain length, models read less carefully, so a person can be missed.
- Build it when: When one context is too long to read well.
- Why not yet: The largest single call so far was about 32k tokens, which is fine.
- Before: one long sequential loop
- After: shortlist with SQL, one small context per person in parallel, then rank
- Touches: Agent loop, FastAPI server

### Embeddings, if measured

- Problem: Keyword search finds near-fall but not unsteady on his feet. If real notes use many phrasings, some concerns would be missed.
- Build it when: Only when a measured miss comes from phrasing.
- Why not yet: Nothing measured shows a phrasing miss, and embeddings add an index to keep current.
- Before: keywords
- After: embeddings combined with FTS5 to propose candidates
- Touches: Views and full-text index
