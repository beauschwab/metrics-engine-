"""The deep agent and its event stream (ADR-36, ADR-38).

``create_deep_agent`` supplies the loop — planning, subagents, tool
execution — on ``claude-opus-5`` (the same model as the design critic). The
§3 journey (intake → brief → human approval → compose → critique) is encoded
in the system prompt and *enforced* by the chartroom-server's 403s; a bespoke
LangGraph state machine re-enforcing the same gates was considered and
rejected as duplicate enforcement that could only ever disagree with the
server (recorded in ADR-36).

Threads are real (ADR-38): a LangGraph checkpointer holds the conversation
server-side, replacing the Phase-6 text-only replay. ``stream_turn`` adapts
``astream_events`` to the frozen studio protocol.
"""

from __future__ import annotations

import os
from collections.abc import AsyncIterator
from typing import Any

from langchain_core.tools import BaseTool

from . import protocol
from .protocol import Event
from .surfaces import CHARTROOM

MODEL = "claude-opus-5"
MAX_TOKENS = 16000

# The journeys themselves live with the surfaces (ADR-56) — one home for what
# differs between embeddings, and this module keeps the loop they share.
SYSTEM_PROMPT = CHARTROOM.system_prompt


def model_available() -> bool:
    return bool(os.environ.get("ANTHROPIC_API_KEY"))


def build_agent(
    tools: list[BaseTool], checkpointer: Any, system_prompt: str = SYSTEM_PROMPT
) -> Any:
    from deepagents import create_deep_agent
    from langchain_anthropic import ChatAnthropic

    # The alias-form kwargs (`model_name`, `max_tokens_to_sample`) are what
    # the pydantic model's constructor is typed with; `model=`/`max_tokens=`
    # work at runtime but fail type-checking on langchain-anthropic 1.5.x.
    model = ChatAnthropic(
        model_name=MODEL, max_tokens_to_sample=MAX_TOKENS, timeout=None, stop=None
    )
    return create_deep_agent(
        model=model,
        tools=tools,
        system_prompt=system_prompt,
        checkpointer=checkpointer,
    )


def _texty(chunk: Any) -> str:
    """Text out of a streamed AIMessageChunk, whatever block shape it used."""
    content = getattr(chunk, "content", "")
    if isinstance(content, str):
        return content
    out: list[str] = []
    for block in content:
        if isinstance(block, dict) and block.get("type") in (None, "text"):
            out.append(str(block.get("text", "")))
        elif isinstance(block, str):
            out.append(block)
    return "".join(out)


def _thinky(chunk: Any) -> str:
    """Reasoning text out of a streamed chunk, when the model produced any."""
    content = getattr(chunk, "content", "")
    if isinstance(content, str):
        return ""
    out: list[str] = []
    for block in content:
        if isinstance(block, dict) and block.get("type") == "thinking":
            out.append(str(block.get("thinking", "")))
    return "".join(out)


def _clip(value: Any, limit: int = 20_000) -> Any:
    text = value if isinstance(value, str) else str(value)
    return text if len(text) <= limit else text[:limit] + " …[truncated]"


async def stream_turn(
    agent: Any,
    message: str,
    thread_id: str,
    context_id: str | None = None,
    context_template: str = CHARTROOM.context_template,
) -> AsyncIterator[Event]:
    """One user turn → the frozen event protocol, streamed.

    ``context_id`` is the artifact the client had open — a dashboard on the
    studio, a document on the authoring surface — and the surface's template
    says how that reads to the model.
    """
    content = message
    if context_id:
        content = f"{message}\n\n{context_template.format(id=context_id)}"

    config = {"configurable": {"thread_id": thread_id}}
    yield protocol.thread(thread_id)

    saw_tools_this_step = False
    try:
        async for event in agent.astream_events(
            {"messages": [{"role": "user", "content": content}]},
            config=config,
            version="v2",
        ):
            kind = event.get("event")
            if kind == "on_chat_model_stream":
                chunk = event["data"]["chunk"]
                thought = _thinky(chunk)
                if thought:
                    yield protocol.thinking(thought)
                delta = _texty(chunk)
                if delta:
                    yield protocol.text(delta)
            elif kind == "on_tool_start":
                saw_tools_this_step = True
                yield protocol.tool_start(event.get("name", "tool"), event["data"].get("input"))
            elif kind == "on_tool_end":
                output = event["data"].get("output")
                yield protocol.tool_result_ok(event.get("name", "tool"), _clip(output))
            elif kind == "on_tool_error":
                yield protocol.tool_result_err(
                    event.get("name", "tool"), _clip(event["data"].get("error", "tool failed"))
                )
            elif kind == "on_chat_model_end" and saw_tools_this_step:
                saw_tools_this_step = False
                yield protocol.turn_end()
        yield protocol.done()
    except Exception as exc:  # noqa: BLE001 — every failure becomes a protocol event
        yield protocol.error(_clip(str(exc), 2_000))
