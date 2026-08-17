# chartroom-agent

Chartroom's agent runtime (Phase 7, ADR-36): a LangGraph + deepagents loop on
FastAPI, whose tools are `chartroom-mcp` consumed over stdio — the same 25
governed tools every other agent surface sees, under an `agent:lg-<session>`
identity the server refuses at every approval route.

```sh
python3 -m venv .venv
.venv/bin/pip install -e '.[dev]'

ANTHROPIC_API_KEY=… CHARTROOM_MCP_USER=you \
  .venv/bin/uvicorn chartroom_agent.app:app --port 8789
```

chartroom-server proxies `/api/chat` here (set `CHARTROOM_AGENT_URL` to move
it); the studio pane is unchanged. Without a key — or with this service down —
the pane gets the honest `unavailable` banner and the rest of the studio keeps
working (ADR-35).

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
`DREMIO_PAT`, plus `pip install pyarrow`); its smoke test is env-gated and
skips loudly in CI.

Verify: `npm run verify:agent` from the repo root (ruff + mypy + pytest; the
live-loop test is key-gated and skips loudly without `ANTHROPIC_API_KEY`).
Dependency versions are pinned exactly — the step-zero spike validated these
versions' APIs, so bumps re-run the spike (plan E7.1).
