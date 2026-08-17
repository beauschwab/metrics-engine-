/**
 * The MCP surface over the wire — a real chartroom server on an ephemeral
 * port, a real MCP client over stdio, and the two Phase-2 acceptance
 * assertions at the end: composition is rejected before a human approves, and
 * this session holds no approver rights at all (there is no tool to even try
 * with, and the identity the server sees is an agent's).
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const dir = mkdtempSync(join(tmpdir(), 'chartroom-mcp-'));
// Per-run port: a server leaked by an interrupted earlier run must not serve
// this run its stale database.
const PORT = 8700 + (process.pid % 90);
const API = `http://127.0.0.1:${PORT}`;

let serverProc: import('node:child_process').ChildProcess;
let client: Client;

beforeAll(async () => {
  const { spawn } = await import('node:child_process');
  serverProc = spawn('npx', ['tsx', '../server/src/index.ts'], {
    cwd: new URL('..', import.meta.url).pathname,
    env: {
      ...process.env,
      CHARTROOM_PORT: String(PORT),
      CHARTROOM_SQLITE_FILE: join(dir, 'chartroom.db'),
      KEEL_API: 'http://127.0.0.1:9', // no registry: shipped-docs fallback, hermetic
    },
    stdio: 'ignore',
  });
  for (let i = 0; i < 120; i++) {
    try {
      const r = await fetch(`${API}/api/health`);
      if (r.ok) break;
    } catch { /* not up yet */ }
    await new Promise((res) => setTimeout(res, 500));
  }

  const transport = new StdioClientTransport({
    command: 'npx',
    args: ['tsx', 'src/server.ts'],
    cwd: new URL('..', import.meta.url).pathname,
    env: {
      ...(process.env as Record<string, string>),
      CHARTROOM_API: API,
      CHARTROOM_MCP_USER: 'beau',
    },
  });
  client = new Client({ name: 'test', version: '0' });
  await client.connect(transport);
}, 120_000);

afterAll(async () => {
  await client?.close();
  serverProc?.kill();
  rmSync(dir, { recursive: true, force: true });
});

function payload(result: unknown): { text: string; isError: boolean } {
  const r = result as { content: Array<{ text: string }>; isError?: boolean };
  return { text: r.content.map((c) => c.text).join('\n'), isError: !!r.isError };
}
const json = (result: unknown) => JSON.parse(payload(result).text);

const REV = 1; // shipped-docs fallback serves everything at revision 1
const ref = (m: string) => `keel://liquidity_pit.${m}@${REV}`;

const GOOD_BRIEF = {
  dashboard_id: 'agent-board',
  intake: {
    decision: 'Decide whether to escalate to ALCO before an LCR floor breach',
    audience: 'treasury-committee',
    cadence: 'eod',
    grain_entities: 'legal entity, consolidated group',
    comparisons: 'against the regulatory floor and prior day',
    thresholds: 'the 100% LCR minimum; the governed stress haircut',
    sharing_scope: 'team',
    existing_overlap: 'lcr-monitor shows the ratio but not committee framing',
  },
  pattern: { ref: 'limit-utilization-board@1', deviations: [] },
  bindings: [{ widget_slot: 'utilization-tiles', metric: ref('lcr_pct'), dims: [] }],
  gaps: [],
  wireframe: '[KPI][KPI]\n[ trend  ]',
  excluded: [],
};

const SPEC = {
  chartroom: '0.1',
  dashboard: {
    id: 'agent-board', title: 'Agent board', pattern: 'limit-utilization-board@1',
    audience: 'treasury-committee', cadence: 'eod', status: 'draft',
  },
  context: {},
  layout: { grid: { cols: 12, row_height: 96 } },
  widgets: [{
    id: 'tile', type: 'kpi-tile@1', pos: { x: 0, y: 0, w: 3, h: 2 },
    bind: { metric: ref('lcr_pct'), compare: { vs: 'prior_period', style: 'delta' } },
  }],
  interactions: [],
};

