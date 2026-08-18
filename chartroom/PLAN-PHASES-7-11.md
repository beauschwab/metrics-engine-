# Chartroom Phases 7–11 — closing the PRD gaps

Status: phases 7–10 shipped; phase 11 outstanding · Owner: platform ·
Prereq reading: `chartroom-prd.md`, `ADRS.md` (1–49), `README.md`

The ADR numbers this plan predicts for phases 9 and 10 are not the ones that
shipped — `ADRS.md` is authoritative where the two disagree.

This plan closes every gap identified in the PRD review, in dependency order,
under one new architectural directive: **the agent backend moves to Python —
LangGraph + deepagents on FastAPI.** The TypeScript surfaces (spec, linter,
widgets, studio, server, MCP) stay; the agent *runtime* becomes a Python
service that consumes the same governed tool surface.

What does not change, in any phase: approvals, decisions, and promotion stay
human-only at the chartroom-server API; `chartroom/spec` stays pure; the
dependency direction holds; deviations from this plan get ADRs.

---

## Target architecture

```
studio (React) ──► chartroom-server (TS, :8788)          KEEL registry (:8787)
   │  /api/chat proxy │        ▲    ▲                            ▲
   ▼                  ▼        │    │ HTTP (agent:lg-*)          │
chartroom-agent (Python FastAPI, :8789)                          │
   ├─ LangGraph + deepagents loop (claude-opus-5)                │
   ├─ tools via langchain-mcp-adapters ──► chartroom-mcp (stdio)─┘
   └─ /query executor (duckdb · Dremio Flight SQL) ◄── QueryService seam
```

Two Python responsibilities, one service: the **agent loop** (Phase 7) and
the **warehouse query executor** (Phase 8). Both are things Python is simply
better equipped for here — LangGraph's checkpointing/interrupt machinery and
deepagents' planning on one side, `duckdb` + `pyarrow` Flight SQL + `polars`
on the other.

---

## Phase 7 — the Python agent service (langgraph / deepagents / FastAPI) — SHIPPED

Replaces the TS chat loop (ADR-34) with a durable, graph-structured agent
runtime. The studio pane and its SSE event protocol are **frozen contracts**
— the client does not change beyond a thread id.

| Epic | Scope | Size |
|---|---|---|
| **E7.1 Scaffold** | `chartroom/agent/`: `pyproject.toml` (uv), FastAPI, `langgraph`, `deepagents`, `langchain-anthropic`, `langchain-mcp-adapters`, `sse-starlette`, pytest + ruff + mypy. **Step zero: pin exact versions and spike the deepagents + MCP-adapter integration** — these libraries move fast; the spike validates the plan's API assumptions before anything depends on them. | S |
| **E7.2 Governed toolset via MCP** | The agent's tools ARE `chartroom-mcp`, consumed over stdio via `langchain-mcp-adapters` — zero tool duplication, and the PRD §8 portability bet pays off (studio, Claude Code, and LangGraph now share one tool surface). Identity `agent:lg-<session>` and the human principal ride the MCP env (`CHARTROOM_MCP_USER`). One MCP subprocess per service (not per session), restarted on failure. | M |
| **E7.3 The graph** | `create_deep_agent` (planning + subagents) wrapped in a LangGraph state machine that encodes the §3 journey: intake-slot tracking → brief filed → *check* brief approval via `get_brief` (the gate itself stays in chartroom-server; the graph reads state, never owns approval) → compose → lint/data-critique loop → iterate. LangGraph checkpointer (SQLite dev / Postgres prod) gives real threads — replacing ADR-34's text-only replay (ADR revision). `interrupt()` reserved for clarifying questions, never for approvals. Model: `claude-opus-5`, adaptive thinking (default), streamed. | L |
| **E7.4 FastAPI SSE endpoint** | `POST /agent/chat` speaking the existing ChatPane event protocol verbatim: `text` / `tool_start` / `tool_result` / `turn_end` / `done` / `error` / `unavailable`. `GET /healthz`. No `ANTHROPIC_API_KEY` → the same honest `unavailable` event (ADR-35 posture, ported). | M |
| **E7.5 Server proxy + retirement** | chartroom-server's `/api/chat` becomes a streaming proxy to `:8789` (single origin, identity stays server-side); agent service down → `unavailable` event, not a 502. `chat.ts`'s loop is deleted after parity; its protocol/entitlement tests migrate (the toolset-holds-no-approve-tool assertion now runs against the MCP roster the adapters load). | M |
| **E7.6 Tests** | pytest: event-protocol translation, graph stage-ordering with a scripted fake model, MCP tool wiring against a live chartroom-server + registry (spawned, as governance tests do); one key-gated live-loop test. Studio e2e degrade path unchanged. `verify:chartroom` grows a `verify:agent` leg (ruff + mypy + pytest). | M |

