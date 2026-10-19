import asyncio

import pytest
from alpineagents import Agent, ContextTooLongError, Image, Message, State, ToolCall
from alpineagents.models.base import COMPACT_PROMPT
from alpineagents.state import CLEARED
from alpineagents.testing import FakeModel
from alpineagents.types import RawBlock, TextBlock, ToolResultBlock

from alpine_core.context import ContextLimits, remember
from alpine_core.loop import coding
from alpine_core.tidy import RESULT_CHARS, summary_request, tidy_if_full

PNG = b"\x89PNG\r\n\x1a\n" + b"0" * 32


def reads(count: int, size: int) -> list[Message]:
    """``count`` read calls, each answered with ``size`` characters."""
    messages = []
    for i in range(count):
        messages.append(Message("assistant", (ToolCall("read", {"path": f"f{i}.py"}, f"c{i}"),)))
        messages.append(Message("user", (ToolResultBlock(f"c{i}", "x" * size, name="read"),)))
    return messages


def agent_with(model: FakeModel, limits: ContextLimits) -> Agent:
    return Agent(remember(model, limits), loop=coding, reporter=None, human=None)


def cleared(state: State) -> int:
    return sum(isinstance(b, ToolResultBlock) and b.content == CLEARED for m in state.messages for b in m.content)


def test_old_tool_results_are_cleared_at_once_and_that_can_be_enough():
    model = FakeModel([])
    # 40K window: fit 20K. 12 results of ~2,000 tokens each are past it; keeping 5 brings it under 15K.
    agent = agent_with(model, ContextLimits(40_000))
    state = State(messages=[Message.user("fix the bug"), *reads(12, 6000)])
    asyncio.run(tidy_if_full(agent, state))
    assert cleared(state) == 7 and not model.requests  # no summary was asked for
    assert agent.context_tokens(state) < 20_000


def test_still_too_long_after_clearing_is_summarized_with_the_conversation_as_it_is():
    model = FakeModel(["the summary"])
    # A price step at 20K: tidied at 19K, far under the window, so the summary request is the conversation itself.
    agent = agent_with(model, ContextLimits(100_000, price_step=20_000))
    state = State(messages=[Message.user("fix the bug"), Message.assistant("y" * 60_000), *reads(8, 600)])
    asyncio.run(tidy_if_full(agent, state))
    assert [m.text for m in state.messages][0] == "fix the bug"
    assert "the summary" in state.messages[-1].text and len(state.messages) == 2
    (request,) = model.requests
    assert COMPACT_PROMPT in request.messages[-1].text and request.messages[1].text == "y" * 60_000


def test_an_unknown_window_is_never_tidied_early():
    model = FakeModel([])
    agent = agent_with(model, ContextLimits(None))
    state = State(messages=[Message.user("go"), *reads(40, 6000)])
    asyncio.run(tidy_if_full(agent, state))
    assert cleared(state) == 0 and not model.requests


def test_a_refused_turn_is_summarized_to_fit_and_sent_again():
    # The window is unknown to Alpine; the server holds 5,000 tokens and refuses more.
    model = FakeModel(["the summary", "done"], context_window=5000)
    agent = agent_with(model, ContextLimits(None))
    history = [Message.user("hi")]
    for i in range(8):
        history += [Message.user(f"step {i} " + "u" * 3000), Message.assistant("a" * 3000)]
    state = State(messages=[*history, Message.user("go on")])
    assert asyncio.run(agent.arun(state)) == "done"
    sizes = [model.count_tokens(r) for r in model.requests]
    # the turn, summary requests until one fits (each aiming lower), then the turn again
    assert sizes[0] > 5000 and all(s > 5000 for s in sizes[1:-2]) and sizes[-2] <= 5000
    assert 2 <= len(sizes) - 2 <= 4
    assert "earlier exchanges are left out" in model.requests[-2].messages[0].text
    assert state.messages[0].text == "hi" and "the summary" in state.messages[1].text


def test_a_turn_still_refused_after_the_smallest_summary_request_fails():
    model = FakeModel(["never"], context_window=50)
    agent = agent_with(model, ContextLimits(None))
    state = State(messages=[Message.user("go " + "u" * 3000)])
    with pytest.raises(ContextTooLongError):
        asyncio.run(agent.arun(state))
    assert len(model.requests) == 1 + 4  # the turn, then the four sizes of summary request


def test_a_refusal_clears_old_tool_results_first():
    model = FakeModel(["done"], context_window=12_000)
    agent = agent_with(model, ContextLimits(None))
    state = State(messages=[Message.user("go"), *reads(12, 6000)])
    assert asyncio.run(agent.arun(state)) == "done"
    assert cleared(state) == 7 and len(model.requests) == 2  # refused, cleared, sent again


def test_the_flat_summary_request_cuts_results_and_drops_the_oldest_exchanges():
    messages = [
        Message.user("first"),
        Message("assistant", (RawBlock("anthropic", {"type": "thinking", "thinking": "secret"}), TextBlock("ok"))),
        Message("assistant", (ToolCall("read", {"path": "a.py"}, "c1"),)),
        Message("user", (ToolResultBlock("c1", "r" * 5000, name="read"),)),
        Message.user("look", Image(PNG)),
        Message.user("last " + "z" * 100),
    ]
    text = summary_request(messages, 100_000).messages[0].text
    assert "secret" not in text and "Agent: ok" in text and 'Agent called read {"path": "a.py"}' in text
    assert "r" * RESULT_CHARS + " …(cut; 5,000 characters in all)" in text
    assert "User: (an image, left out)" in text and text.endswith(COMPACT_PROMPT)
    assert "left out to fit" not in text

    small = summary_request(messages, 400).messages[0].text
    assert "first" not in small and "last" in small and "earlier exchanges are left out to fit" in small
