from pathlib import Path

import pytest
from alpineagents.testing import FakeModel, tool_call

from alpine_core import ApprovalRequest, Decision, Memories, Session, Settings
from alpine_core import session as session_module
from alpine_core.memory import Memory, Refused, memory_system
from alpine_core.memory.model import Check, Evidence, Guard
from alpine_core.memory.rules import Event, Facts, FormChecks, PatternGuards, check_form, guard_form
from alpine_core.permissions import Mode, PermissionPolicy
from alpine_core.tools import Workspace

LINT = Check('before command "git commit"', 'command "pnpm lint" ran after the last change', "pnpm lint 먼저")


def rule(check: Check | None = None, guard: Guard | None = None, id: str = "r") -> Memory:
    return Memory(id, "rule", "team", "규칙", "", check=check, guard=guard)


def command(text: str) -> Event:
    return Event("command", tuple(text.split()))


def change(path: str, new: bool = False) -> Event:
    return Event("change", path=path, new=new)


# Forms


@pytest.mark.parametrize(
    "check",
    [
        LINT,
        Check('after a change to "migrations/*"', "the file is new", "새 파일로"),
        Check("when the run ends", 'command "pnpm test" ran', "테스트"),
        Check('when the run ends after a change to "*.tsx"', 'command "pnpm build" ran after the last change', "빌드"),
    ],
)
def test_the_check_forms(check):
    check_form(check)


@pytest.mark.parametrize(
    "check",
    [
        Check("before git commit", 'command "pnpm lint" ran', "x"),
        Check('before command "git commit"', "lint ran", "x"),
        Check('before command "git commit"', "the file is new", "x"),
        Check('before command "git commit"', 'command "pnpm lint" ran', " "),
    ],
)
def test_checks_outside_the_forms_are_refused(check):
    with pytest.raises(ValueError, match=r"check\.|say"):
        check_form(check)


def test_the_guard_forms():
    guard_form(Guard('command "supabase db execute --linked"', "운영 DB"))
    guard_form(Guard('editing ".env.production"', "운영 설정"))
    with pytest.raises(ValueError, match="form"):
        guard_form(Guard("supabase db execute", "운영 DB"))


def test_a_suggestion_with_a_check_outside_the_forms_is_refused_with_the_forms(tmp_path):
    (tmp_path / "p").mkdir()
    memory = memory_system(tmp_path / "p", home=tmp_path / "h")
    with pytest.raises(Refused, match="before command"):
        memory.inbox.propose(
            kind="rule",
            scope="team",
            headline="커밋 전에 린트",
            body="",
            name="lint",
            evidence=Evidence("s", __import__("datetime").datetime.now(), "q"),
            source="agent",
            check=Check("before commit", "lint", "x"),
        )


# Checks


def test_a_command_waits_for_another_that_ran_after_the_last_change():
    checks = FormChecks([rule(LINT)])
    assert checks.before_command(Facts(()), "git commit -m x") == ["pnpm lint 먼저"]
    assert checks.before_command(Facts((command("pnpm lint"),)), "git commit -m x") == []
    assert checks.before_command(Facts((command("pnpm lint --fix"),)), "git commit") == []
    assert checks.before_command(Facts((command("pnpm lint"), change("a.ts"))), "git commit") == ["pnpm lint 먼저"]
    assert checks.before_command(Facts((change("a.ts"),)), "pnpm lint && git commit -m x") == []
    assert checks.before_command(Facts(()), "git status") == []


def test_a_change_to_a_path_can_require_a_new_file():
    checks = FormChecks([rule(Check('after a change to "migrations/*"', "the file is new", "새 파일로"))])
    assert checks.after_change(Facts(()), change("migrations/001.sql")) == ["새 파일로"]
    assert checks.after_change(Facts(()), change("migrations/002.sql", new=True)) == []
    assert checks.after_change(Facts(()), change("src/a.ts")) == []


def test_run_end_checks_look_at_this_run_only():
    build = Check('when the run ends after a change to "*.tsx"', 'command "pnpm build" ran', "빌드")
    checks = FormChecks([rule(build)])
    earlier = (change("a.tsx"), command("pnpm build"))
    assert checks.at_run_end(Facts((change("a.tsx"),))) == ["빌드"]
    assert checks.at_run_end(Facts((*earlier, change("b.ts")), run_start=2)) == []  # no .tsx this run
    assert checks.at_run_end(Facts((*earlier, change("b.tsx")), run_start=2)) == []  # built earlier counts


def test_a_check_edited_by_hand_out_of_the_forms_is_left_out():
    assert FormChecks([rule(Check("whenever", "always", "x"))]).checks == []


# Guards


def test_guards_match_commands_by_words_and_edits_by_path(tmp_path):
    guards = PatternGuards(
        [
            rule(guard=Guard('command "supabase db execute --linked"', "운영 DB"), id="a"),
            rule(guard=Guard('editing ".env.*"', "운영 설정"), id="b"),
        ]
    )
    assert guards.asks("bash", {"command": "cd x && supabase db execute --linked -f q.sql"}, tmp_path) == "운영 DB"
    assert guards.asks("bash", {"command": "supabase db diff"}, tmp_path) is None
    assert guards.asks("edit", {"path": str(tmp_path / ".env.production")}, tmp_path) == "운영 설정"
    assert guards.asks("read", {"path": ".env.production"}, tmp_path) is None


