from alpineagents import ContextChange, State

from alpine_core.bridge import EventReporter
from alpine_core.events import ContextCompacted, TurnStarted


def test_clearing_and_a_summary_in_one_tidying_are_one_divider():
    events = []
    reporter = EventReporter(events.append)
    state = State()
    reporter.on_context_change(state, ContextChange("clear_tool_results", 900, 500, cleared=("a", "b", "c")))
    assert events == []  # held: a summary may follow
    reporter.on_context_change(state, ContextChange("compact", 500, 40, summary="what was done"))
    assert events == [ContextCompacted(900, 40, "what was done", 3)]

    events.clear()
    reporter.on_context_change(state, ContextChange("clear_tool_results", 900, 500, cleared=("a",)))
    reporter.on_think_start(state)
    assert events == [ContextCompacted(900, 500, None, 1), TurnStarted(state.turn)]

    events.clear()
    reporter.on_context_change(state, ContextChange("clear_tool_results", 900, 500, cleared=("a",)))
    reporter.flush()
    assert events == [ContextCompacted(900, 500, None, 1)]
