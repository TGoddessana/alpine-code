from alpineagents import Agent, State, ToolCall
from alpineagents.permissions import Allowed, AllowPermission, DecidePermission, Denied
from alpineagents.testing import FakeModel

from alpine_core.approval import AllowByPolicy, DecideByApprover, Decision, build_permissions
from alpine_core.permissions import Mode, PermissionPolicy
from alpine_core.tools import Workspace, default_tools


class Approver:
    def __init__(self, *decisions: Decision) -> None:
        self.decisions = list(decisions)
        self.asked = 0

    def approve(self, request):
        self.asked += 1
        return self.decisions.pop(0)


def setup(tmp_path, mode=Mode.DEFAULT):
    (tmp_path / ".env").write_text("KEY=1")
    workspace = Workspace(tmp_path)
    policy = PermissionPolicy(workspace, mode)
    return policy, Agent(FakeModel([]), tools=default_tools(workspace)).tool_map


def check(permission, state, tools, name, **args):
    return permission.check(state, ToolCall(name, args, "c1"), tools[name])


def test_the_list_allows_by_policy_then_asks(tmp_path):
    policy, _ = setup(tmp_path)
    allow, decide = build_permissions(policy, Approver())
    assert isinstance(allow, AllowPermission) and isinstance(decide, DecidePermission)


def test_allow_by_policy_passes_on_what_needs_asking(tmp_path):
    policy, tools = setup(tmp_path)
    allow, state = AllowByPolicy(policy), State()
    assert check(allow, state, tools, "read", path="a.txt") == Allowed()
    assert check(allow, state, tools, "read", path=".env") is None
    assert check(allow, state, tools, "read", path=str(tmp_path.parent / "x.txt")) is None
    assert check(allow, state, tools, "bash", command="echo hi") is None
    policy.mode = Mode.YOLO
    assert check(allow, state, tools, "read", path=".env") == Allowed()


def test_allow_always_is_seen_by_allow_by_policy(tmp_path):
    policy, tools = setup(tmp_path)
    approver = Approver(Decision("allow_always"), Decision("deny"))
    allow, decide, state = AllowByPolicy(policy), DecideByApprover(policy, approver), State()
    assert check(decide, state, tools, "bash", command="echo 1") == Allowed()
    assert check(allow, state, tools, "bash", command="echo 2") == Allowed()
    assert check(allow, State(), tools, "bash", command="echo 2") is None  # another conversation
    assert isinstance(check(decide, state, tools, "bash", command="git push"), Denied)
    assert approver.asked == 2
