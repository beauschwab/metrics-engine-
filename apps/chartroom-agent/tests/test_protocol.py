"""The frozen protocol (ADR-37): shapes and framing are byte-compatible with
the Phase-6 TS loop the studio pane was built against."""

import json

from chartroom_agent import protocol


def test_event_shapes_match_the_pane_contract() -> None:
    assert protocol.text("hi") == {"type": "text", "delta": "hi"}
    assert protocol.tool_start("lint_spec", {"spec": {}}) == {
        "type": "tool_start",
        "name": "lint_spec",
        "input": {"spec": {}},
    }
    assert protocol.tool_result_ok("lint_spec", {"ok": 1}) == {
        "type": "tool_result",
        "name": "lint_spec",
        "ok": True,
        "result": {"ok": 1},
    }
    err = protocol.tool_result_err("save_dashboard", "403")
    assert err["ok"] is False and err["error"] == "403"
    assert protocol.turn_end() == {"type": "turn_end"}
    assert protocol.done()["stop_reason"] == "end_turn"


def test_unavailable_names_what_still_works() -> None:
    # The pane's e2e asserts this word; it is part of the contract.
    assert "deterministic" in protocol.unavailable()["message"]
    assert "deterministic" in protocol.agent_down()["message"]


def test_sse_framing_is_exactly_data_json_double_newline() -> None:
    frame = protocol.sse(protocol.text("x"))
    assert frame.startswith("data: ")
    assert frame.endswith("\n\n")
    assert "\r" not in frame  # the pane splits on \n\n, not \r\n\r\n
    assert json.loads(frame[len("data: ") : -2]) == {"type": "text", "delta": "x"}


def test_thinking_is_additive_and_delta_shaped() -> None:
    # ADR-55: a reasoning delta. Same shape family as text — clients that
    # predate it ignore the unknown type, which is the freeze's whole promise.
    ev = protocol.thinking("weighing the grain")
    assert ev == {"type": "thinking", "delta": "weighing the grain"}


def test_thinky_reads_only_thinking_blocks() -> None:
    from chartroom_agent.agent import _texty, _thinky

    class Chunk:
        content = [
            {"type": "thinking", "thinking": "the audience is a committee"},
            {"type": "text", "text": "Here is the brief."},
        ]

    assert _thinky(Chunk()) == "the audience is a committee"
    assert _texty(Chunk()) == "Here is the brief."
    # A plain-string chunk has no thinking in it, whatever the model.

    class Plain:
        content = "just text"

    assert _thinky(Plain()) == ""
