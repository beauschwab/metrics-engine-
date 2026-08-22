# chartroom-agent

Chartroom's agent runtime (Phase 7, ADR-36): a LangGraph + deepagents loop on
FastAPI, whose tools are `chartroom-mcp` consumed over stdio — the same 28
governed tools every other agent surface sees, under an `agent:lg-<session>`
identity the server refuses at every approval route.

```sh
uv sync                    # or, from the repo root: npm run setup:agent

ANTHROPIC_API_KEY=… CHARTROOM_MCP_USER=you \
  uv run uvicorn chartroom_agent.app:app --port 8789
```

uv-managed (ADR-51). `uv.lock` beside `pyproject.toml` pins the whole resolved
graph, and the dev tooling is a PEP 735 dependency group, so `uv run pytest`
and `uv run ruff` work with no extra flag and no venv to remember to build —
`uv run` creates it from the lock on demand. The gate is
`npm run verify --workspace=chartroom-agent`.

chartroom-server proxies `/api/chat` here (set `CHARTROOM_AGENT_URL` to move
it); the studio pane is unchanged. Without a key — or with this service down —
the pane gets the honest `unavailable` banner and the rest of the studio keeps
working (ADR-35).

## Surfaces (ADR-56)

`AGENT_SURFACE` picks which surface one process serves — same endpoint, same
frozen protocol, same loop:

- `chartroom` (default): chartroom-mcp's governed tools, the design-agent
  journey, the warehouse query executor riding along.
- `registry`: registry-mcp over stdio under `KEEL_MCP_IDENTITY=agent:lg-registry`
  — an identity that server answers by never registering `save_artifact`,
  `promote` or `create_release` — the propose → prove → hand-over journey, no
  query executor. The registry server proxies its own `/api/chat` here
  (default :8790, `KEEL_AGENT_URL` to move it):

```sh
ANTHROPIC_API_KEY=… AGENT_SURFACE=registry \
  uv run uvicorn chartroom_agent.app:app --port 8790
```

Either way the roster is guarded at startup: a banned-name fragment appearing
in the loaded tools kills the process rather than waiting to matter.

The SSE event protocol is a **frozen contract** (ADR-37): `text · tool_start ·
tool_result · turn_end · done · error · unavailable`, framed exactly as
`data: <json>\n\n`. Additions are allowed (`thread` was the first — ADR-38's
server-side threads); changes are not.

## The warehouse query executor (Phase 8, ADRs 39–41)

The same service hosts `POST /query/run` — the warehouse backend behind
chartroom-server's `CHARTROOM_BACKEND=duckdb|dremio`. It fetches the
workspace manifest from `${CHARTROOM_API}/api/warehouse/manifest` (the
engine's own measure SQL + row-stage derivations + typed fixture tables),
loads DuckDB per workspace hash, and compiles aggregate-only SQL in the
published semantic views' CTE shape. Queries never touch the model or the
MCP session — the chat loop and the query path share a process, not a fate.

The fixture path is the oracle: `tests/test_warehouse_parity.py` runs every
query shape against both engines and requires 1e-6 relative agreement.
Dremio rides the same compiler over Flight SQL with a PAT (`DREMIO_URL` +
`DREMIO_PAT`; pyarrow comes from the root `uv sync`). Its smoke test is env-gated and
skips loudly in CI.

Verify: `npm run verify:agent` from the repo root (ruff + mypy + pytest; the
live-loop test is key-gated and skips loudly without `ANTHROPIC_API_KEY`).
Dependency versions are pinned exactly — the step-zero spike validated these
versions' APIs, so bumps re-run the spike (plan E7.1).
