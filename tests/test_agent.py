"""The agent loop against a scripted fake model. No API calls."""

from types import SimpleNamespace as NS

from app import agent


def chunk(content=None, tool=None, usage=None):
    tcs = None
    if tool:
        idx, cid, name, args = tool
        tcs = [NS(index=idx, id=cid, function=NS(name=name, arguments=args))]
    choices = [] if usage else [NS(delta=NS(content=content, tool_calls=tcs))]
    return NS(choices=choices, usage=NS(prompt_tokens=usage[0], completion_tokens=usage[1]) if usage else None)


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
    client = FakeClient([
        [chunk(tool=(0, "c1", "run_sql", '{"sql": "SELECT count(*) ')),  # arguments arrive in pieces
         chunk(tool=(0, None, None, 'FROM visits"}')),
         chunk(usage=(100, 10))],
        [chunk("336 "), chunk("visits."), chunk(usage=(200, 5))],
    ])
    events = list(agent.ask_stream("how many visits?", client=client))
    assert [e["type"] for e in events] == ["query", "result", "delta", "delta", "done"]
    assert events[0]["sql"] == SQL and events[1]["row_count"] == 1
    done = events[-1]
    assert done["answer"] == "336 visits." and done["usage"] == {"prompt_tokens": 300, "completion_tokens": 15}
    # The tool result went back to the model with the right call id.
    tool_msg = client.calls[1]["messages"][-1]
    assert tool_msg["role"] == "tool" and tool_msg["tool_call_id"] == "c1" and "336" in tool_msg["content"]


def test_text_written_alongside_tool_calls_is_discarded():
    client = FakeClient([
        [chunk("Let me check. "), chunk(tool=(0, "c1", "run_sql", '{"sql": "%s"}' % SQL))],
        [chunk("Done.")],
    ])
    types = [e["type"] for e in agent.ask_stream("q", client=client)]
    assert types == ["delta", "discard", "query", "result", "delta", "done"]
    assert agent.ask("q", client=FakeClient([[chunk("Done.")]]))["answer"] == "Done."


def test_step_cap_forces_an_answer():
    def turn(kw):
        if kw["tool_choice"] == "none":
            return [chunk("Forced answer.")]
        return [chunk(tool=(0, f"c{len(client.calls)}", "run_sql", '{"sql": "%s"}' % SQL))]

    client = FakeClient([turn] * (agent.MAX_STEPS + 1))
    r = agent.ask("q", client=client)
    assert r["answer"] == "Forced answer." and r["steps"] == agent.MAX_STEPS + 1
    assert len(r["trace"]) == agent.MAX_STEPS


def test_bad_tool_arguments_go_back_as_errors():
    client = FakeClient([
        [chunk(tool=(0, "c1", "run_sql", "not json"))],
        [chunk(tool=(0, "c2", "drop_table", '{"sql": "x"}'))],
        [chunk(tool=(0, "c3", "run_sql", '{"sql": "DELETE FROM visits"}'))],
        [chunk("Read-only.")],
    ])
    r = agent.ask("q", client=client)
    assert r["answer"] == "Read-only." and all("error" in t for t in r["trace"])
