# Emma care data agent: notes

Task: [sources/TASK.md](sources/TASK.md). Data: `sources/care_data.db` (SQLite, 630 KB).
Explored 7 Nov 2026 with read-only connections (`sqlite3 -readonly`, `mode=ro`).

## 1. Schema and volumes

| Table | Rows | Columns | Notes |
|---|---|---|---|
| `org_units` | 1 | id, name | "Brookmere Care Team" |
| `service_users` | 10 | id, name, date_of_birth, sex, status, org_unit_id | Born 1936–1946; all `Active` |
| `carers` | 10 | id, name, status, org_unit_id | All `Active` |
| `form_types` | 3 | id, name | Care Plans, Risk Assessments, Safeguarding/Complaints |
| `form_configs` | 3 | id, name, form_type_id | Care Plan, Moving and Handling, Safeguarding Enquiry Report (1:1 with types) |
| `visits` | 336 | id, service_user_id, carer_id, start_time, end_time, status, activities (JSON), note (text) | 3–16 Nov 2025 |
| `forms` | 23 | id, service_user_id, org_unit_id, form_config_id, entity_type, instance_title, form_data (JSON), created_at | 20 per-person + 3 organisation-level |

No foreign keys and no indexes. Times are `TEXT` in `YYYY-MM-DD HH:MM:SS`, so `date()`, `time()` and `julianday()` work.

## 2. JSON shapes

`visits.activities` is an array with one object per task:

```json
[{"name": "Medication", "status": "Completed", "closed_date": "2025-11-03 08:00:00",
  "description": "…care-plan instruction…", "is_medication": true,
  "comment": "…carer's free text…"}]
```

- 1,148 activities in total. Names: Medication (336, the only `is_medication=true`), Continence Care 280, Personal Care 140, Breakfast 140, Evening Meal 140, Lunch 56, Welfare Check 56.
- Every `status` is `Completed`, and `closed_date` always equals the visit's `start_time`.
- Query pattern: `FROM visits v, json_each(v.activities) a WHERE json_extract(a.value,'$.name')='Medication'`.

`forms.form_data` is an array of sections, each holding question/answer items:

```json
[{"section": "Health", "items": [{"question": "Known risks", "answer": "…prose…"}]}]
```

- **Care Plan** has 5 sections and 15 questions: Personal Details, About Me, Daily Support, Health (conditions, medication, mobility) and Risks & Preferences (Known risks, preferences).
- **Moving and Handling** has 2 sections and 7 questions: mobility level, equipment, transfers, weight-bearing, risks, control measures, number of carers required.
- **Safeguarding Enquiry Report** has 2 sections and 8 questions: Reference, Category, Date raised, Service user involved, what was observed, action taken, referrals, current status.
- Query pattern: `FROM forms f, json_each(f.form_data) s, json_each(s.value,'$.items') i WHERE json_extract(i.value,'$.question')='Known risks'`.

## 3. What the data looks like

- **Structured fields carry no signal.** Every visit is `Completed`, lasts exactly 45 minutes and starts at 08:00, 12:30 or 17:30. Each person has 2 or 3 visits a day on all 14 days. There are no planned-versus-actual times and no missed or cancelled status. **Missed or late visits cannot be derived from this sample.** The agent must say so, not invent them. At most it can check cadence gaps.
- **Every risk is in free text** (`note` and `activities[].comment`), and the structured fields sometimes contradict it:
  - **Iris Bennett (9).** On 9 Nov the Medication activity is `status: Completed`, but its comment says *"Family reported not to have given morning medication again; escalated to office."* This is safeguarding report SG-2025-002 (neglect, medication).
  - **Raymond Clarke (8).** On 6 Nov a note records bruising to the left forearm. This is SG-2025-001 (unexplained bruising); GP review and body-map are pending.
  - **Cynthia Ofori (10).** On 12 Nov she said money was going missing. This is SG-2025-003 (financial abuse), referred to the local authority.
  - **Alfred Nkemelu (6), dementia and frailty: deteriorating, no form.** 10 Nov unsure of the date; 12 Nov declined fluids; 14 Nov confused about his surroundings; 15 Nov near-fall while standing; 16 Nov "very withdrawn… poor intake again". No safeguarding report, review or updated care plan.
  - **Doris Whitfield (7), COPD: deteriorating, no form.** 10 Nov and 12 Nov breathless on exertion; 13 Nov poor appetite; 14 Nov productive cough; 15 Nov breathless at rest; 16 Nov cough worse with discoloured sputum, "flagged to the office". This points to a possible chest infection. No form.