describe('the connection', () => {
  it('advertises the toolset, and no approve tool exists at all', async () => {
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual([
      'check_upgrades', 'create_brief', 'create_dashboard', 'critique_spec',
      'data_critique', 'diff_dashboard', 'get_brief', 'get_dashboard',
      'get_design_rules', 'get_metric_contract', 'get_pattern',
      'get_promotion_checklist', 'get_proposal', 'get_widget_contract',
      'lint_spec', 'list_dashboards', 'list_patterns', 'list_proposals',
      'list_widgets', 'preview_query', 'propose_metric', 'save_dashboard',
      'search_metrics', 'submit_proposal', 'update_brief',
    ]);
    // The maker-checker seam, stated as an absence: no tool decides, approves,
    // or promotes. (get_promotion_checklist is read-only — "promotion", not
    // an act of promoting.)
    expect(names.filter((n) => n.includes('approve') || n.includes('promote')
      || n.includes('decide'))).toEqual([]);
  });

  it('carries the intake protocol in its instructions', () => {
    const instructions = client.getInstructions();
    expect(instructions).toContain('grilling');
    expect(instructions).toContain('You cannot approve anything');
  });

  it('describes each tool beyond a stub', async () => {
    const { tools } = await client.listTools();
    for (const t of tools) expect(t.description!.length, t.name).toBeGreaterThan(80);
  });
});

describe('reading over the wire', () => {
  it('searches metrics and reads a contract', async () => {
    const found = json(await client.callTool({
      name: 'search_metrics', arguments: { query: 'lcr_pct' },
    }));
    expect(found.count).toBeGreaterThan(0);

    const contract = json(await client.callTool({
      name: 'get_metric_contract', arguments: { ref: ref('lcr_pct') },
    }));
    expect(contract.contract.denominator_of).toBe('net_cash_outflows_30d');
  });

  it('serves patterns with their when-not-to-use, and the rule rationale', async () => {
    const patterns = json(await client.callTool({ name: 'list_patterns', arguments: {} }));
    expect(patterns.patterns.map((p: { pattern: string }) => p.pattern))
      .toContain('limit-utilization-board');
    expect(patterns.patterns[0].when_not.length).toBeGreaterThan(20);

    const rules = json(await client.callTool({ name: 'get_design_rules', arguments: {} }));
    expect(rules.rules).toHaveLength(16);
  });

  it('previews real numbers through the aggregates-only boundary', async () => {
    const r = json(await client.callTool({
      name: 'preview_query',
      arguments: { metric: ref('lcr_pct') },
    }));
    expect(r.kind).toBe('scalar');
    expect(Number.isFinite(r.value)).toBe(true);
  });

  it('lints a spec and returns applicable fixes', async () => {
    const bad = structuredClone(SPEC);
    (bad.widgets[0] as { format?: unknown }).format = { decimals: 5 };
    const r = json(await client.callTool({ name: 'lint_spec', arguments: { spec: bad } }));
    expect(r.report.findings.some((f: { rule: string }) => f.rule === 'NUM-01')).toBe(true);
  });

  it('the data critic proves the numbers, deterministically', async () => {
    const r = json(await client.callTool({ name: 'data_critique', arguments: { spec: SPEC } }));
    expect(r.findings).toEqual([]);
    expect(r.widgetsChecked).toBe(1);
    expect(Object.keys(r.asOf)).toEqual(['tile']);
  });

  it('the critic degrades to WARN without a model — never a dead tool', async () => {
    const r = json(await client.callTool({ name: 'critique_spec', arguments: { spec: SPEC } }));
    expect(Array.isArray(r.findings)).toBe(true);
    // No key in this environment: the unavailability is said, not hidden.
    if (r.findings.length && r.findings[0].claim.includes('critic unavailable')) {
      expect(r.findings[0].severity).toBe('WARN');
    }
  });
});

