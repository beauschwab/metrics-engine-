/**
 * Chartroom over MCP.
 *
 * Thin by contract (implementation spec §6): every tool validates its input,
 * calls the Chartroom server over HTTP as `agent:mcp-<session>`, and shapes
 * the response. No business logic lives here — the grilling protocol is a
 * schema on the server, the composition gate is in the server's repository,
 * and the approval entitlement is checked against the identity header this
 * process cannot forge into a human one.
 *
 * There is deliberately **no approve tool**. An agent can draft a brief,
 * preview data, lint, critique, and — once a human approves — compose. The
 * approval itself happens in the studio, by a person. Telling the model that
 * plainly, in the tool descriptions and the instructions, is part of the
 * design: an agent that knows the gate exists asks the human to open it
 * instead of throwing itself at a 403.
 *
 *   CHARTROOM_API       the server (default http://127.0.0.1:8788)
 *   CHARTROOM_MCP_USER  the human principal this session acts for
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { PRINCIPAL, SESSION_ID, ServerError, call } from './client.js';

const NAME = 'chartroom';
const VERSION = '0.1.0';

export const INSTRUCTIONS = `
Chartroom builds governed analytics dashboards. Every number comes from a
registry function; every visual clears an executable design guide; nothing
renders that a reviewer cannot diff. Your session is ${SESSION_ID}${PRINCIPAL ? `, acting for ${PRINCIPAL}` : ''}.

The flow is fixed, and the server enforces it — skipping ahead returns 403s:

1. INTAKE — the grilling protocol. Before drafting anything, resolve all
   eight slots with the user: the DECISION the dashboard supports (never "what
   data do you want to see"), audience, cadence, grain/entities, comparisons,
   thresholds, sharing scope, and what existing dashboards already cover.
   Push back: if they ask for twelve metrics, ask which three drive the
   decision. Search the registry (search_metrics) and the catalog
   (list_patterns) while you interview.
2. PATTERN MATCH — compare the request to the pattern catalog. Your brief
   either instantiates a pattern ("a limit-utilization-board with these
   deviations: …") or states in writing why none fits. New-pattern proposals
   go to catalog review, never into a dashboard directly.
3. BRIEF — create_brief. The server validates every slot; a missing one is
   named in the rejection. Nothing renders until a human approves the brief
   in the studio — ask them to, and wait.
4. COMPOSE — after approval, save_dashboard. The server lints with fresh
   contracts on every save; run lint_spec yourself first and apply the fixes
   it returns. Cite rules when you change a design ("routed to a sorted bar
   per PIE-01 — get_design_rules has the rationale"). Run critique_spec
   before calling a composition done.
5. ITERATE — preview_query for real numbers, diff_dashboard for what changed
   between versions. Every accepted change is a new version with a diff.

You cannot approve anything — briefs, promotions, none of it. Approval is the
human half of the maker-checker seam; your half is making the artifact worth
approving.
`.trim();

type Content = { content: Array<{ type: 'text'; text: string }>; isError?: boolean };

const ok = (value: unknown): Content => ({
  content: [{ type: 'text', text: JSON.stringify(value, null, 2) }],
});

/**
 * A refusal is a result. 4xx from the server — a missing slot, an unapproved
 * brief, a schema problem — comes back with its message and problems intact,
 * because those are precisely what the agent needs to act on. Anything else
 * is reported as the bug it is.
 */
async function attempt(fn: () => Promise<unknown>): Promise<Content> {
  try {
    return ok(await fn());
  } catch (err) {
    if (err instanceof ServerError) {
      const detail = err.problems.length ? `\n${err.problems.map((p) => `  · ${p}`).join('\n')}` : '';
      return { content: [{ type: 'text', text: `${err.message}${detail}` }], isError: true };
    }
    const message = err instanceof Error ? err.message : String(err);
    return { content: [{ type: 'text', text: `internal error: ${message}` }], isError: true };
  }
}

