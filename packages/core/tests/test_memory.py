from collections.abc import Sequence
from dataclasses import replace
from datetime import UTC, datetime

import pytest
from alpineagents import Message, State, ToolError

from alpine_core.memory import (
    Evidence,
    IndexRecall,
    MarkdownStore,
    Memory,
    Proposer,
    Refused,
    Scope,
    memory_system,
    scope_folders,
)


@pytest.fixture
def project(tmp_path):
    folder = tmp_path / "flower-shop"
    folder.mkdir()
    return folder


@pytest.fixture
def memory(project, home):
    return memory_system(project, home=home)


def said(quote: str, session: str = "s1") -> Evidence:
    return Evidence(session, datetime(2026, 10, 5, tzinfo=UTC), quote)


def propose(memory, headline: str, *, quote: str = "버튼 문구 해요체로 해줘", **changes):
    args = {
        "kind": "rule",
        "scope": "team",
        "headline": headline,
        "body": "이유: 사용자가 고쳐 말함.",
        "name": "ui-tone",
        "evidence": said(quote),
        "source": "agent",
    }
    return memory.inbox.propose(**{**args, **changes})


# Store


def test_store_writes_a_file_per_memory_and_an_index(project, home):
    store = MarkdownStore(project, home)
    stored = store.put(Memory("ui-tone", "rule", "team", "화면 문구는 해요체로 쓴다", "이유: 두 번 고쳐 말함."))

    assert stored.path == project / ".alpine" / "memory" / "ui-tone.md"
    assert stored.path.read_text() == "---\nkind: rule\n---\n# 화면 문구는 해요체로 쓴다\n\n이유: 두 번 고쳐 말함.\n"
    index = (project / ".alpine" / "memory" / "index.md").read_text()
    assert "- rule: 화면 문구는 해요체로 쓴다 → [ui-tone.md](ui-tone.md)" in index
    assert store.list("team") == [stored]

    store.remove("team", "ui-tone")
    assert store.list("team") == []
    assert not (project / ".alpine" / "memory" / "index.md").exists()


def test_store_reads_a_file_written_by_hand(project, home):
    folder = project / ".alpine" / "memory"
    folder.mkdir(parents=True)
    (folder / "deploy.md").write_text("배포는 Vercel에서 한다\n\nmain에 push하면 배포됨.\n")
    (folder / "empty.md").write_text("\n")

    [memory] = MarkdownStore(project, home).list("team")
    assert (memory.id, memory.kind, memory.headline, memory.body) == (
        "deploy",
        "rule",
        "배포는 Vercel에서 한다",
        "main에 push하면 배포됨.",
    )


def test_store_refuses_an_unsafe_id(project, home):
    with pytest.raises(ValueError):
        MarkdownStore(project, home).put(Memory("../escape", "rule", "team", "x", ""))


def test_personal_memory_is_kept_outside_the_project(project, home):
    folders = scope_folders(project, home)
    assert folders["team"].is_relative_to(project)
    assert not folders["project_me"].is_relative_to(project)
    assert folders["project_me"].is_relative_to(home / "projects")
    assert folders["me"] == home / "memory"


# Recall


def test_recall_puts_an_index_line_per_memory_by_scope(memory, project):
    assert memory.system_block() == ""
    memory.store.put(Memory("deploy", "fact", "team", "배포는 Vercel", ""))
    memory.store.put(Memory("ui-tone", "rule", "team", "화면 문구는 해요체로 쓴다", ""))
    memory.store.put(Memory("plain", "user", "me", "설명은 쉬운 말로", ""))

    block = memory.system_block()
    team = block.index("## Team")
    assert block.index("- rule: 화면 문구는 해요체로 쓴다 (.alpine/memory/ui-tone.md)", team) < block.index(
        "- fact: 배포는 Vercel (.alpine/memory/deploy.md)", team
    )
    assert block.index("## This user, every project") > team
    assert "- user: 설명은 쉬운 말로 (" in block


def test_recall_notice_names_the_scope(project):
    notice = IndexRecall(project).notice(Memory("ui-tone", "rule", "team", "해요체", "", project / "x.md"))
    assert notice == "The user approved a new memory (team):\n- rule: 해요체 (x.md)"


# Inbox


def test_nothing_is_kept_before_approval(memory):
    suggestion = propose(memory, "화면 문구는 해요체로 쓴다")
    assert memory.store.list("team") == []
    assert memory.inbox.pending() == [suggestion]

    kept = memory.inbox.approve(suggestion.id)
    assert (kept.id, kept.headline) == ("ui-tone", "화면 문구는 해요체로 쓴다")
    assert memory.store.list("team") == [kept]
    assert memory.inbox.pending() == []
    assert memory.inbox.notes("team", "ui-tone").evidence == (said("버튼 문구 해요체로 해줘"),)


def test_a_declined_suggestion_is_not_raised_again_on_the_same_evidence(memory):
    memory.inbox.reject(propose(memory, "화면 문구는 해요체로 쓴다").id)
    with pytest.raises(Refused, match="declined"):
        propose(memory, "화면 문구는 해요체로 쓴다!")
    assert propose(memory, "화면 문구는 해요체로 쓴다", quote="또 반말이네, 해요체로")


def test_a_close_suggestion_joins_the_pending_one(memory):
    first = propose(memory, "화면 문구는 해요체로 쓴다")
    joined = propose(
        memory, "화면 문구는 해요체로 쓴다.", quote="오류 메시지도 해요체", body="버튼과 오류 메시지 모두."
    )
    assert joined.id == first.id
    assert joined.body == "버튼과 오류 메시지 모두."
    assert [e.quote for e in joined.evidence] == ["버튼 문구 해요체로 해줘", "오류 메시지도 해요체"]
    assert len(memory.inbox.pending()) == 1


