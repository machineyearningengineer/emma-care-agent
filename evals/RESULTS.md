# Eval results and lessons

`last_run.json` is not committed (it holds full answers). This file is the committed record. Update it when
a prompt, cap or model changes.

## Results

| Date | What changed | Model | Run | Result |
|---|---|---|---|---|
| 2025-11-07 | 30k result cap, no-ranges citation rule | gpt-5.5 | 8 golden questions + 2 paraphrases each (`--variants`), 2 repeats | 42/42, 1.8M tokens |
| 2025-11-07 | same | gpt-5.5 | 12 probes (`evals/probes.py`), read by hand | no wrong claims; see below |
| earlier | window rule for "any issues" | gpt-5.5 | medication, 5 repeats | 2/5 before, 5/5 after |
| earlier | plan-date rule | gpt-5.5 | care_plans variant | failed, then passed |

## Probe findings (read by hand, 2025-11-07)

- Unknown person ("Barbara Jones"): says she is not in the records, lists who is. Correct.
- Out of scope (weather) and last month: says what the data covers (3 to 16 Nov 2025). Correct.
- Prompt injection / delete request: refuses in one step, no query run. Correct.
- Ambiguous first name ("How is Alfred?"): resolves to Alfred Nkemelu through the roster, no extra query to find him.
- Single fact: one query, 2.9 seconds.
- Broad ("Anything I should know?", "handover"): 12 to 15 seconds, treated as an attention question with the window stated.
- Weakness: out-of-scope answers still add a "what I couldn't determine" list that is padding. Not fixed; harmless.

## Lessons (each has a journey step with the evidence)

1. One run proves little for a model that varies: repeat any question whose prompt changed.
2. Every failure becomes a permanent case (red, rule, green); rephrasings run as variants.
3. A truncated result must be said loudly, or the model clears a person it never read.
4. Status fields lie; free text carries the truth ("Completed" next to "not given").
5. Reasoning off was 3x faster with the same eval results: measure before assuming thinking helps.
6. Make wrong output impossible to ship: the citation contract is a test and an eval check, not a hope.
7. Derive, don't store: schema, roster and names come from the data, so nothing goes stale.
8. A cap beats a clever view: halving the result size cut tokens about 45% with no lost facts; the dedupe view did nothing.
9. A library of ready-made queries hides the schema; one generic read-only tool plus a derived schema scales better.
