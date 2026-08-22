"""The governed toolset — one MCP server over stdio, chosen by the surface.

This service defines no tools of its own. The tool surface *is* the surface's
MCP server (ADR-36: chartroom-mcp; ADR-56 adds registry-mcp), spawned as one
supervised subprocess and consumed through ``langchain-mcp-adapters`` — the
same tools Claude Code sees, under an agent identity the far side refuses at
every approval or write route. Zero duplication, and the entitlements live on
the far side of a boundary this process cannot cross.

The banned-name guard is defense in depth, not the enforcement: even if a
decide- or save-shaped tool somehow appeared in the roster, the server would
still refuse the agent identity. The guard exists so the roster drifting would
fail loudly at startup instead of quietly at runtime.
"""

from __future__ import annotations

import os

from langchain_core.tools import BaseTool
from langchain_mcp_adapters.client import MultiServerMCPClient
from langchain_mcp_adapters.sessions import StdioConnection

from .surfaces import APPS, CHARTROOM, Surface


def mcp_connection(
    surface: Surface = CHARTROOM,
    principal: str | None = None,
    chartroom_api: str | None = None,
) -> StdioConnection:
    """The stdio connection that fronts the surface's governed server."""
    env = {**os.environ, **surface.server_env}
    if surface is CHARTROOM:
        # The studio API's address is runtime configuration, not surface shape.
        env["CHARTROOM_API"] = chartroom_api or os.environ.get(
            "CHARTROOM_API", "http://127.0.0.1:8788"
        )
        if principal:
            env["CHARTROOM_MCP_USER"] = principal
    return StdioConnection(
        transport="stdio",
        command="npx",
        args=list(surface.server_args),
        cwd=str(APPS / surface.server_dir),
        env=env,
    )


def make_client(
    surface: Surface = CHARTROOM,
    principal: str | None = None,
    chartroom_api: str | None = None,
) -> MultiServerMCPClient:
    return MultiServerMCPClient(
        {surface.name: mcp_connection(surface, principal, chartroom_api)}
    )


def assert_governed(tools: list[BaseTool], surface: Surface = CHARTROOM) -> list[BaseTool]:
    """Fail startup loudly if the roster ever grows an approval- or write-shaped tool."""
    names = [t.name for t in tools]
    offenders = [
        n
        for n in names
        if n in surface.banned_names
        or any(fragment in n for fragment in surface.banned_fragments)
    ]
    if offenders:
        raise RuntimeError(
            f"the MCP roster carries approval-shaped tools {offenders} — the agent surface "
            "must stay propose-and-read (ADR-24/ADR-36/ADR-56)"
        )
    if not names:
        raise RuntimeError(f"the MCP roster is empty — {surface.server_dir} did not start")
    return tools
