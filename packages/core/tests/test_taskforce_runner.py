"""TF's script runner: the sandboxed worker, the agent calls it hands Alpine, the plan's cap, stopping and rerunning."""

import asyncio
import os
import textwrap
from pathlib import Path

import pytest

from alpine_core.taskforce import Member, ScriptError, ScriptRun, available, check_script

pytestmark = pytest.mark.skipif(not available(), reason="TF runs on macOS only")


def script(text: str) -> str:
    return textwrap.dedent(text).strip() + "\n"


async def echo(member: Member) -> str:
    return f"done: {member.request.prompt}"


def run(text: str, spawn=echo, **kwargs) -> tuple[ScriptRun, object]:
    async def go():
        job = ScriptRun(script(text), spawn, **{"planned": 20, **kwargs})
        return job, await job.run()

    return asyncio.run(go())


def test_a_script_hands_out_agents_in_steps_and_returns_a_result():
    job, outcome = run(
        """
        phase("조사")
        topics = await agent("나눠 줘", returns={"topics": ["str"]}, label="주제 나누기")
        phase("작성")
        drafts = await parallel([agent(f"{t} 카드 쓰기") for t in ["저장소", "복제"]])
        print("ignored by the protocol")
        log(f"{len(drafts)}개 썼어요")
        result = {"drafts": drafts, "left": budget()}
        """
    )
    assert outcome.status == "done", outcome.error
    assert outcome.result == {"drafts": ["done: 저장소 카드 쓰기", "done: 복제 카드 쓰기"], "left": 17}
    assert [(m.step, m.task, m.state) for m in job.members] == [
        ("조사", "주제 나누기", "done"),
        ("작성", "저장소 카드 쓰기", "done"),
        ("작성", "복제 카드 쓰기", "done"),
    ]
    assert job.members[0].request.returns == {"topics": ["str"]}
    assert job.log == "2개 썼어요"


def test_pipeline_runs_each_item_through_the_stages():
    job, outcome = run(
        """
        async def write(topic):
            return await agent(f"write {topic}")
        async def review(draft):
            return await agent(f"review this draft carefully: {draft}")
        result = await pipeline(["a", "b"], write, review)
        """
    )
    assert outcome.status == "done", outcome.error
    assert outcome.result == [
        "done: review this draft carefully: done: write a",
        "done: review this draft carefully: done: write b",
    ]


@pytest.mark.parametrize(
    "attempt",
    [
        "open('/etc/hosts').read()",
        "__import__('subprocess').check_call(['/usr/bin/touch', '/tmp/taskforce-escape'])",
        "__import__('subprocess').run(['/usr/bin/true'])",
        "__import__('socket').create_connection(('1.1.1.1', 80), timeout=2)",
        f"__import__('pathlib').Path({str(Path.cwd())!r}).joinpath('README.md').read_text()",
        f"__import__('os').listdir({os.path.expanduser('~')!r})",
    ],
)
def test_the_sandbox_lets_a_script_do_nothing_but_compute(attempt):
    # The model's check refuses these, so they are sent as a raw script, as a bypass would be.
    job, outcome = run(f"await agent('x')\nresult = {attempt}\n")
    assert outcome.status == "failed"
    assert "Error" in (outcome.error or "")
    assert not Path("/tmp/taskforce-escape").exists()


def test_the_check_tells_the_model_what_a_script_may_not_do():
    with pytest.raises(ScriptError) as e:
        check_script("import os\nimport time\nagent = 1\nresult = open('x')\n")
    message = str(e.value)
    assert "`import os`" in message and "`import time`" in message
    assert "built-in names" in message and "`open()`" in message and "never calls agent()" in message
    check_script("import json\nresult = await agent('x')\n")


def test_a_script_error_names_its_own_line():
    _, outcome = run("x = await agent('a')\ny = x['missing']\n")
    assert outcome.status == "failed"
    assert "line 2" in outcome.error and "TypeError" in outcome.error


def test_no_more_than_six_work_at_once():
    working = peak = 0

    async def slow(member: Member) -> str:
        nonlocal working, peak
        working += 1
        peak = max(peak, working)
        await asyncio.sleep(0.05)
        working -= 1
        return "ok"

    job, outcome = run("result = await parallel([agent(f'n{i}') for i in range(14)])\n", slow)
    assert outcome.status == "done" and peak == 6 and len(job.members) == 14


def test_more_agents_than_planned_wait_for_the_user():
    async def go():
        seen = []
        scheduled = []

        def allow(job):
            seen.append(job.needed)  # every call over the plan has arrived by now
            job.allow_more()

        def on_change(job):
            if job.status == "over" and not scheduled:
                scheduled.append(asyncio.get_running_loop().call_later(0.2, allow, job))

        job = ScriptRun(
            script("result = await parallel([agent(f'n{i}') for i in range(5)])"),
            echo,
            planned=3,
            on_change=on_change,
        )
        outcome = await job.run()
        return seen, outcome

    seen, outcome = asyncio.run(go())
    assert seen == [5]
    assert outcome.status == "done" and len(outcome.result) == 5


def test_stopping_ends_the_run_with_what_finished():
    async def go():
        async def spawn(member: Member) -> str | None:
            if member.request.prompt == "first":
                return "kept"
            while not member.stop_asked:
                await asyncio.sleep(0.01)
            return None

        text = script("a = await agent('first')\nb = await agent('second')\nresult = [a, b]")
        job = ScriptRun(text, spawn, planned=5)
        task = asyncio.create_task(job.run())
        while len(job.members) < 2 or job.members[1].state != "working":
            await asyncio.sleep(0.01)
        job.stop()
        return job, await task

    job, outcome = asyncio.run(go())
    assert outcome.status == "stopped" and outcome.result == ["kept", None]
    assert [m.state for m in job.members] == ["done", "stopped"]


def test_a_rerun_answers_finished_calls_at_once():
    cache: dict = {}
    calls: list[str] = []

    async def spawn(member: Member) -> str:
        calls.append(member.request.prompt)
        return member.request.prompt.upper()

    text = "a = await agent('same')\nb = await agent('same')\nresult = [a, b]\n"
    run(text, spawn, cache=cache)
    fixed = text.replace("result = [a, b]", "c = await agent('new')\nresult = [a, b, c]")
    job, outcome = run(fixed, spawn, cache=cache)
    assert outcome.result == ["SAME", "SAME", "NEW"]
    assert calls == ["same", "same", "new"]  # the rerun only started the new one
    assert [m.cached for m in job.members] == [True, True, False]


def test_a_prompt_quoting_an_answer_was_handed_it():
    async def spawn(member: Member) -> str:
        return "A long enough draft about storage, written by the first agent."

    job, _ = run("d = await agent('write')\nawait agent(f'review: {d}')\n", spawn)
    assert job.members[1].source == job.members[0].id