def test_said_again_after_approval_becomes_a_change(memory):
    memory.inbox.approve(propose(memory, "화면 문구는 해요체로 쓴다").id)
    change = propose(memory, "화면 문구는 해요체로 쓴다 (오류 메시지 포함)", quote="오류도 해요체로", name="tone")

    assert change.replaces == ("ui-tone",)
    assert [e.quote for e in memory.inbox.notes("team", "ui-tone").said_again] == ["오류도 해요체로"]

    kept = memory.inbox.approve(change.id)
    assert kept.id == "ui-tone"
    assert [m.headline for m in memory.store.list("team")] == ["화면 문구는 해요체로 쓴다 (오류 메시지 포함)"]
    notes = memory.inbox.notes("team", "ui-tone")
    assert [e.quote for e in notes.evidence] == ["버튼 문구 해요체로 해줘", "오류도 해요체로"]
    assert notes.said_again == ()


def test_a_full_scope_needs_a_merge(project, home):
    memory = memory_system(project, home=home, cap=2)
    memory.store.put(Memory("lint", "rule", "team", "커밋 전에 pnpm lint", ""))
    memory.store.put(Memory("button", "rule", "team", "버튼 문구는 존댓말", ""))

    with pytest.raises(Refused, match="full"):
        propose(memory, "안내문은 해요체")
    merge = propose(memory, "화면 문구는 모두 해요체", replaces=["button"])
    kept = memory.inbox.approve(merge.id)
    assert kept.id == "button"
    assert sorted(m.headline for m in memory.store.list("team")) == ["커밋 전에 pnpm lint", "화면 문구는 모두 해요체"]


def test_the_inbox_checks_kinds_scopes_and_names(memory):
    with pytest.raises(Refused, match="kind"):
        propose(memory, "x", kind="goal")
    with pytest.raises(Refused, match="only be kept"):
        propose(memory, "코드를 잘 모름", kind="user", scope="team")
    with pytest.raises(Refused, match="no team memory"):
        propose(memory, "x", replaces=["missing"])
    with pytest.raises(Refused, match="empty"):
        propose(memory, "   ")


def test_names_stay_unique(memory):
    memory.store.put(Memory("ui-tone", "rule", "team", "버튼은 파란색", ""))
    kept = memory.inbox.approve(propose(memory, "화면 문구는 해요체로 쓴다").id)
    assert kept.id == "ui-tone-2"


def test_forget_removes_the_memory_and_its_notes(memory):
    memory.inbox.approve(propose(memory, "화면 문구는 해요체로 쓴다").id)
    memory.inbox.forget("team", "ui-tone")
    assert memory.store.list("team") == []
    assert memory.inbox.notes("team", "ui-tone").evidence == ()


# The agent's tool


def test_propose_memory_takes_the_users_last_message_as_evidence(memory):
    [tool] = memory.tools()
    state = State(id="session-1", messages=[Message.user("버튼은 해요체로 써줘"), Message.notice("ignored")])
    result = tool.invoke(
        {"kind": "rule", "scope": "team", "headline": "화면 문구는 해요체로 쓴다", "body": "", "name": "ui tone!"},
        state,
    )
    assert result.startswith("Suggested")
    [suggestion] = memory.inbox.pending()
    assert (suggestion.name, suggestion.source) == ("ui-tone", "agent")
    assert [(e.session, e.quote) for e in suggestion.evidence] == [("session-1", "버튼은 해요체로 써줘")]

    with pytest.raises(ToolError, match="only be kept"):
        tool.invoke({"kind": "user", "scope": "team", "headline": "x", "body": "", "name": "x"}, state)


# Every port can be replaced


class DictStore:
    def __init__(self) -> None:
        self.items: dict[tuple[Scope, str], Memory] = {}

    def list(self, scope: Scope) -> list[Memory]:
        return [m for (s, _), m in sorted(self.items.items()) if s == scope]

    def put(self, memory: Memory) -> Memory:
        self.items[memory.scope, memory.id] = memory
        return memory

    def remove(self, scope: Scope, memory_id: str) -> None:
        self.items.pop((scope, memory_id), None)


class LoadEverything:
    def system_block(self, memories: Sequence[Memory]) -> str:
        return "\n".join(f"{m.headline}: {m.body}" for m in memories)

    def notice(self, memory: Memory) -> str:
        return memory.headline

    def tools(self) -> list:
        return ["search"]


class Silent(Proposer):
    source = "test"


def test_every_part_can_be_replaced(project, home):
    store = DictStore()
    memory = memory_system(project, home=home, store=store, recall=LoadEverything(), proposer=Silent())
    kept = memory.inbox.approve(propose(memory, "화면 문구는 해요체로 쓴다").id)

    assert store.items == {("team", "ui-tone"): kept}
    assert not (project / ".alpine").exists()
    assert memory.system_block() == "화면 문구는 해요체로 쓴다: 이유: 사용자가 고쳐 말함."
    assert memory.tools() == ["search"]


def test_kinds_can_be_replaced(project, home):
    from alpine_core.memory import Kind

    memory = memory_system(project, home=home, kinds=[Kind("decision", "a design decision", "the decision")])
    with pytest.raises(Refused, match="kind must be one of decision"):
        propose(memory, "x")
    kept = memory.inbox.approve(propose(memory, "색은 토큰으로만", kind="decision").id)
    assert replace(kept, path=None) == Memory(
        "ui-tone", "decision", "team", "색은 토큰으로만", "이유: 사용자가 고쳐 말함."
    )
    assert "Headline: the decision" in memory.tools()[0].spec.description
