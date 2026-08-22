"""The governed toolset guard, and the parse of either request shape."""

import pytest
from langchain_core.tools import tool

from chartroom_agent.app import _parse_turn
from chartroom_agent.surfaces import CHARTROOM, REGISTRY, SURFACES, current
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


# ---- the registry surface (ADR-56) ----------------------------------------


def test_registry_roster_passes_on_reads_and_dry_runs() -> None:
    tools = [_named("get_rules"), _named("test_rules"), _named("assess_change"), _named("validate")]
    assert assert_governed(tools, REGISTRY) is tools


@pytest.mark.parametrize("bad", ["save_artifact", "promote", "create_release", "approve_thing"])
def test_registry_write_shaped_tools_fail_startup(bad: str) -> None:
    # registry-mcp never registers these for an agent: identity; if the roster
    # drifts, this is the loud startup failure rather than the quiet runtime one.
    with pytest.raises(RuntimeError, match="approval-shaped"):
        assert_governed([_named("get_rules"), _named(bad)], REGISTRY)


def test_registry_surface_shape() -> None:
    # The identity IS the entitlement: it must carry the agent: prefix the
    # registry server refuses writes for, and the write flag must not be set.
    assert REGISTRY.server_env["KEEL_MCP_IDENTITY"].startswith("agent:")
    assert "KEEL_MCP_WRITE" not in REGISTRY.server_env
    # The prompt encodes the propose→prove→hand-over loop, not a write path.
    for expected in ("test_rules", "assess_change", "cannot save", "human saves"):
        assert expected in REGISTRY.system_prompt

def test_surface_selection_defaults_to_chartroom(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("AGENT_SURFACE", raising=False)
    assert current() is CHARTROOM
    monkeypatch.setenv("AGENT_SURFACE", "registry")
    assert current() is REGISTRY
    monkeypatch.setenv("AGENT_SURFACE", "nope")
    with pytest.raises(RuntimeError, match="not a surface"):
        current()
    assert set(SURFACES) == {"chartroom", "registry"}


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


def test_parse_turn_document_id_is_the_registry_synonym() -> None:
    message, _thread, context = _parse_turn(
        {"message": "hello", "document_id": "fr2052a_product_id"}
    )
    assert (message, context) == ("hello", "fr2052a_product_id")
