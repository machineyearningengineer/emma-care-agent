# Demo and talk track

Ten minutes. Run `uv run uvicorn app.server:app`, open http://localhost:8000, and keep
[docs/journey.html](docs/journey.html) open in a second tab. With a key in `.env` the answers are live
(about 15 seconds). Without one, the five example questions play back recorded answers, so the demo
still works with no network.

## 1. The problem (1 minute)

A care manager has hundreds of visit notes, care plans and safeguarding forms. They need to ask a plain
question, get an answer they can act on in 30 seconds, and be able to check every claim. The risk is
an answer that sounds right and is wrong.

## 2. The demo (4 minutes)

1. **Ask "Who needs my attention this week?"** Point at the live queries while it works, then the
   ranked list, the date range it states, and the "What the records can't show" box.
2. **Tap a citation.** The record opens with the claim being checked above the carer's own note.
   Tap "N records cited" for the list grouped by record.
3. **Tap a person's name.** Four fixed follow-ups appear. Pick "What changed ... compared with the week
   before". It fills the composer; you send it.
4. **Ask "Were any visits missed or late?"** It says the data cannot tell: there are no planned times.
   Saying so is the correct answer.
5. **Ask "Are there any medication issues?"** Iris's visit is marked Completed while the note says the
   family had not given the medication. A report built on status would call it done.
6. **Ask it to delete something.** It refuses, and the database would refuse anyway (read-only
   connection, authorizer).

## 3. How it works (3 minutes)

On the journey page: tap the nodes from the browser down to the database, press Story to follow one
question, then open "Five ways to think about it". The model is one of five layers. The agent is a
model, one tool (`run_sql`) and a loop, bounded by 8 steps, 150k prompt tokens and 120 seconds.

## 4. What broke and what it taught us (2 minutes)

| What happened | What we did |
|---|---|
| A truncated result let the model clear a person it had not read | A loud truncation warning and a rule: only clear what you read |
| "Any medication issues" passed once but 2 times in 5 when repeated | Repeat prompt changes; a window rule; the case is permanent |
| 73 seconds and 292k tokens on a broad question | Reasoning off: about 15 seconds, 60% fewer tokens, same evals |
| A mixed citation like "(visit 327, form 23)" showed as plain text | One kind per bracket, and evals now fail on an unlinkable citation |
| A rephrased question never gave a care plan's date | Rephrased questions run as variants of each golden question |

## 5. Not built, on purpose

Sign-in and per-team scoping, saved history across reloads, per-person pages, embeddings, and a real
sample of managers' questions. Each has a trigger in the journey's "What breaks next".

## Likely questions

- **Is it really an agent?** Yes: a model that chooses its own queries, a tool, and a loop that feeds
  results back. It cannot act, so it is an analyst, not an assistant.
- **Why not embeddings or RAG?** The data is small and the questions are about specific people and
  dates, so SQL plus reading the narrowed text works. Embeddings are the next step when scale breaks
  recall.
- **Why SQLite?** One file, read-only, zero setup. Postgres is the move when many writers or users appear.
- **How do you know it is right?** Every claim cites a record, 8 golden questions plus rephrasings and
  repeats, and a scale check with about 200 people. It does not prove ranking or tone.
- **What does a question cost?** About 3 to 5 model calls and 35k to 75k prompt tokens, about half of it
  served from cache.
- **What breaks first?** Recall on varied real notes, then the 30k-character results, then one thread
  per live question.
- **Privacy?** Names go to the model provider. Fine for synthetic data; production needs an agreement,
  pseudonymising or a self-hosted model.

## Starting it from nothing

`uv sync`, then `uv run uvicorn app.server:app`. `uv run pytest` takes about 4 seconds and needs no key.
`AGENTS.md` is the guide for an agent working in the repo, and `docs/journey.yaml` regenerates the
journey page with `uv run python docs/build_journey.py`.
