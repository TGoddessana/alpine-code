from alpine_core.events import ToolFinished
from alpine_core.items import ItemCompleted, ItemRecorder, item_from_dict, item_to_dict
from alpine_core.storage import SessionInfo
from alpine_protocol import SessionOpenResult
from alpine_server.wire import to_event_params, to_info, to_item


def test_actual_outcomes_roundtrip_through_log_snapshot_and_event():
    command = {"stdout": "failed", "stderr": "error", "exit_code": 3, "timed_out": False, "cancelled": False}
    changes = [{"path": "a.txt", "added": 1, "removed": 1, "diff": ["@@ -1 +1 @@", "-old", "+new"]}]
    recorder = ItemRecorder(lambda seq, event: None)
    recorder.handle(ToolFinished("c1", "bash", {"command": "exit 3"}, "failed", "error", 0, command, changes))
    [item] = recorder.items
    restored = item_from_dict(item_to_dict(item))
    wire = to_item(restored)
    assert wire.command_result.exit_code == 3 and wire.status == "error"
    params = to_event_params("session", 1, ItemCompleted(restored)).model_dump(mode="json", by_alias=True)
    assert params["event"]["item"]["commandResult"]["exitCode"] == 3
    assert params["event"]["item"]["fileChanges"] == changes
    assert SessionOpenResult.model_validate({"info": _info(), "seq": 1, "items": [wire], "active": []}).items[0] == wire


def _info():
    return to_info(
        SessionInfo(
            id="session",
            title="test",
            cwd="/tmp",
            model="fake",
            mode="yolo",
            created_at="2020-01-01T00:00:00Z",
            updated_at="2020-01-01T00:00:00Z",
        )
    )


def test_private_baseline_never_goes_on_the_wire():
    info = SessionInfo(
        id="session",
        title="test",
        cwd="/tmp",
        model="fake",
        mode="yolo",
        created_at="2020-01-01T00:00:00Z",
        updated_at="2020-01-01T00:00:00Z",
        work_baseline={"secret": {"text": "original"}},
    )
    data = to_info(info).model_dump(mode="json", by_alias=True)
    assert "workBaseline" not in data and "work_baseline" not in data
