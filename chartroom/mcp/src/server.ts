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
   per PIE-01 — get_design_rules has the rationale"). Run critique_spec and
   data_critique before calling a composition done — the design critic judges
   the composition, the data critic proves the numbers.
5. ITERATE — preview_query for real numbers, diff_dashboard for what changed
   between versions. Every accepted change is a new version with a diff.
6. GOVERN — when the registry lacks a metric, propose_metric files a KEEL
   document with engine-run evidence; submit it when the blockers list is
   empty and ask a steward to decide in the studio. When the *catalog* lacks
   the visual or the archetype the brief needs, propose_widget and
   propose_pattern go through the same machinery — a custom visual enters by
   review, never as freeform code in a dashboard. get_promotion_checklist
   shows what stands between a dashboard and its next status — your job is to
   clear the checkable items (lint BLOCKs, stale weakening pins via
   check_upgrades) and tell the humans which sign-offs remain.

You cannot approve anything — briefs, proposals, promotions, none of it.
Approval is the human half of the maker-checker seam; your half is making the
artifact worth approving.
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

  server.registerTool('data_critique', {
    description: 'The data critic: deterministic checks only running the numbers can '
      + 'make — grouped sums reconcile with the headline for additive measures, every '
      + 'widget answers at one as-of date, nothing non-finite would render. Findings '
      + 'carry the computed evidence. No model behind it, so it never degrades; run it '
      + 'alongside lint_spec before calling a composition done.',
    inputSchema: { spec: z.record(z.unknown()) },
  }, async ({ spec }) => attempt(() => call('POST', '/api/data-critique', { spec })));

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
      + 'added, removed, moved, rebound, version-bumped, reformatted, '
      + 'retitled, annotated.',
    inputSchema: {
      dashboard_id: z.string(),
      a: z.number().int().positive(),
      b: z.number().int().positive(),
    },
  }, async ({ dashboard_id, a, b }) => attempt(() =>
    call('GET', `/api/dashboards/${dashboard_id}/diff?a=${a}&b=${b}`)));

  // ---- governance (phase 3) ----------------------------------------------

  server.registerTool('propose_metric', {
    description: 'File a metric proposal: a complete KEEL YAML document plus the '
      + 'rationale a steward will read. The server validates it through the real '
      + 'engine — parse, diagnostics, every measure evaluated, semantic view '
      + 'compiled — and returns the evidence with any blockers. A registry gap '
      + 'becomes one of these, never inlined math in a spec.',
    inputSchema: {
      id: z.string().describe('slug id for the proposal'),
      yaml: z.string().describe('the full KEEL document (metrics_view etc.)'),
      rationale: z.string().describe('why this metric should exist, for the steward (min 20 chars)'),
      dashboard_id: z.string().optional().describe('the dashboard whose gap this fills'),
    },
  }, async ({ id, yaml, rationale, dashboard_id }) => attempt(() =>
    call('POST', '/api/proposals', { id, yaml, rationale, dashboard_id })));

  // E10.3: the escape hatch, through the same machinery as metrics. A custom
  // visual is proposed, reviewed by the design steward, and published as a
  // catalog version — never smuggled in as freeform code in a dashboard.
  server.registerTool('propose_widget', {
    description: 'File a widget-contract proposal: the contract JSON (widget, version, '
      + 'family, accepts, guide_rules, description) plus the design rationale a steward '
      + 'will read. The server validates the schema and every reference — a cited '
      + 'guide_rule the linter cannot emit is a blocker — and reports whether an '
      + 'implementation exists. A contract with no renderer yet is still approvable, '
      + 'and is flagged unrenderable until one lands.',
    inputSchema: {
      id: z.string().describe('slug id for the proposal'),
      contract: z.string().describe('the widget contract, as JSON'),
      rationale: z.string().describe('why this widget should exist, for the design steward (min 20 chars)'),
      dashboard_id: z.string().optional().describe('the dashboard whose gap this fills'),
    },
  }, async ({ id, contract, rationale, dashboard_id }) => attempt(() =>
    call('POST', '/api/proposals', {
      id, contract, rationale, dashboard_id, artifact_type: 'widget',
    })));

  server.registerTool('propose_pattern', {
    description: 'File a pattern proposal: the pattern JSON (pattern, version, title, '
      + 'serves, when_not, audience_default, slots, wireframe) plus the rationale. Slot '
      + 'families must be real widget families and at least one slot must be required — '
      + 'a pattern that constrains nothing is not an archetype. Propose one when the '
      + 'brief says no existing pattern fits.',
    inputSchema: {
      id: z.string().describe('slug id for the proposal'),
      contract: z.string().describe('the pattern definition, as JSON'),
      rationale: z.string().describe('why this archetype should exist (min 20 chars)'),
      dashboard_id: z.string().optional().describe('the dashboard that surfaced the gap'),
    },
  }, async ({ id, contract, rationale, dashboard_id }) => attempt(() =>
    call('POST', '/api/proposals', {
      id, contract, rationale, dashboard_id, artifact_type: 'pattern',
    })));

  server.registerTool('list_catalog', {
    description: 'The widget or pattern catalog with versions and provenance — which '
      + 'entries were seeded from code, which came from an approved proposal, and which '
      + 'are contract-only (approved but not yet renderable).',
    inputSchema: { kind: z.enum(['widget', 'pattern']) },
  }, async ({ kind }) => attempt(() => call('GET', `/api/catalog/${kind}`)));

  server.registerTool('submit_proposal', {
    description: 'Move a draft proposal to the steward queue. The server re-validates '
      + 'against the current workspace first and refuses (422, blockers named) while '
      + 'anything blocks: fix the document and propose again rather than arguing. '
      + 'Deciding is human-only — after submitting, ask a steward to review in the studio.',
    inputSchema: { proposal_id: z.string() },
  }, async ({ proposal_id }) => attempt(() =>
    call('POST', `/api/proposals/${proposal_id}/submit`, {})));

  server.registerTool('get_proposal', {
    description: 'One proposal with its stored evidence — parse result, diagnostics, '
      + 'measure values on the fixture, semantic compile — plus current blockers and, '
      + 'once decided, the registry revision an approval wrote.',
    inputSchema: { proposal_id: z.string() },
  }, async ({ proposal_id }) => attempt(() =>
    call('GET', `/api/proposals/${proposal_id}`)));

  server.registerTool('list_proposals', {
    description: 'Every metric proposal, optionally filtered by status (draft, '
      + 'submitted, approved, rejected). Check here before proposing: a gap someone '
      + 'already proposed needs a comment on theirs, not a duplicate.',
    inputSchema: {
      status: z.enum(['draft', 'submitted', 'approved', 'rejected']).optional(),
    },
  }, async ({ status }) => attempt(() =>
    call('GET', `/api/proposals${status ? `?status=${status}` : ''}`)));

  server.registerTool('get_promotion_checklist', {
    description: 'Where a dashboard stands in the draft → team → certified matrix: '
      + 'the next status, each requirement with met/unmet and why, approval state per '
      + 'track, and the lint report at the target status (GOV rules arm as the bar '
      + 'rises). Read-only — promotion itself is a human act in the studio; your job '
      + 'is clearing the checkable items and naming the sign-offs that remain.',
    inputSchema: { dashboard_id: z.string() },
  }, async ({ dashboard_id }) => attempt(() =>
    call('GET', `/api/dashboards/${dashboard_id}/promotion`)));

  server.registerTool('check_upgrades', {
    description: 'Stale version pins on a dashboard, each with the engine’s impact '
      + 'assessment between the pinned and latest revisions — which measures move and '
      + 'by how much, what disappears, whether a control weakens. Notify-with-a-diff: '
      + 'surface these to the owner; never silently re-pin a promoted dashboard.',
    inputSchema: { dashboard_id: z.string() },
  }, async ({ dashboard_id }) => attempt(() =>
    call('GET', `/api/dashboards/${dashboard_id}/upgrades`)));

  return server;
}

const isMain = process.argv[1]?.endsWith('server.ts') || process.argv[1]?.endsWith('server.js');
if (isMain) {
  build().connect(new StdioServerTransport()).catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
