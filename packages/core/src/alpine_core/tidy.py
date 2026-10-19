"""Keeps a conversation inside its model's window: tidied at the tidy point (``context.py``), and tidied and sent
again when the provider refuses a request as too long.

Tidying has two steps. Old tool results are cleared first, all but the last few at once: clearing breaks the prompt
cache from the first cleared result, so it is done in one large step rather than a little every turn. Only if that
does not free enough is the conversation summarized as well.

alpineagents' ``compact`` keeps the first user message and the summary; nothing recent stays word for word. Keeping
the last ~20,000 tokens beside the summary needs a way to compact that alpineagents does not have yet.

The summary request is the conversation itself when it fits. When it does not (a refusal, or a jump past the window),
the conversation is sent as flat text: each tool result cut to ``RESULT_CHARS``, images and reasoning left out, and
the oldest exchanges dropped until it fits the target. Each further refusal aims lower (``SHRINK``); after the last,
the turn fails with the provider's message.
"""

from __future__ import annotations

import json

from alpineagents import Agent, ContextTooLongError, Image, Message, OutputError, Request, State, ToolCall
from alpineagents.models.base import COMPACT_PROMPT
from alpineagents.types import RawBlock, TextBlock, ToolResultBlock

from .context import limits_of

#: Tool results kept word for word when old ones are cleared.
KEEP_RESULTS = 5
#: Clearing is enough when it brings the conversation this far under the tidy point; otherwise it is summarized too,
#: or it would be tidied again a few turns later.
CLEARED_ENOUGH = 0.75
#: The summary request's size for an unknown window: 200,000 tokens less room for the reply.
UNKNOWN_FIT = 180_000
#: The summary request's target after each refusal, as shares of the first target.
SHRINK = (1.0, 0.7, 0.5, 0.35)
#: A tool result in a flattened summary request is cut to this many characters.
RESULT_CHARS = 1250
#: Characters per token in estimates; generous, like alpineagents', to cover languages such as Korean.
CHARS_PER_TOKEN = 3
#: What one image counts for in a size estimate, in characters (alpineagents counts 1,600 tokens).
IMAGE_CHARS = 1600 * CHARS_PER_TOKEN

_INTRO = (
    "Below is a conversation between a user and a coding agent, written out as text. It was too long to send as it "
    "is, so tool results are cut and images and reasoning are left out."
)


async def tidy_if_full(agent: Agent, state: State) -> None:
    """Tidies the conversation when it is past the tidy point of the agent's model. An unknown window has none."""
    point = limits_of(agent.model).tidy_at
    if point is None or state.pending_calls:
        return
    used = agent.context_tokens(state)
    if used <= point:
        return
    if _clear(state, used) <= point * CLEARED_ENOUGH:
        return
    await summarize(agent, state)


async def athink_fitting(agent: Agent, state: State) -> None:
    """``agent.athink``; when the provider refuses the request as too long, the conversation is tidied and the turn
    sent again.

    Raises:
        ContextTooLongError: Still refused after the smallest summary request.
    """
    try:
        await agent.athink(state)
        return
    except ContextTooLongError:
        refused = agent.context_tokens(state)
    cleared = _clear(state, refused)
    if cleared < refused:
        try:
            await agent.athink(state)
            return
        except ContextTooLongError:
            refused = agent.context_tokens(state)
    await summarize(agent, state, refused=refused)
    await agent.athink(state)


async def summarize(agent: Agent, state: State, *, refused: int | None = None) -> None:
    """Replaces the conversation with a summary. ``refused``: the size of a request the provider refused, which the
    summary request must stay under.

    Raises:
        ContextTooLongError: Every summary request was refused.
        OutputError: The model wrote an empty summary.
    """
    limits = limits_of(agent.model)
    fit = limits.fit or UNKNOWN_FIT
    if refused is None:
        if agent.context_tokens(state) <= fit:
            try:
                await agent.acompact(state)  # the conversation as it is, so the prompt cache holds
                return
            except ContextTooLongError:
                refused = agent.context_tokens(state)
        else:
            refused = fit
    first = min(fit, refused)
    error: ContextTooLongError | None = None
    for share in SHRINK:
        request = summary_request(state.messages, int(first * share))
        try:
            reply = await agent.model.arespond(request)
        except ContextTooLongError as e:
            error = e
            continue
        if reply.text.strip():
            # The request's usage is not counted: state.compact takes only the text.
            state.compact(reply.text)
            return
        break
    if error is None:
        raise OutputError("The model wrote an empty summary of the conversation.")
    raise error


