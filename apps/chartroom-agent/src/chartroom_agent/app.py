"""The FastAPI surface — :8789 (ADR-36, E7.4).

One SSE endpoint speaking the studio's frozen protocol, one health check.
Frames are written by hand as ``data: <json>\\n\\n`` — byte-identical to the
Phase-6 TS loop — because the pane's parser splits on exactly that, and the
protocol is a frozen contract (ADR-37).

Startup opens a single supervised MCP session (chartroom-mcp over stdio) and
builds the deep agent over an async SQLite checkpointer; a session that dies
is torn down and reopened on the next request rather than killing the
service.

Request shapes accepted, both from the existing pane:
  {"message": "...", "thread_id": "...", "dashboard_id": "..."}   — resumes a thread
  {"messages": [{role, text}...], "dashboard_id": "..."}          — legacy shape;
    the last user message starts a fresh thread (prior text rides as context)

Every response ends with ``done``/``error``/``unavailable`` — a client never
hangs on silence.
"""

from __future__ import annotations

import contextlib
import os
import uuid
from collections.abc import AsyncIterator
from contextlib import AsyncExitStack
from typing import Any

from fastapi import FastAPI, Request
from fastapi.responses import StreamingResponse

from . import agent as agent_mod
from . import protocol
from .query_api import query_router
from .toolset import assert_governed, make_client

CHECKPOINT_DB = os.environ.get("CHARTROOM_AGENT_DB", "chartroom-agent.db")


class Runtime:
    """The MCP session + compiled agent, rebuilt if the subprocess dies."""

    def __init__(self) -> None:
        self.stack: AsyncExitStack | None = None
        self.agent: Any = None
        self.tool_names: list[str] = []

    async def ensure(self) -> Any:
        if self.agent is not None:
            return self.agent
        from langchain_mcp_adapters.tools import load_mcp_tools
        from langgraph.checkpoint.sqlite.aio import AsyncSqliteSaver

        self.stack = AsyncExitStack()
        client = make_client(principal=os.environ.get("CHARTROOM_MCP_USER"))
        session = await self.stack.enter_async_context(client.session("chartroom"))
        tools = assert_governed(await load_mcp_tools(session))
        self.tool_names = sorted(t.name for t in tools)
        saver = await self.stack.enter_async_context(
            AsyncSqliteSaver.from_conn_string(CHECKPOINT_DB)
        )
        self.agent = agent_mod.build_agent(tools, saver)
        return self.agent

    async def reset(self) -> None:
        if self.stack is not None:
            # A dead subprocess may fail its own teardown; that's fine.
            with contextlib.suppress(Exception):
                await self.stack.aclose()
        self.stack = None
        self.agent = None


def _parse_turn(body: dict[str, Any]) -> tuple[str, str, str | None]:
    """(message, thread_id, dashboard_id) from either accepted shape."""
    dashboard_id = body.get("dashboard_id") or None
    if isinstance(body.get("message"), str) and body["message"].strip():
        thread_id = str(body.get("thread_id") or uuid.uuid4())
        return body["message"], thread_id, dashboard_id

    messages = body.get("messages") or []
    users = [m for m in messages if isinstance(m, dict) and m.get("role") == "user"]
    if not users:
        raise ValueError("send a message: {message, thread_id?} or {messages: [...]}")
    # Legacy shape: fresh thread; earlier turns ride along as context.
    prior = messages[:-1]
    message = str(users[-1].get("text", ""))
    if prior:
        transcript = "\n".join(f"{m.get('role')}: {m.get('text', '')}" for m in prior)
        message = f"(Earlier in this conversation:\n{transcript})\n\n{message}"
    return message, str(uuid.uuid4()), dashboard_id


def create_app() -> FastAPI:
    runtime = Runtime()

    @contextlib.asynccontextmanager
    async def lifespan(_app: FastAPI) -> AsyncIterator[None]:
        yield
        await runtime.reset()

    app = FastAPI(title="chartroom-agent", lifespan=lifespan)
    app.state.runtime = runtime
    # E8.2: the warehouse query executor rides in the same service — the
    # chat loop and the query path share a process, not a fate; queries
    # never touch the model or the MCP session.
    app.include_router(query_router())

    @app.get("/healthz")
    async def healthz() -> dict[str, Any]:
        return {
            "ok": True,
            "model_available": agent_mod.model_available(),
            "tools": len(runtime.tool_names),
        }

    @app.post("/agent/chat")
    async def chat(request: Request) -> StreamingResponse:
        body = await request.json()

        async def frames() -> AsyncIterator[str]:
            if not agent_mod.model_available():
                yield protocol.sse(protocol.unavailable())
                return
            try:
                message, thread_id, dashboard_id = _parse_turn(body)
            except ValueError as exc:
                yield protocol.sse(protocol.error(str(exc)))
                return
            try:
                compiled = await runtime.ensure()
            except Exception as exc:  # noqa: BLE001 — MCP failure is an event, not a 500
                await runtime.reset()
                yield protocol.sse(protocol.error(f"the tool surface failed to start: {exc}"))
                return
            async for event in agent_mod.stream_turn(compiled, message, thread_id, dashboard_id):
                if await request.is_disconnected():
                    return
                yield protocol.sse(event)

        return StreamingResponse(
            frames(),
            media_type="text/event-stream",
            headers={"cache-control": "no-cache"},
        )

    return app


app = create_app()