**Acceptance:** the studio chat works end-to-end through the Python service
with a key; without one, the banner; an `agent:lg-*` identity is refused at
every approval route; a thread resumes across service restarts via the
checkpointer.

**ADR candidates:** ADR-36 agent runtime in Python (why LangGraph/deepagents;
what retires); ADR-37 the SSE event protocol as a frozen contract; ADR-38
threads move server-side (revises ADR-34's text-replay).

---

## Phase 8 — real data backends (PRD promise #2) — SHIPPED

The biggest gap: queries currently evaluate in-process against governed
fixtures. This phase makes the backend a routing decision, per the PRD.

| Epic | Scope | Size |
|---|---|---|
| **E8.1 Executor seam** | `QueryService` splits behind an executor interface: `FixtureExecutor` (today's Evaluator path, kept forever for tests/offline) and `WarehouseExecutor` (delegates to the Python service). `CHARTROOM_BACKEND=fixtures|duckdb|dremio` selects; the response shape (`scalar`/`groups`/`series` + cost + asOf) is unchanged. | M |
| **E8.2 Python `/query` executor** | The agent service gains a `/query/run` router: compiles `(metric, dims, filters, window, params)` into **aggregate-only SQL** over the semantic views the engine already emits (`emitSemantic` per document, materialized as views in DuckDB dev / as Dremio VDS references in prod). DuckDB for dev (seeded from the fixture tables, so parity is checkable); Dremio via `pyarrow` Flight SQL with **PAT auth** (pinned decision). `polars` for post-aggregation shaping only. The aggregates-only boundary is preserved *structurally*: the SQL generator can only emit GROUP BY aggregates; the sampled-rows extract stays a separate server-side-flagged, allowlisted endpoint (pinned residency decision: aggregates by default, sample as opt-in). | XL |
| **E8.3 Parity harness** | Every query-shape in the test corpus runs against fixtures AND DuckDB in CI; values must agree within 1e-6. This is the MASS-01 discipline turned cross-backend — the fixture path becomes the oracle for the warehouse path. | M |
| **E8.4 Cost + staleness** | Cost estimates from `EXPLAIN` (DuckDB) / Flight metadata (Dremio) replace the fixture row counts; staleness becomes real — `max(as_of_date)` vs the dashboard's declared cadence drives the widget `stale` status the vocabulary has carried since Phase 1. | M |
| **E8.5 Streaming seam, still a seam** | Deephaven stays deferred (ADR-30) — but E8.1's executor interface is written so a `subscribe()`-capable executor slots in without touching widgets. | S |

**Acceptance:** the dogfood dashboards render from DuckDB with parity-equal
numbers; a Dremio smoke test (env-gated on `DREMIO_PAT`) round-trips one
scalar and one grouped query; `registry: shipped` fallback still works
offline.

**ADR candidates:** ADR-39 executor seam + fixture oracle; ADR-40 Python owns
warehouse execution; ADR-41 staleness derives from warehouse as-of.

---

## Phase 9 — catalog depth (7 widgets, 3 patterns) — SHIPPED

| Epic | Scope | Size |
|---|---|---|
| **E9.1 Widgets** | `stacked-area`, `waterfall`, `small-multiples`, `heatmap`, `distribution`, `bullet` (limit-gauge), `annotation` (commentary panel) — each a versioned contract + native SVG renderer + harness states + deck-export mapping + widget-form support. | L |
| **E9.2 New lint rules** | Only where the guide demands: `SM-01` small multiples share scales; `WF-01` waterfall bridges sum start→end; `AREA-01` stacked area is part-to-whole of nonnegative additive measures (AGG-01's sibling); `GAUGE-01` a bullet must bind a registry limit ref, never a hardcoded number (PRD §3.1 thresholds row). Each: rule file + golden tests + rationale roster entry + count bumps. | M |
| **E9.3 Patterns** | `variance-walk` (waterfall + driver small-multiples + annotation), `scenario-comparison` (small-multiples across a scenario context param + delta table), `exec-summary` (≤6 KPI tiles + 2 trends; density enforced by the critic brief-check plus a pattern-aware LAY finding). | M |

**Acceptance:** every new widget renders every state in the harness e2e; a
hand-authored variance-walk dashboard lints clean and exports to the deck;
patterns/rationale roster tests still cover exactly the linter's emittable
set.

---

## Phase 10 — widget & pattern proposal machinery (the escape hatch, for real) — SHIPPED

The PRD's credibility argument: custom widgets/patterns enter through
review, "same machinery as metrics." Metrics got the machinery in Phase 3;
this phase generalizes it.

| Epic | Scope | Size |
|---|---|---|
| **E10.1 Catalogs become data** | Widget contracts and patterns move from code constants to DB tables, seeded from the current code on migrate (append-only versions, same idiom as everything else). The server serves them (it already does — the source changes, the routes don't). | M |
| **E10.2 Generalized proposals** | `chartroom_proposal` grows `artifact_type: metric|widget|pattern`. A widget proposal carries the contract JSON + design rationale; a pattern proposal carries slots/wireframe/when-not. Validation is schema + reference checks (a widget's `guide_rules` must name real rules). The **design steward** decides; approval writes a new catalog version. | L |
| **E10.3 Surfaces** | MCP + agent tools `propose_widget` / `propose_pattern`; the studio `#/proposals` queue gains a type filter; renderer-less widget proposals are approvable as *catalog* entries but flagged unrenderable until an implementation lands (contract-first, honestly labeled). | M |

**ADR candidates:** ADR-42 catalogs as versioned data; ADR-43 contract-first
widget proposals.

---

## Phase 11 — outward integrations & lifecycle

| Epic | Scope | Size |
|---|---|---|
| **E11.1 DataHub emitter** | An adapter replays `chartroom_exposure` rows + lineage (dashboard → metric → source table) to DataHub's REST sink when `DATAHUB_GMS_URL` is set; otherwise writes the same payloads to an export directory (inspectable, replayable). FIBO glossary terms via a mapping table on the metric documents. Fulfills ADR-25's "replay outward" promise without touching the promotion path. | M |
| **E11.2 Git materialization at Team+** | On promotion, the server writes the canonical spec + brief + lint report into a configured git repo path and commits as the approver (PRD §13 Q1's own recommendation: DB-native drafts, git-materialized at Team+). | M |
| **E11.3 Decommissioning** | Fix the half-wired telemetry first (the ViewPage sends `view.open`; it never did). Then a staleness sweep: certified dashboards with no views in N days get flagged in the Govern tab with an owner notice — review or retire. | S |
| **E11.4 Proposal reconciliation tests** | `ProposalEvidence` grows author-declared checks — `[{name, measure, expect, tolerance}]` reconciliation targets and sanity bounds — run by the validator alongside the engine evidence; the steward sees pass/fail per check (PRD §9.1's "tests", literally). | S |
| **E11.5 Rogo import** | `POST /agent/import`: paste a Rogo exploration (HTML/notes); a deepagents subagent maps it to a prefilled intake + gap list, opening the normal governed flow — "turn this exploration into a governed dashboard" (PRD §13 Q3). | M |
| **E11.6 Slack entry (optional)** | A thin Bolt app fronting the agent service — the same frozen event protocol, rendered as Slack blocks. Explicitly optional; ship only with a pilot asking for it. | M |

---

## Sequencing & dependencies

```
Phase 7 (agent service) ──────────────┐
Phase 8 (real backends) ── E8.2 lives │ in the Phase-7 service → 7 before 8
Phase 9 (catalog depth) ── independent; can run parallel to 8
Phase 10 (proposal machinery) ── after 9 (proposes into the data-backed catalogs)
Phase 11 (integrations) ── last; E11.5 needs Phase 7, E11.1–2 need nothing new
```

Recommended order: **7 → 8 ∥ 9 → 10 → 11.** Phase 7 first because Phase 8's
executor and Phase 11's importer live in the service it creates.

## Testing strategy (constant across phases)

Unit per workspace (vitest / pytest); the fixture path is the oracle for
every warehouse assertion; entitlement tests re-run against every new
surface (the Python agent must fail the same 403s the MCP session does);
studio e2e stays hermetic (keys blanked, degrade paths exercised); key- and
credential-gated live tests (`ANTHROPIC_API_KEY`, `DREMIO_PAT`) skip loudly.

## Risk register

| Risk | Mitigation |
|---|---|
| `deepagents` / `langgraph` / MCP-adapter API drift | E7.1 step-zero spike + exact version pins; the frozen SSE protocol isolates the studio from churn |
| Flight SQL / Dremio auth friction | PAT (pinned decision); env-gated smoke test; DuckDB path is the default until Dremio proves out |
| Fixture↔warehouse drift | Parity harness in CI (E8.3); MASS-01 runs against both |
| MCP subprocess lifecycle in the agent service | One supervised subprocess, health-checked, restarted; tool calls time-boxed |
| Catalog code→data migration breaking pinned specs | Seed migration preserves current versions byte-for-byte; boundaries/roster tests unchanged |
| Two runtimes to operate | One Python service, one TS server; compose file + `/healthz`; the studio degrades honestly if either is down |
