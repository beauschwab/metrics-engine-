"""The studio's chat event protocol — a frozen contract (ADR-37).

These are the exact event shapes the ChatPane has consumed since Phase 6:
``text``, ``tool_start``, ``tool_result``, ``turn_end``, ``done``, ``error``,
``unavailable``. This service may *add* event types (the client ignores
unknown ones — ``thread`` is the first addition) but never change or remove
these. Any change here is a breaking change to the studio and needs an ADR.
"""

from __future__ import annotations

from typing import Any

Event = dict[str, Any]


def text(delta: str) -> Event:
    return {"type": "text", "delta": delta}


def tool_start(name: str, tool_input: Any) -> Event:
    return {"type": "tool_start", "name": name, "input": tool_input}


def tool_result_ok(name: str, result: Any) -> Event:
    return {"type": "tool_result", "name": name, "ok": True, "result": result}


def tool_result_err(name: str, error: str) -> Event:
    # A refusal is a result — the server's 403s teach the agent the seam exists.
    return {"type": "tool_result", "name": name, "ok": False, "error": error}


def turn_end() -> Event:
    return {"type": "turn_end"}


def done(stop_reason: str = "end_turn") -> Event:
    return {"type": "done", "stop_reason": stop_reason}


def error(message: str) -> Event:
    return {"type": "error", "message": message}


def unavailable() -> Event:
    return {
        "type": "unavailable",
        "message": (
            "No model is configured (ANTHROPIC_API_KEY is not set). The rest of the "
            "studio works without me — the linter and data critic are deterministic."
        ),
    }


def agent_down() -> Event:
    """The proxy's degrade when this service itself is unreachable."""
    return {
        "type": "unavailable",
        "message": (
            "The agent service is not running (chartroom-agent, :8789). The rest of the "
            "studio works without me — the linter and data critic are deterministic."
        ),
    }


def thread(thread_id: str) -> Event:
    """Additive (ADR-38): names the server-side thread so the client can resume it."""
    return {"type": "thread", "thread_id": thread_id}


def sse(event: Event) -> str:
    import json

    return f"data: {json.dumps(event)}\n\n"
