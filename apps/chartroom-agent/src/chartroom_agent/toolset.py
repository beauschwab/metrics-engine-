"""The governed toolset — chartroom-mcp over stdio (ADR-36).

This service defines no tools of its own. The tool surface *is*
``chartroom-mcp``, spawned as one supervised subprocess and consumed through
``langchain-mcp-adapters`` — the same 25 tools Claude Code sees, under an
``agent:lg-<session>`` identity the server refuses at every approval route.
Zero duplication, and the entitlements live on the far side of an HTTP
boundary this process cannot cross.

The banned-name guard is defense in depth, not the enforcement: even if a
decide tool somehow appeared in the roster, the server would still 403 the
agent identity. The guard exists so the roster drifting would fail loudly at
startup instead of quietly at runtime.
"""

from __future__ import annotations

import os
from pathlib import Path

from langchain_core.tools import BaseTool
from langchain_mcp_adapters.client import MultiServerMCPClient
from langchain_mcp_adapters.sessions import StdioConnection

# …/apps/chartroom-agent/src/chartroom_agent/toolset.py → parents[3] is apps/.
MCP_DIR = Path(__file__).resolve().parents[3] / "chartroom-mcp"

BANNED_FRAGMENTS = ("approve", "decide")
BANNED_NAMES = ("promote_dashboard",)


def mcp_connection(
    chartroom_api: str | None = None,
    principal: str | None = None,
) -> StdioConnection:
    """The stdio connection that fronts the governed API.

    ``CHARTROOM_MCP_LABEL=lg`` makes the audit trail say which surface acted
    (``agent:lg-…``); it is cosmetic to entitlements — ``agent:*`` is an agent
    to the server whatever it calls itself.
    """
    env = {
        **os.environ,
        "CHARTROOM_API": chartroom_api or os.environ.get("CHARTROOM_API", "http://127.0.0.1:8788"),
        "CHARTROOM_MCP_LABEL": "lg",
    }
    if principal:
        env["CHARTROOM_MCP_USER"] = principal
    return StdioConnection(
        transport="stdio",
        command="npx",
        args=["tsx", "src/server.ts"],
        cwd=str(MCP_DIR),
        env=env,
    )


def make_client(
    chartroom_api: str | None = None, principal: str | None = None
) -> MultiServerMCPClient:
    return MultiServerMCPClient({"chartroom": mcp_connection(chartroom_api, principal)})


def assert_governed(tools: list[BaseTool]) -> list[BaseTool]:
    """Fail startup loudly if the roster ever grows an approval-shaped tool."""
    names = [t.name for t in tools]
    offenders = [
        n
        for n in names
        if n in BANNED_NAMES or any(fragment in n for fragment in BANNED_FRAGMENTS)
    ]
    if offenders:
        raise RuntimeError(
            f"the MCP roster carries approval-shaped tools {offenders} — the agent surface "
            "must stay propose-and-read (ADR-24/ADR-36)"
        )
    if not names:
        raise RuntimeError("the MCP roster is empty — chartroom-mcp did not start")
    return tools
