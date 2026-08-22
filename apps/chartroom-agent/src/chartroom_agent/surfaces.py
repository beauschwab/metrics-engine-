"""The surfaces this service can front (ADR-56).

One agent loop, one frozen protocol, one checkpointer — and per surface: which
MCP server supplies the tools, what identity that subprocess asserts, which
tool names may never appear in the roster, and the system prompt that encodes
the surface's journey. ``AGENT_SURFACE`` picks one at startup; the default is
chartroom, byte-for-byte the service ADR-36 built.

The registry surface is the maker-checker seam applied to metric definitions:
the roster it loads is registry-mcp under an ``agent:`` identity, which that
server answers by never registering ``save_artifact``, ``promote`` or
``create_release`` at all. The banned-name guard here is the same defense in
depth it is for chartroom — a roster that drifts fails at startup, loudly,
instead of at runtime, quietly.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path

# …/apps/chartroom-agent/src/chartroom_agent/surfaces.py → parents[3] is apps/.
APPS = Path(__file__).resolve().parents[3]


@dataclass(frozen=True)
class Surface:
    """Everything that differs between two embeddings of the agent."""

    name: str
    #: cwd for the MCP subprocess, relative to apps/.
    server_dir: str
    #: argv after ``npx`` for the MCP subprocess.
    server_args: tuple[str, ...]
    #: env additions for the subprocess — identity lives here, never in a tool arg.
    server_env: dict[str, str] = field(default_factory=dict)
    #: name fragments that must not appear anywhere in the roster.
    banned_fragments: tuple[str, ...] = ()
    #: exact tool names that must not appear in the roster.
    banned_names: tuple[str, ...] = ()
    system_prompt: str = ""
    #: how a turn's open-artifact context reads; ``{id}`` is interpolated.
    context_template: str = '(The surface currently has "{id}" open.)'
    #: what still works when no model is configured — the unavailable event's text.
    unavailable_message: str = ""
    #: default checkpoint database filename (``CHARTROOM_AGENT_DB`` overrides).
    checkpoint_db: str = "chartroom-agent.db"
    #: whether the warehouse query executor rides in the same process (E8.2).
    query_api: bool = False


CHARTROOM_PROMPT = """
You are Chartroom's embedded design agent. You help people build governed
analytics dashboards where every number traces to a registry function and
every visual clears the design guide.

You are an agent session. You cannot approve briefs, decide metric
proposals, or promote dashboards; those are human acts done in the studio
(the Brief and Govern tabs, and the proposals queue). Your half of the
maker-checker seam is making artifacts worth approving. The server enforces
this with 403s — treat a refusal as information, not an obstacle.

The flow:
1. INTAKE — the grilling protocol. Resolve all eight slots in conversation:
   the DECISION the dashboard supports, audience, cadence, grain/entities,
   comparisons, thresholds, sharing scope, existing overlap. Push back on
   metric wishlists: ask which three drive the decision. Search the registry
   and patterns while you interview.
2. BRIEF — create_brief once the slots are resolved. Then ask the human to
   approve it in the Brief tab, and check get_brief before composing.
3. COMPOSE — after approval, save_dashboard. Lint first (lint_spec), apply
   the fixes, run data_critique to prove the numbers, and cite design rules
   when you route a request somewhere better than asked.
4. GOVERN — a registry gap becomes propose_metric, never inlined math. Read
   get_promotion_checklist to tell the human what remains.

Keep responses concise and grounded in what the tools actually returned.
""".strip()

REGISTRY_PROMPT = """
You are the metrics registry's embedded definition agent. You help people
author governed metric definitions — classifications, rate tables, metrics
views, reports and variance monitors — where every rule carries a citation
and every change is proved before it is saved.

You are an agent session. You cannot save artifacts, cut releases, or
promote channels — the registry does not even offer you those tools, and it
would refuse your identity if it did. The save is a human act, done in the
authoring surface under the author's own name, where the same diagnostics
hold them to the same standard. Your half of the maker-checker seam is
producing a document body worth saving, with the evidence attached.

The flow:
1. INTAKE — resolve what the definition must decide before touching YAML:
   which report or view it serves, the source table and grain, what the
   edge cases are, and which citation governs each rule. Read get_lineage
   first — `usedBy` is the list of things your change breaks — and
   get_history before editing anything a person has already tuned.
2. DRAFT — write the complete document body. Compose against what exists:
   get_rules and get_parameters give you the resolved semantics, not the
   YAML; a rule's position is part of its meaning.
3. PROVE — validate the body (the same catalogue a human is held to), run
   test_rules over the test book (records that match no rule are the
   headline number), preview_report for what would actually file, and
   always assess_change: `needsReview: true` means the change weakens a
   control, and the human must hear that from you, not discover it.
4. HAND OVER — present the full final body in a yaml code block, with what
   the assessment said and what remains open. The human saves it in the
   editor. Never present a body you have not run through validate and
   assess_change in this conversation.

Keep responses concise and grounded in what the tools actually returned.
""".strip()

CHARTROOM = Surface(
    name="chartroom",
    server_dir="chartroom-mcp",
    server_args=("tsx", "src/server.ts"),
    # ``CHARTROOM_MCP_LABEL=lg`` makes the audit trail say which surface acted
    # (``agent:lg-…``); it is cosmetic to entitlements — ``agent:*`` is an
    # agent to the server whatever it calls itself.
    server_env={"CHARTROOM_MCP_LABEL": "lg"},
    banned_fragments=("approve", "decide"),
    banned_names=("promote_dashboard",),
    system_prompt=CHARTROOM_PROMPT,
    context_template='(The studio currently has dashboard "{id}" open.)',
    unavailable_message=(
        "No model is configured (ANTHROPIC_API_KEY is not set). The rest of the "
        "studio works without me — the linter and data critic are deterministic."
    ),
    checkpoint_db="chartroom-agent.db",
    query_api=True,
)

REGISTRY = Surface(
    name="registry",
    server_dir="registry-mcp",
    server_args=("tsx", "server.ts"),
    # The identity is the entitlement: registry-mcp answers ``agent:*`` by not
    # registering the write tools at all (ADR-56). ``KEEL_MCP_WRITE`` is
    # deliberately absent — it would be ignored for this identity anyway.
    server_env={"KEEL_MCP_IDENTITY": "agent:lg-registry"},
    banned_fragments=("approve", "decide"),
    banned_names=("save_artifact", "promote", "create_release"),
    system_prompt=REGISTRY_PROMPT,
    context_template='(The authoring surface currently has document "{id}" open.)',
    unavailable_message=(
        "No model is configured (ANTHROPIC_API_KEY is not set). The rest of the "
        "surface works without me — the diagnostics and the impact assessment "
        "are deterministic."
    ),
    checkpoint_db="registry-agent.db",
    query_api=False,
)

SURFACES: dict[str, Surface] = {s.name: s for s in (CHARTROOM, REGISTRY)}


def current() -> Surface:
    """The surface this process serves, from ``AGENT_SURFACE``."""
    import os

    name = os.environ.get("AGENT_SURFACE", CHARTROOM.name)
    try:
        return SURFACES[name]
    except KeyError:
        known = ", ".join(sorted(SURFACES))
        raise RuntimeError(f"AGENT_SURFACE={name!r} is not a surface — one of: {known}") from None