export function build(): McpServer {
  const server = new McpServer({ name: NAME, version: VERSION }, { instructions: INSTRUCTIONS });

  // ---- registry ----------------------------------------------------------

  server.registerTool('search_metrics', {
    description: 'Search the metric registry. Returns contracts — grain, dims, unit, '
      + 'precision, governance status, owner. Bind only what this returns: a metric '
      + 'not in the registry cannot appear on a dashboard, and a gap here becomes a '
      + 'brief gap entry, never inlined math.',
    inputSchema: {
      query: z.string().describe('substring matched against name, document and description'),
      certified_only: z.boolean().optional().describe('only metrics production currently serves'),
    },
  }, async ({ query, certified_only }) => attempt(async () => {
    const r = await call<{ source: string; contracts: Array<Record<string, unknown>> }>(
      'GET', `/api/contracts${certified_only ? '?certified_only=true' : ''}`,
    );
    const q = query.toLowerCase();
    const hits = r.contracts.filter((c) =>
      `${c.doc} ${c.measure} ${c.description ?? ''}`.toLowerCase().includes(q));
    return { source: r.source, count: hits.length, contracts: hits };
  }));

  server.registerTool('get_metric_contract', {
    description: 'The full contract for one metric ref (keel://doc.measure@rev): '
      + 'dims with their values, denominator lineage, allowed aggregations.',
    inputSchema: { ref: z.string() },
  }, async ({ ref }) => attempt(() =>
    call('GET', `/api/contracts/${encodeURIComponent(ref)}`)));

  server.registerTool('preview_query', {
    description: 'Run a guarded aggregate query against a registry metric — scalar, '
      + 'grouped by dims, or a series when dims includes as_of_date. Aggregates only; '
      + 'the row-level boundary is structural. Use this to check a binding returns '
      + 'real numbers before it goes in a spec.',
    inputSchema: {
      metric: z.string(),
      dims: z.array(z.string()).optional(),
      window: z.object({ trailing: z.string() }).optional(),
      max_cells: z.number().int().positive().optional(),
    },
  }, async (args) => attempt(() => call('POST', '/api/query', args)));

  // ---- catalogs ----------------------------------------------------------

  server.registerTool('list_patterns', {
    description: 'The reviewed dashboard archetypes, with slots, wireframes, and — '
      + 'as important — when NOT to use each. Your brief must instantiate one or '
      + 'justify in writing why none fits.',
    inputSchema: {},
  }, async () => attempt(() => call('GET', '/api/patterns')));

  server.registerTool('get_pattern', {
    description: 'One pattern by ref (e.g. liquidity-monitor@1), with its slot '
      + 'definitions — which widget families fill each slot, in what counts — and '
      + 'the wireframe. Fill the required slots; deviations go in the brief with '
      + 'their rationale.',
    inputSchema: { ref: z.string() },
  }, async ({ ref }) => attempt(() => call('GET', `/api/patterns/${encodeURIComponent(ref)}`)));

  server.registerTool('list_widgets', {
    description: 'The widget catalog — versioned contracts stating what each widget '
      + 'accepts. Custom widgets cannot be created inside a dashboard; they are '
      + 'catalog proposals with design review.',
    inputSchema: {},
  }, async () => attempt(() => call('GET', '/api/widgets')));

  server.registerTool('get_widget_contract', {
    description: 'One widget contract by type ref (e.g. timeseries@1): what metric '
      + 'shapes it accepts, how many categorical dims, what it supports (bands, '
      + 'compare, window, max_cells) and which guide rules it enforces natively.',
    inputSchema: { ref: z.string() },
  }, async ({ ref }) => attempt(async () => {
    const r = await call<{ widgets: Array<{ widget: string; version: number }> }>('GET', '/api/widgets');
    const hit = r.widgets.find((w) => `${w.widget}@${w.version}` === ref);
    if (!hit) throw new ServerError(404, `${ref} is not in the widget catalog`);
    return { widget: hit };
  }));

  server.registerTool('get_design_rules', {
    description: 'The design guide as machine-readable rules with rationale. Cite '
      + 'these when you route a request somewhere else than asked — users learn the '
      + 'guide through the citations.',
    inputSchema: {},
  }, async () => attempt(() => call('GET', '/api/design-rules')));

  // ---- checking ----------------------------------------------------------

  server.registerTool('lint_spec', {
    description: 'The deterministic linter, with fresh registry contracts. Findings '
      + 'carry JSON Patch fixes — apply them rather than hand-editing. BLOCKs must '
      + 'be resolved before a dashboard leaves draft; the server enforces that.',
    inputSchema: { spec: z.record(z.unknown()) },
  }, async ({ spec }) => attempt(() => call('POST', '/api/lint', { spec })));

  server.registerTool('critique_spec', {
    description: 'The LLM design critic: composition, hierarchy, decision-alignment '
      + 'against the approved brief. Judgment the linter cannot express. Run it '
      + 'before declaring a composition done; findings are advisory (the linter is '
      + 'the hard gate) and a model outage degrades to a WARN, never a block.',
    inputSchema: {
      spec: z.record(z.unknown()),
      dashboard_id: z.string().optional().describe('to critique against its latest brief'),
    },
  }, async (args) => attempt(() => call('POST', '/api/critique', args)));

  // ---- briefs & dashboards ----------------------------------------------

  server.registerTool('create_dashboard', {
    description: 'Register a dashboard shell (slug id + title). Do this before the '
      + 'brief; the brief references the dashboard.',
    inputSchema: { id: z.string(), title: z.string() },
  }, async (args) => attempt(() => call('POST', '/api/dashboards', args)));

  server.registerTool('list_dashboards', {
    description: 'Every dashboard, with status — check for existing overlap before '
      + 'proposing a new one. "Dashboard X already shows 6 of your 8 metrics" is an '
      + 'intake question, and this is where its answer comes from.',
    inputSchema: {},
  }, async () => attempt(() => call('GET', '/api/dashboards')));

  server.registerTool('get_dashboard', {
    description: 'A dashboard with its latest saved version: the spec as stored, '
      + 'the lint report review saw, the author, and the version number to pass '
      + 'back as expectedVersion when saving on top of it.',
    inputSchema: { dashboard_id: z.string() },
  }, async ({ dashboard_id }) => attempt(() =>
    call('GET', `/api/dashboards/${dashboard_id}`)));

  server.registerTool('create_brief', {
    description: 'File the design brief. The eight intake slots are REQUIRED — the '
      + 'server rejects an incomplete brief naming the missing slot; that is the '
      + 'grilling protocol, enforced rather than suggested. The brief then waits '
      + 'for a human to approve it in the studio. You cannot approve it.',
    inputSchema: { dashboard_id: z.string(), brief: z.record(z.unknown()) },
  }, async ({ dashboard_id, brief }) => attempt(() =>
    call('POST', `/api/dashboards/${dashboard_id}/brief`, { brief })));

  server.registerTool('update_brief', {
    description: 'Revise the brief. A new version supersedes every earlier one — '
      + 'including an approved one, which re-locks composition until a human '
      + 'approves again. An edited brief is a different brief.',
    inputSchema: { dashboard_id: z.string(), brief: z.record(z.unknown()) },
  }, async ({ dashboard_id, brief }) => attempt(() =>
    call('POST', `/api/dashboards/${dashboard_id}/brief`, { brief })));

  server.registerTool('get_brief', {
    description: 'The latest brief and its approval status. Status "approved" is '
      + 'what unlocks save_dashboard for this session; "draft" means ask the human '
      + 'to review it in the studio.',
    inputSchema: { dashboard_id: z.string() },
  }, async ({ dashboard_id }) => attempt(() =>
    call('GET', `/api/dashboards/${dashboard_id}/brief`)));

  server.registerTool('save_dashboard', {
    description: 'Compose: save a spec as a new version. For an agent session this '
      + 'requires the dashboard’s brief to be approved — plan before pixels is '
      + 'enforced server-side. The save is linted with fresh contracts and the '
      + 'report is stored with the version. Pass expectedVersion for optimistic '
      + 'concurrency.',
    inputSchema: {
      dashboard_id: z.string(),
      spec: z.record(z.unknown()),
      expectedVersion: z.number().int().nullable().optional(),
    },
  }, async ({ dashboard_id, spec, expectedVersion }) => attempt(() =>
    call('POST', `/api/dashboards/${dashboard_id}/versions`, {
      spec, expectedVersion: expectedVersion ?? null,
    })));

  server.registerTool('diff_dashboard', {
    description: 'What changed between two versions, in reviewer vocabulary: '
      + 'added, removed, moved, rebound, version-bumped, reformatted.',
    inputSchema: {
      dashboard_id: z.string(),
      a: z.number().int().positive(),
      b: z.number().int().positive(),
    },
  }, async ({ dashboard_id, a, b }) => attempt(() =>
    call('GET', `/api/dashboards/${dashboard_id}/diff?a=${a}&b=${b}`)));

  return server;
}

const isMain = process.argv[1]?.endsWith('server.ts') || process.argv[1]?.endsWith('server.js');
if (isMain) {
  build().connect(new StdioServerTransport()).catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
