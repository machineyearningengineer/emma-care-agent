# Technical Task — Care Data Agent

## Context

You're working with a **care provider's database** — a home-care service operating
in a healthcare setting. It contains two kinds of information:

- **Care delivery** — the record of ongoing visits to the people receiving care
  (service users). You'll find this in the **`visits`** table.
- **Clinical forms** — care plans, assessments and related documents, in the
  **`forms`** table.

It's a single SQLite database, `care_data.db`. Have a look around and get a feel
for what's in there before you start.

## The task

Build an **agent that lets a user ask questions about this data and surfaces
insights** back to them.

The people using it are care managers and coordinators. Broadly, they're
interested in **how their service users are doing, and any risks** — but the
point is a general-purpose agent they can actually ask things of, not a fixed
set of reports.

## Scale

This database is deliberately **tiny** — a small sample to work against. In
production the same system holds **tens of thousands of visits across thousands
of service users**, with many times more forms and thousands of new visits every
day. Build with that scale in mind: your approach should still hold up when the
data is far too large to fit into a single prompt or into memory.

## What we're looking for

- Around **90 minutes**.
- **Python** on the backend — this is where the focus is: the agent, and how it
  retrieves and reasons over the data.
- A **lightweight front end** is fine — just enough to interact with it. UI
  polish is not the point.
- The agent should be able to reason directly over the database rather than leaning on preprocessing. 


## Getting started

```python
import sqlite3
con = sqlite3.connect("care_data.db")
```

A couple of columns hold nested detail as JSON — `visits.activities` and
`forms.form_data`.

Explore the schema, then build. Send us your code and anything you'd want us to
know about your approach.
