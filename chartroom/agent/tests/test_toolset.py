"""The governed toolset guard, and the parse of either request shape."""

import pytest
from langchain_core.tools import tool

from chartroom_agent.app import _parse_turn
from chartroom_agent.toolset import assert_governed


def _named(name: str):  # a minimal BaseTool with the given name
    @tool(name)
    def fn() -> str:
        """placeholder."""
        return ""

    return fn


def test_governed_roster_passes() -> None:
    tools = [_named("search_metrics"), _named("propose_metric"), _named("get_promotion_checklist")]
    assert assert_governed(tools) is tools


@pytest.mark.parametrize("bad", ["approve_brief", "decide_proposal", "promote_dashboard"])
def test_approval_shaped_tools_fail_startup(bad: str) -> None:
    with pytest.raises(RuntimeError, match="approval-shaped"):
        assert_governed([_named("search_metrics"), _named(bad)])


def test_empty_roster_fails_startup() -> None:
    with pytest.raises(RuntimeError, match="empty"):
        assert_governed([])


def test_parse_turn_thread_shape() -> None:
    message, thread_id, dash = _parse_turn(
        {"message": "hello", "thread_id": "t-1", "dashboard_id": "lcr-monitor"}
    )
    assert (message, thread_id, dash) == ("hello", "t-1", "lcr-monitor")


def test_parse_turn_legacy_shape_carries_history_as_context() -> None:
    message, thread_id, dash = _parse_turn(
        {
            "messages": [
                {"role": "user", "text": "first"},
                {"role": "assistant", "text": "reply"},
                {"role": "user", "text": "second"},
            ]
        }
    )
    assert "first" in message and "reply" in message and message.endswith("second")
    assert thread_id and dash is None


def test_parse_turn_rejects_empty() -> None:
    with pytest.raises(ValueError, match="send a message"):
        _parse_turn({"messages": []})