describe('the Phase-2 gates, exercised end to end', () => {
  it('an incomplete brief is rejected with the slot named — the grilling protocol', async () => {
    await client.callTool({
      name: 'create_dashboard', arguments: { id: 'agent-board', title: 'Agent board' },
    });
    const incomplete = structuredClone(GOOD_BRIEF) as Record<string, unknown>;
    delete (incomplete.intake as Record<string, unknown>).thresholds;
    const r = payload(await client.callTool({
      name: 'create_brief', arguments: { dashboard_id: 'agent-board', brief: incomplete },
    }));
    expect(r.isError).toBe(true);
    expect(r.text).toContain('intake.thresholds');
  });

  it('composition before approval is rejected, and the refusal explains the flow', async () => {
    await client.callTool({
      name: 'create_brief', arguments: { dashboard_id: 'agent-board', brief: GOOD_BRIEF },
    });
    const r = payload(await client.callTool({
      name: 'save_dashboard', arguments: { dashboard_id: 'agent-board', spec: SPEC },
    }));
    expect(r.isError).toBe(true);
    expect(r.text).toContain('human approval');
  });

  it('a human approval (out of band, as in the studio) unlocks composition', async () => {
    const approve = await fetch(`${API}/api/dashboards/agent-board/brief/approve`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-identity': 'beau' },
    });
    expect(approve.status).toBe(200);

    const r = json(await client.callTool({
      name: 'save_dashboard', arguments: { dashboard_id: 'agent-board', spec: SPEC },
    }));
    expect(r.version).toBe(1);
    expect(r.lintReport.counts.block).toBe(0);
  });

  it('the audit trail pairs the agent session with its principal', async () => {
    const audit = await fetch(`${API}/api/dashboards/agent-board/audit`).then((r) => r.json()) as {
      audit: Array<{ actor: string; action: string }>;
    };
    const agentActs = audit.audit.filter((a) => a.actor.startsWith('agent:mcp-'));
    expect(agentActs.map((a) => a.action)).toContain('dashboard.save');
    // And the human approval is attributed to the human, not the agent.
    expect(audit.audit.find((a) => a.action === 'brief.approve')!.actor).toBe('beau');
  });
});

describe('the Phase-3 governance loop, agent half only', () => {
  const YAML = `name: mcp_proposed_view
kind: metrics_view
display_name: MCP-proposed view
owner: Liquidity Regulatory Reporting
source: alm.fct_liquidity_position

measures:
  - name: unencumbered_hqla
    description: Eligible HQLA excluding encumbered positions.
    type: simple
    agg: sum
    field: hqla_eligible_amount
    where: is_encumbered = false
    format: currency_usd
`;

  it('proposes a metric and reads back the engine-run evidence', async () => {
    const r = json(await client.callTool({
      name: 'propose_metric',
      arguments: {
        id: 'mcp-proposal', yaml: YAML,
        rationale: 'Intake surfaced an unencumbered-HQLA gap no registry function covers.',
        dashboard_id: 'agent-board',
      },
    }));
    expect(r.proposal.status).toBe('draft');
    expect(r.blockers).toEqual([]);
    expect(r.proposal.evidence.measures[0].finite).toBe(true);

    const submitted = json(await client.callTool({
      name: 'submit_proposal', arguments: { proposal_id: 'mcp-proposal' },
    }));
    expect(submitted.proposal.status).toBe('submitted');

    const listed = json(await client.callTool({
      name: 'list_proposals', arguments: { status: 'submitted' },
    }));
    expect(listed.proposals.map((p: { id: string }) => p.id)).toContain('mcp-proposal');
  });

  it('reads the promotion checklist but holds no tool to act on it', async () => {
    const r = json(await client.callTool({
      name: 'get_promotion_checklist', arguments: { dashboard_id: 'agent-board' },
    }));
    expect(r.status).toBe('draft');
    expect(r.next).toBe('team');
    expect(Array.isArray(r.requirements)).toBe(true);
    // The enforcement is server-side too, not just tool absence: the agent
    // identity is refused even if it speaks HTTP directly.
    const direct = await fetch(`${API}/api/dashboards/agent-board/promote`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-identity': 'agent:mcp-direct' },
      body: JSON.stringify({ to: 'team' }),
    });
    expect(direct.status).toBe(403);
  });

  it('reports upgrade notices (none, when every pin is current)', async () => {
    const r = json(await client.callTool({
      name: 'check_upgrades', arguments: { dashboard_id: 'agent-board' },
    }));
    expect(r.upgrades).toEqual([]);
  });
});
