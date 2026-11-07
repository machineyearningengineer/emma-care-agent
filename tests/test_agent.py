"""The agent loop against a scripted fake model. No API calls."""

import json
from types import SimpleNamespace as NS

from app import agent
from app.events import validate


def chunk(content=None, tool=None, usage=None):
    tcs = None
    if tool:
        idx, cid, name, args = tool
        tcs = [NS(index=idx, id=cid, function=NS(name=name, arguments=args))]
    choices = [] if usage else [NS(delta=NS(content=content, tool_calls=tcs))]
    return NS(
        choices=choices, usage=NS(prompt_tokens=usage[0], completion_tokens=usage[1]) if usage else None
    )


class FakeStream(list):
    closed = False

    def __enter__(self):
        return self

    def __exit__(self, *_):
        self.closed = True


class FakeClient:
    """Plays back one scripted turn per create() call; a callable turn gets the kwargs."""

    def __init__(self, turns):
        self.turns, self.calls = list(turns), []
        self.chat = NS(completions=NS(create=self.create))

    def create(self, **kw):
        self.calls.append(kw)
        turn = self.turns.pop(0)
        return FakeStream(turn(kw) if callable(turn) else turn)


SQL = "SELECT count(*) FROM visits"


def test_tool_call_then_streamed_answer():
    client = FakeClient(
        [
            [
                chunk(tool=(0, "c1", "run_sql", '{"sql": "SELECT count(*) ')),  # arguments arrive in pieces
                chunk(tool=(0, None, None, 'FROM visits"}')),
                chunk(usage=(100, 10)),
            ],
            [chunk("336 "), chunk("visits."), chunk(usage=(200, 5))],
        ]
    )
    events = list(agent.ask_stream("how many visits?", client=client))
    assert [e["type"] for e in events] == ["query", "result", "delta", "delta", "done", "suggestions"]
    assert events[0]["sql"] == SQL and events[1]["row_count"] == 1
    assert all(validate(e) for e in events)  # every event is part of the protocol
    done = events[-2]
    assert done["prompt"] == agent.PROMPT_VERSION
    assert events[-1] == {"type": "suggestions", "questions": []}  # fake client has no reply; fails soft
    assert done["answer"] == "336 visits." and done["usage"] == {
        "prompt_tokens": 300,
        "completion_tokens": 15,
        "cached_tokens": 0,
    }
    # The tool result went back to the model with the right call id.
    tool_msg = client.calls[1]["messages"][-1]
    assert tool_msg["role"] == "tool" and tool_msg["tool_call_id"] == "c1" and "336" in tool_msg["content"]


def test_text_written_alongside_tool_calls_is_discarded():
    client = FakeClient(
        [
            [chunk("Let me check. "), chunk(tool=(0, "c1", "run_sql", json.dumps({"sql": SQL})))],
            [chunk("Done.")],
        ]
    )
    types = [e["type"] for e in agent.ask_stream("q", client=client)]
    assert types == ["delta", "discard", "query", "result", "delta", "done", "suggestions"]
    assert agent.ask("q", client=FakeClient([[chunk("Done.")]]))["answer"] == "Done."


def test_step_cap_forces_an_answer():
    def turn(kw):
        if kw["tool_choice"] == "none":
            return [chunk("Forced answer.")]
        return [chunk(tool=(0, f"c{len(client.calls)}", "run_sql", json.dumps({"sql": SQL})))]

    client = FakeClient([turn] * (agent.MAX_STEPS + 1))
    r = agent.ask("q", client=client)
    assert r["answer"] == "Forced answer." and r["steps"] == agent.MAX_STEPS + 1
    assert len(r["trace"]) == agent.MAX_STEPS


def test_bad_tool_arguments_go_back_as_errors():
    client = FakeClient(
        [
            [chunk(tool=(0, "c1", "run_sql", "not json"))],
            [chunk(tool=(0, "c2", "drop_table", '{"sql": "x"}'))],
            [chunk(tool=(0, "c3", "run_sql", '{"sql": "DELETE FROM visits"}'))],
            [chunk("Read-only.")],
        ]
    )
    r = agent.ask("q", client=client)
    assert r["answer"] == "Read-only." and all("error" in t for t in r["trace"])


def test_token_budget_forces_an_answer():
    def turn(kw):
        if kw["tool_choice"] == "none":
            return [chunk("Budget answer.")]
        return [
            chunk(tool=(0, "c", "run_sql", json.dumps({"sql": SQL}))),
            chunk(usage=(agent.TOKEN_BUDGET, 1)),
        ]

    r = agent.ask("q", client=FakeClient([turn, turn]))
    assert r["answer"] == "Budget answer." and r["steps"] == 2


def test_deadline_forces_an_answer(monkeypatch):
    monkeypatch.setattr(agent, "DEADLINE_S", -1)  # already past on the first turn
    client = FakeClient([[chunk("Out of time.")]])
    assert agent.ask("q", client=client)["answer"] == "Out of time."
    assert client.calls[0]["tool_choice"] == "none"