def test_a_guard_asks_even_in_yolo_and_offers_no_always(tmp_path):
    guards = PatternGuards([rule(guard=Guard('command "supabase db execute"', "운영 DB"))])
    policy = PermissionPolicy(Workspace(tmp_path), Mode.YOLO, guards=guards)
    verdict = policy.evaluate("bash", {"command": "supabase db execute"}, None)
    assert (verdict.allowed, verdict.reason, verdict.grant) == (False, "운영 DB", None)
    assert policy.evaluate("bash", {"command": "ls"}, None).allowed


# In a session


class Approver:
    def __init__(self, *decisions: Decision) -> None:
        self.decisions = list(decisions)
        self.requests: list[ApprovalRequest] = []

    def approve(self, request: ApprovalRequest) -> Decision:
        self.requests.append(request)
        return self.decisions.pop(0)


def session_with(project: Path, home: Path, monkeypatch, memories_of: list[Memory], replies, *decisions, mode=None):
    memories = Memories(home)
    for memory in memories_of:
        memories.of(project).store.put(memory)
    monkeypatch.setattr(session_module, "make_model", lambda settings: FakeModel(list(replies)))
    approver = Approver(*decisions)
    session = Session(Settings(model="fake"), approver=approver, cwd=project, memories=memories, mode=mode)
    return session, approver, memories


def calls(session):
    return [(i.name, i.status, i.result) for i in session.snapshot().items if i.kind == "tool_call"]


@pytest.fixture
def project(tmp_path):
    folder = tmp_path / "p"
    folder.mkdir()
    return folder


def test_a_session_refuses_a_command_until_its_check_holds(project, home, monkeypatch):
    check = Check('before command "echo deploy"', 'command "echo built" ran after the last change', "먼저 빌드")
    session, approver, _ = session_with(
        project,
        home,
        monkeypatch,
        [rule(check)],
        [tool_call("bash", command="echo deploy"), tool_call("bash", command="echo built && echo deploy"), "끝"],
        mode=Mode.YOLO,
    )
    session.send("배포해")
    assert calls(session)[0][:2] == ("bash", "denied") and "먼저 빌드" in calls(session)[0][2]
    assert calls(session)[1][:2] == ("bash", "done")
    assert approver.requests == []


def test_a_change_that_breaks_a_check_reminds_the_agent(project, home, monkeypatch):
    (project / "migrations").mkdir()
    (project / "migrations" / "001.sql").write_text("create table a;")
    check = Check('after a change to "migrations/*"', "the file is new", "기존 마이그레이션은 고치지 말고 새로")
    session, _, _ = session_with(
        project,
        home,
        monkeypatch,
        [rule(check)],
        [
            tool_call("write", path="migrations/002.sql", content="alter table a;"),
            tool_call("write", path="migrations/001.sql", content="create table b;"),
            "고쳤어요",
        ],
        mode=Mode.YOLO,
    )
    session.send("테이블 바꿔")
    notices = [i.text for i in session.snapshot().items if i.kind == "notice"]
    assert notices == ["A check from the project's memory failed: 기존 마이그레이션은 고치지 말고 새로"]


def test_a_run_end_check_reminds_once_and_the_run_goes_on(project, home, monkeypatch):
    check = Check('when the run ends after a change to "*.txt"', 'command "echo tested" ran', "테스트를 돌려 주세요")
    session, _, _ = session_with(
        project,
        home,
        monkeypatch,
        [rule(check)],
        [tool_call("write", path="a.txt", content="x"), "다 했어요", "테스트는 생략했어요"],
        mode=Mode.YOLO,
    )
    assert session.send("a.txt 만들어") == "테스트는 생략했어요"
    notices = [i for i in session.snapshot().items if i.kind == "notice"]
    assert [n.source for n in notices] == ["memory_check"]


def test_a_guard_asks_in_yolo_and_its_reason_is_on_the_card(project, home, monkeypatch):
    guard = Guard('command "echo prod"', "운영 DB를 건드려요")
    session, approver, memories = session_with(
        project,
        home,
        monkeypatch,
        [rule(guard=guard)],
        [tool_call("bash", command="echo prod"), "했어요"],
        Decision("allow"),
        mode=Mode.YOLO,
    )
    session.send("운영 DB 고쳐")
    [request] = approver.requests
    assert (request.reason, request.remember) == ("운영 DB를 건드려요", None)


def test_a_guard_approved_mid_session_applies_at_once(project, home, monkeypatch):
    session, approver, memories = session_with(
        project,
        home,
        monkeypatch,
        [],
        ["ok", tool_call("bash", command="echo prod"), "했어요"],
        Decision("deny"),
        mode=Mode.YOLO,
    )
    session.send("hi")
    system = memories.of(project)
    suggestion = system.inbox.propose(
        kind="rule",
        scope="team",
        headline="운영 DB는 물어보고",
        body="",
        name="prod",
        evidence=Evidence("s", __import__("datetime").datetime.now(), "q"),
        source="agent",
        guard=Guard('command "echo prod"', "운영 DB"),
    )
    memories.approve(project, suggestion.id)
    session.send("운영 DB 고쳐")
    assert [r.reason for r in approver.requests] == ["운영 DB"]
