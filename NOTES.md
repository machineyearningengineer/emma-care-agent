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


Design, scale story and results are in [README.md](README.md). The golden questions are in [evals/questions.yaml](evals/questions.yaml).