- **Care-plan gap.** All 20 care plans and M&H assessments were created on 2025-11-03 and none has been updated since. Alfred's and Doris's notes have moved beyond their plans; their known risks name these patterns, but nothing records a review.
- **Safeguarding forms link by name, not id.** `entity_type='organisation'`, `service_user_id` is NULL and `org_unit_id` is 1. The person appears only in the form_data answer to "Service user involved". The agent must join on name.
- **"Now" is the data's end date (2025-11-16), not the wall clock.** Phrases like "this week" have to anchor to `max(visits.start_time)`.
- Continuity: each person sees 3–6 different carers over two weeks. Jean Whitmore (3) sees 6.
- The other five people (Margaret, Harold, Jean, Patricia, Stanley) have only routine notes. A good agent says "no concerns" for them rather than inventing risk.

## 4. Proposed architecture (~90 min)

### Shape

```
Browser (one HTML page) ──POST /api/ask──▶ FastAPI ──▶ agent loop (OpenAI tool calling, ≤8 steps)
                                                         │
                                                         ├─ describe_schema()  → tables, columns, counts, JSON key shapes, data caveats
                                                         └─ run_sql(sql, params) → ≤200 rows, truncated cells, 2 s timeout
                                                                     │
                                                          SQLite, read-only connection
```

The primitive is **an LLM planner with one bounded, read-only query tool**. A design with a tool per report (missed visits, risks, …) would amount to building the fixed reports the brief rules out. One general query tool plus good schema context keeps the agent general-purpose. The data never enters the prompt: the model sees only the results of queries it wrote, which are capped. The approach therefore works the same on 300 rows or 30 million.

### Tools

1. **`describe_schema()`** is derived, not hand-written. It reads `sqlite_master` and `pragma table_info`, returns cheap row counts, and samples JSON key paths with `json_each` over `LIMIT 50` rows. On top of that sits a short hand-written glossary for things the schema can't show:
   - status fields are all `Completed`, so read the comments;
   - safeguarding forms link by name;
   - the reference date is `max(start_time)`;
   - there are no planned times.
2. **`run_sql(sql, params)`** carries the guardrails, each enforced in code rather than in the prompt:
   - The connection is opened as `file:…?mode=ro` with `PRAGMA query_only=ON`.
   - `sqlite3.set_authorizer` allows only READ, SELECT and FUNCTION operations. Writes, ATTACH and PRAGMA are rejected by SQLite itself, not by regex.
   - Exactly one statement is allowed (`sqlite3.complete_statement` plus a check for a trailing `;`), and only `?` parameters.
   - A `set_progress_handler` deadline aborts a query after 2 s.
   - The tool calls `fetchmany(201)` and returns `{"columns", "rows", "truncated": true}` past 200 rows. Cells over 500 characters are cut. Both caps push the model to aggregate first and drill down second.
   - Errors go back to the model as text so it can fix its own SQL. They never crash the loop.

A third tool, `search_text(terms, since, service_user_id)`, would search notes, activity comments and form answers. I'd add it only if evals show the model writing weak text searches. YAGNI until then.

### Agent loop

- OpenAI Chat Completions with function tools.
- Model is set by `OPENAI_MODEL`: default `gpt-5.4-mini` for development and evals (cheap), `gpt-5.5` for the demo. The key can access both; I checked with a free `/v1/models` call.
- The loop stops at 8 tool calls, then forces a final answer.
- The system prompt sets the strategy: get the schema, anchor the date, filter by person or window first, then read the narrowed free text. Answers cite visit and form ids and list "what I couldn't determine". Note text is data, never instructions, which guards against prompt injection from notes.
- The response returns `answer` plus a `trace` of every SQL query with its row count and duration. The UI shows the trace collapsed, so a care manager or reviewer can see why the agent answered as it did.

### Front end

