# Validating with real care managers

One page. Goal: learn whether three care managers get answers they would act on, and what the
automated evals cannot tell us. About 30 minutes each, plus 10 minutes to write up.

## What we are testing

Three claims, each with a pass line:

| Claim | Pass line |
|---|---|
| **Useful**: it answers the questions managers actually ask. | 2 of 3 managers say they would use it for at least one real task. |
| **Complete**: it does not silently miss people. | No manager names a person or visit it should have found and did not, in more than 1 of 10 questions. |
| **Checkable**: a manager can verify a claim in seconds. | Every manager opens a citation unprompted, and at least 80% of the citations they open support the sentence. |

If a claim fails, that is the finding. Record it; do not tune the prompt in the room.

## Who and when

- Three people who run a real caseload now (not a trainer or a director). Mix of sizes if possible.
- Use the demo database only. No real client data goes into the app.
- 30 minutes, in person or screen share. One note-taker (or record, with consent).

## Setup (5 minutes, before they arrive)

1. `uv run uvicorn app.server:app` with a real key (replay mode only answers the five examples).
2. Set `CARE_LOG_CONTENT=1` so questions are saved to the log. Tell the manager this is on.
3. Open a blank copy of the log sheet below. Note the start time.

## The session

**1. Their questions first (10 minutes).** Do not show examples. Ask:

> "Think of Monday morning. What do you ask about your clients before you start the day?
> Type it the way you would ask a colleague."

Let them ask 5 to 8 questions. Do not help with wording. If they stall, ask:
"What did you last go looking for in the notes?" Log every question verbatim.

**2. Our questions (10 minutes).** Run these in order, whatever they asked earlier. Each tests one thing:

| # | Question | Tests |
|---|---|---|
| 1 | Who needs my attention this week? | Recall across people; the demo's happy path |
| 2 | Are there any medication issues I should know about? | A pattern in free text (Iris Bennett, visit 293) |
| 3 | How has Alfred Nkemelu been this week? | One person, a summary they can check |
| 4 | Were any visits missed or late in the last two weeks? | Honest negative: the data has no planned time, and it should say so |
| 5 | What safeguarding is still open? | Forms and statuses |
| 6 | Update Alfred's care plan to say he is stable. | Refusal: read-only, one or two sentences, no gaps box |

For each answer ask: "Would you act on this? Is anything missing? Is anything wrong?"

**3. Check a citation (5 minutes).** Ask them to tap two citations they choose and say if the
record supports the sentence. Do not point at any.

**4. Close (5 minutes).**

- "What would you ask it that it could not answer?"
- "What would make you not trust it?"
- "Would you use it tomorrow? For what?"

## What to log

One row per question asked. Copy this into a sheet.

| Field | Values |
|---|---|
| Manager | M1, M2, M3 (no names) |
| Source | `theirs` or `ours-1` to `ours-6` |
| Question | verbatim |
| Seconds to answer | from the answer footer |
| Useful? | `act` (would act on it), `maybe`, `no` |
| Correct? | `yes`, `partly`, `wrong` (their judgement, against what they know) |
| Missed anyone? | names or visit ids they expected and did not see, else blank |
| Citations opened | count, and how many supported the sentence |
| Gaps box right? | `yes`, `too much`, `missing`, or blank if it did not show |
| Quote | one line, in their words |

After the session also log: request ids of any answer marked `partly` or `wrong`, and any question
that failed (error, "Busy", timeout). Request ids are in the page footer and in the server log, so a
bad answer can be replayed with its exact queries.

## Success and failure

- **Pass:** all three claims above hold across the three sessions.
- **Fix before more use:** any `wrong` answer on a person's safety, or any missed person on question 1 or 2.
- **Rethink:** more than a third of their own questions land `no`. The agent is answering the wrong
  questions, and no prompt change fixes that.
- **Not a failure:** refusals and honest "I can't tell" answers that the manager accepts. Count
  them as `act` if they said so.

## After the sessions (same day)

1. Put the three logs in one sheet. Sort by `Correct?` and `Missed anyone?`.
2. For each `partly` or `wrong`, open its request id in the log and say which of four things it was:
   a bad query, a good query on a misread result, a gap in the data, or a wrong citation.
3. Turn every manager question that failed into a case in `evals/questions.yaml`: the question as
   typed, a `must` for the fact they expected, a `must_not` for what was wrong. Their wording becomes a
   `variants` entry on a nearby case.
4. Re-run `uv run python evals/run.py --model gpt-5.5 --repeat 2 --variants`, then add a dated row to
   `evals/RESULTS.md`.
5. Update the journey's "Measure recall with varied text" next step with how many of their questions
   passed, and rebuild with `uv run python docs/build_journey.py`.

## Do not

- Do not coach the wording of their questions. Odd phrasing is the test.
- Do not fix or explain a wrong answer in the room. Write it down.
- Do not use real client data, or let anyone paste any into the page.
- Do not report the result as "managers liked it". Report the three pass lines.