def summary_request(messages: tuple[Message, ...] | list[Message], target: int) -> Request:
    """A request for a summary of ``messages`` in at most about ``target`` tokens: flat text, tool results cut,
    the oldest exchanges dropped first."""
    exchanges = [text for text in (_exchange_text(e) for e in _exchanges(messages)) if text]
    budget = max(target * CHARS_PER_TOKEN - len(_INTRO) - len(COMPACT_PROMPT) - 200, 1000)
    total = sum(len(t) + 2 for t in exchanges)
    dropped = 0
    while len(exchanges) > 1 and total > budget:
        total -= len(exchanges.pop(0)) + 2
        dropped += 1
    if exchanges and total > budget:
        last = exchanges[-1]
        exchanges[-1] = "…(the start of this part is cut)\n" + last[len(last) - budget :]
    note = f"\n({dropped} earlier exchanges are left out to fit.)" if dropped else ""
    text = f"{_INTRO}{note}\n\n" + "\n\n".join(exchanges) + f"\n\n---\n\n{COMPACT_PROMPT}"
    return Request(system=None, messages=(Message.user(text),))


def _clear(state: State, used: int) -> int:
    """Clears old tool results, all but the last ``KEEP_RESULTS``. Returns the conversation's new length, ``used``
    scaled by how much the messages shrank: the provider's count no longer applies after clearing, and a fresh
    character estimate would count a whole conversation generously."""
    before = _size(state.messages)
    state.clear_tool_results(keep_last=KEEP_RESULTS)
    after = _size(state.messages)
    return used if before == 0 else round(used * after / before)


def _size(messages: tuple[Message, ...]) -> int:
    """The messages' size in characters, images counted as ``IMAGE_CHARS``."""
    total = 0
    for message in messages:
        for block in message.content:
            if isinstance(block, TextBlock):
                total += len(block.text)
            elif isinstance(block, ToolCall):
                total += len(block.name) + len(json.dumps(block.args, ensure_ascii=False, default=str))
            elif isinstance(block, ToolResultBlock) and isinstance(block.content, str):
                total += len(block.content)
            elif isinstance(block, ToolResultBlock):
                total += sum(IMAGE_CHARS if isinstance(p, Image) else len(p.text) for p in block.content)
            elif isinstance(block, Image):
                total += IMAGE_CHARS
            elif isinstance(block, RawBlock):
                total += len(json.dumps(block.data, ensure_ascii=False, default=str))
    return total


def _exchanges(messages: tuple[Message, ...] | list[Message]) -> list[list[Message]]:
    """The messages in exchanges, each starting at something the user said (a message that is not only tool
    results), so calls and their results stay together."""
    exchanges: list[list[Message]] = []
    for message in messages:
        said = message.role == "user" and any(not isinstance(b, ToolResultBlock) for b in message.content)
        if said or not exchanges:
            exchanges.append([])
        exchanges[-1].append(message)
    return exchanges


def _exchange_text(messages: list[Message]) -> str:
    lines = []
    for message in messages:
        for block in message.content:
            if isinstance(block, TextBlock) and block.text.strip():
                who = "User" if message.role == "user" else "Agent"
                lines.append(f"{who}: {block.text.strip()}")
            elif isinstance(block, Image):
                lines.append("User: (an image, left out)")
            elif isinstance(block, ToolCall):
                lines.append(f"Agent called {block.name} {json.dumps(block.args, ensure_ascii=False, default=str)}")
            elif isinstance(block, ToolResultBlock):
                lines.append(f"Result of {block.name or 'the call'}: {_cut(block)}")
            # Reasoning (RawBlock) is left out.
    return "\n".join(lines)


def _cut(result: ToolResultBlock) -> str:
    if isinstance(result.content, str):
        text = result.content
    else:
        images = sum(isinstance(p, Image) for p in result.content)
        text = "".join(p.text for p in result.content if isinstance(p, TextBlock))
        if images:
            text += f" ({images} image{'s' if images > 1 else ''}, left out)"
    if len(text) <= RESULT_CHARS:
        return text
    return f"{text[:RESULT_CHARS]} …(cut; {len(text):,} characters in all)"
