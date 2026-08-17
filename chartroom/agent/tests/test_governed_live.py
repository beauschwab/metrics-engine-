"""The entitlement seam, exercised for real: a chartroom-server process, the
chartroom-mcp subprocess, and the langchain adapters between — the same wiring
the service runs in production, minus the model.

These are the assertions the Phase-6 chat tests carried; they migrate here
because this is now the surface that fronts the agent (ADR-36).
"""

import json
import os
import subprocess
import tempfile
from pathlib import Path

import httpx
import pytest
from langchain_mcp_adapters.tools import load_mcp_tools

from chartroom_agent.toolset import assert_governed, make_client

REPO = Path(__file__).resolve().parents[3]
PORT = 8500 + (os.getpid() % 90)
API = f"http://127.0.0.1:{PORT}"


@pytest.fixture(scope="module")
def server() -> subprocess.Popen:
    db = tempfile.mktemp(suffix=".db", prefix="chartroom-agent-test-")
    proc = subprocess.Popen(
        ["npx", "tsx", "src/index.ts"],
        cwd=REPO / "chartroom" / "server",
        env={
            **os.environ,
            "CHARTROOM_PORT": str(PORT),
            "CHARTROOM_SQLITE_FILE": db,
            "KEEL_API": "http://127.0.0.1:9",  # shipped-docs fallback, hermetic
        },
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    for _ in range(120):
        try:
            if httpx.get(f"{API}/api/health", timeout=1).status_code == 200:
                break
        except httpx.HTTPError:
            pass
        import time

        time.sleep(0.5)
    yield proc
    proc.kill()


async def test_roster_is_governed_and_full(server: subprocess.Popen) -> None:
    client = make_client(chartroom_api=API, principal="beau")
    async with client.session("chartroom") as session:
        tools = assert_governed(await load_mcp_tools(session))
        names = {t.name for t in tools}
        assert len(names) == 28
        assert {
            "search_metrics", "propose_metric", "get_promotion_checklist",
            # Phase 10: the escape hatch rides the same governed roster.
            "propose_widget", "propose_pattern", "list_catalog",
        } <= names
        # The absences that ARE the design.
        assert not [n for n in names if "approve" in n or "decide" in n or n == "promote_dashboard"]


async def test_agent_identity_cannot_compose_before_approval(server: subprocess.Popen) -> None:
    """The 403 seam holds through the whole Python stack, not just in theory."""
    client = make_client(chartroom_api=API, principal="beau")
    async with client.session("chartroom") as session:
        tools = {t.name: t for t in await load_mcp_tools(session)}
        await tools["create_dashboard"].ainvoke({"id": "lg-board", "title": "LG board"})
        spec = {
            "chartroom": "0.1",
            "dashboard": {
                "id": "lg-board",
                "title": "LG board",
                "pattern": {"none": {"justification": "an entitlement test dashboard"}},
                "audience": "alm-analyst",
                "cadence": "eod",
                "status": "draft",
            },
            "context": {},
            "layout": {"grid": {"cols": 12, "row_height": 96}},
            "widgets": [
                {
                    "id": "tile",
                    "type": "kpi-tile@1",
                    "pos": {"x": 0, "y": 0, "w": 3, "h": 2},
                    "bind": {"metric": "keel://liquidity_pit.lcr_pct@1"},
                }
            ],
            "interactions": [],
        }
        result = await tools["save_dashboard"].ainvoke({"dashboard_id": "lg-board", "spec": spec})
        # handle_tool_errors=True: the refusal comes back as the tool's text.
        assert "approval" in str(result) or "brief" in str(result)

    # And approving directly, as the lg identity, is refused on identity alone.
    r = httpx.post(
        f"{API}/api/dashboards/lg-board/brief/approve",
        headers={"x-identity": "agent:lg-direct", "content-type": "application/json"},
        timeout=10,
    )
    assert r.status_code == 403


async def test_search_returns_real_contracts(server: subprocess.Popen) -> None:
    client = make_client(chartroom_api=API, principal="beau")
    async with client.session("chartroom") as session:
        tools = {t.name: t for t in await load_mcp_tools(session)}
        result = await tools["search_metrics"].ainvoke({"query": "lcr_pct"})
        # The adapters may hand back a JSON string or already-parsed blocks.
        if isinstance(result, str):
            payload = json.loads(result)
        elif isinstance(result, list):
            first = result[0]
            payload = json.loads(first["text"]) if isinstance(first, dict) else json.loads(first)
        else:
            payload = result
        assert payload["count"] > 0


HAS_KEY = bool(os.environ.get("ANTHROPIC_API_KEY"))


@pytest.mark.skipif(not HAS_KEY, reason="set ANTHROPIC_API_KEY to run the live loop")
async def test_live_loop_uses_a_tool(server: subprocess.Popen, tmp_path: Path) -> None:
    from langgraph.checkpoint.sqlite.aio import AsyncSqliteSaver

    from chartroom_agent.agent import build_agent, stream_turn

    client = make_client(chartroom_api=API, principal="beau")
    async with client.session("chartroom") as session:
        tools = assert_governed(await load_mcp_tools(session))
        async with AsyncSqliteSaver.from_conn_string(str(tmp_path / "cp.db")) as saver:
            agent = build_agent(tools, saver)
            events = []
            async for event in stream_turn(
                agent, "What LCR metrics exist in the registry? Use your tools.", "t-live"
            ):
                events.append(event)
            assert any(e["type"] == "tool_start" for e in events)
            assert events[-1]["type"] == "done"


def test_skip_notice() -> None:
    if not HAS_KEY:
        assert not HAS_KEY  # skipped the live-loop check — set ANTHROPIC_API_KEY to run it