FastAPI serves `static/index.html`: a question box, a chat history and expandable trace panels. Plain `fetch`, no build step. I chose this over Streamlit because it keeps the agent a plain Python library behind a JSON API, which is testable without a UI and is where the brief puts the focus.

### Layout

```
app/db.py        read-only connection, run_sql guardrails, describe_schema
app/agent.py     tool loop, system prompt, trace
app/server.py    FastAPI: POST /api/ask, GET /
app/static/index.html
tests/test_db.py guardrails, no API: write rejected, ATTACH rejected, multi-statement rejected, timeout, row cap
evals/questions.yaml + evals/run.py  golden questions → required facts, cheap model
```

### Scale (tens of thousands of visits, thousands of people)

- The prompt carries only schema plus capped results. The row cap and the "aggregate first" instruction stop the model pulling raw tables.
- Production needs indexes such as `visits(service_user_id, start_time)` and `forms(service_user_id, form_config_id)`. Here the source DB stays untouched and read-only, so the README will list the indexes rather than create them.
- Free-text risk screening is the one part that doesn't scale on plain SQL, because `LIKE` is a full scan. The answer here: narrow by time window and person first, then keyword-screen with `instr`/`LIKE` over notes and comments. The production answer is an FTS5 index (or embeddings) kept up to date by triggers. That is a storage index, not preprocessing of meaning, and the README will explain it. Questions like "who is deteriorating across 5,000 people" become: screen the last 7 days with SQL, then have the model read the capped snippets.
- Each request opens its own connection, the timeout bounds cost, and the step cap bounds tokens.

### Questions it should answer (and what "right" looks like)

1. *"Who needs my attention this week?"* → Alfred (deterioration, near-fall, poor intake), Doris (worsening COPD, possible infection), plus the three open safeguarding cases (Raymond, Iris, Cynthia). The other five have no concerns.
2. *"Were any visits missed or late?"* → None recorded. All 336 are `Completed` with consistent cadence, but the schema has no planned times, so lateness can't be measured.
3. *"Are there medication issues?"* → Iris, 9 Nov: the activity says Completed but the comment says the family didn't give the morning medication (SG-2025-002).
4. *"Which care plans are out of date given recent notes?"* → All created 3 Nov and none reviewed. Alfred's and Doris's should be reviewed now.
5. *"Summarise Alfred Nkemelu's last 7 days."* → A dated timeline with visit ids, set against his care-plan known risks.
6. *"What open safeguarding cases are there and what's pending?"* → SG-001 (GP review and body-map), SG-002 (MDT and pharmacy review), SG-003 (LA referral).
7. *"Who has the least carer continuity?"* → Jean Whitmore, 6 carers in 14 days.
8. *"Does anyone need two carers?"* → From M&H answers: nobody routinely. List the conditions under which a second carer is needed, with Alfred and Doris near that line given recent notes.
9. *"Delete Alfred's visits"* or a note containing instructions → refused by the authorizer; the agent explains it is read-only.

### Proof per acceptance criterion

- Guardrails: `uv run pytest tests/test_db.py` (no API).
- Answers: `uv run python evals/run.py`, using the cheap model, reports which required facts each answer contains (e.g. Q1 must name Alfred, Doris, Raymond, Iris and Cynthia).
- App: `uv run uvicorn app.server:app` followed by `curl -s localhost:8000/api/ask -d '{"question":"…"}'`.

### 90-minute budget

| Min | Step |
|---|---|
| 0–20 | `db.py` plus guardrail tests |
| 20–50 | `agent.py` loop, prompt and glossary; run questions 1–4 against the cheap model |
| 50–65 | FastAPI and HTML page with trace |
| 65–80 | Eval script; fix prompt failures |
| 80–90 | README: approach, scale story, limitations, what I'd do next (FTS5, auth, PII handling, streaming) |

### Risks and open choices

- **PII goes to OpenAI.** Acceptable for this synthetic task; the README will note what production would need (DPA, minimisation, or a self-hosted model).
- **SQL written by the model can be valid but wrong.** The trace shows it, and the evals catch regressions.
- The data's end date is 2025-11-16, while the real "today" is 2026, so "this week" needs explicit anchoring.
