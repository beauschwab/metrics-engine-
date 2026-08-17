/**
 * The embedded agent chat — the studio's conversational surface (PRD §7,
 * deferred by ADR-17, delivered here as ADR-34).
 *
 * Architecture: a second *client* of the governed API, not a second API. The
 * chat loop's tools execute against the same pure `handle()` every other
 * caller uses, under an `agent:chat-<session>` identity — so every
 * entitlement holds structurally: this session cannot approve a brief,
 * decide a proposal, or promote a dashboard, because the server refuses
 * agent identities at those routes, whoever fronts them. There is no
 * approve tool to begin with (ADR-18's pattern, third surface).
 *
 * The loop is the classic manual agentic loop over the Anthropic SDK's
 * streaming API — chosen over the beta tool runner because every stream
 * event is forwarded to the browser as SSE while tools run between turns,
 * and the loop is the whole product here, not a chore to hide.
 *
 * No ANTHROPIC_API_KEY → the route answers with an `unavailable` event and
 * everything else in the studio keeps working (ADR-20's posture, ADR-35).
 */

import { randomUUID } from 'node:crypto';
import type Anthropic from '@anthropic-ai/sdk';
import { handle, type ApiDeps } from './api';

export const CHAT_MODEL = 'claude-opus-5';

const SESSION = `agent:chat-${randomUUID().slice(0, 8)}`;

export const SYSTEM_PROMPT = `
You are Chartroom's embedded design agent, running inside the studio. You
help people build governed analytics dashboards where every number traces to
a registry function and every visual clears the design guide.

Your session identity is ${SESSION} — an agent. You cannot approve briefs,
decide metric proposals, or promote dashboards; those are human acts the
human does in this same studio (the Brief and Govern tabs, and the
proposals queue). Your half of the maker-checker seam is making artifacts
worth approving.

The flow, which the server enforces with 403s if you skip ahead:
1. INTAKE — the grilling protocol. Resolve all eight slots in conversation:
   the DECISION the dashboard supports, audience, cadence, grain/entities,
   comparisons, thresholds, sharing scope, existing overlap. Push back on
   metric wishlists: ask which three drive the decision. Search the registry
   and patterns while you interview.
2. BRIEF — create_brief once the slots are resolved. Then ask the human to
   approve it in the Brief tab, and wait.
3. COMPOSE — after approval, save_dashboard. Lint first (lint_spec), apply
   the fixes, run data_critique to prove the numbers, cite design rules when
   you route a request somewhere better than asked.
4. GOVERN — a registry gap becomes propose_metric, never inlined math. Read
   get_promotion_checklist to tell the human what stands between the
   dashboard and its next status.

Keep responses concise and grounded in what the tools actually returned.
`.trim();

// ---------------------------------------------------------------------------
// Tools — thin declarations over the governed routes.
// ---------------------------------------------------------------------------

interface ChatTool {
  def: Anthropic.Tool;
  run(input: Record<string, unknown>, deps: ApiDeps): Promise<unknown>;
}

const obj = (properties: Record<string, unknown>, required: string[] = []): Anthropic.Tool.InputSchema => ({
  type: 'object', properties, required, additionalProperties: false,
} as Anthropic.Tool.InputSchema);

const call = (deps: ApiDeps) =>
  async (method: string, path: string, body?: unknown, query?: Record<string, string>) => {
    const r = await handle({ method, path, body, query, identity: SESSION }, deps);
    if (r.status >= 400) {
      const err = r.body as { error?: string; problems?: string[] };
      throw new Error([err.error, ...(err.problems ?? [])].filter(Boolean).join(' · ') || `status ${r.status}`);
    }
    return r.body;
  };

export const CHAT_TOOLS: ChatTool[] = [
  {
    def: {
      name: 'search_metrics',
      description: 'Search the metric registry. Returns contracts with grain, dims, unit, governance status. Bind only what this returns — a gap becomes a proposal, never inlined math.',
      input_schema: obj({ query: { type: 'string', description: 'substring over name/doc/description' } }, ['query']),
    },
    run: async (input, deps) => {
      const r = await call(deps)('GET', '/api/contracts') as { source: string; contracts: Array<Record<string, unknown>> };
      const q = String(input.query ?? '').toLowerCase();
      const hits = r.contracts.filter((c) => `${c.doc} ${c.measure} ${c.description ?? ''}`.toLowerCase().includes(q));
      return { source: r.source, count: hits.length, contracts: hits };
    },
  },
  {
    def: {
      name: 'get_metric_contract',
      description: 'The full contract for one metric ref (keel://doc.measure@rev): dims with values, denominator lineage, allowed aggregations.',
      input_schema: obj({ ref: { type: 'string' } }, ['ref']),
    },
    run: (input, deps) => call(deps)('GET', `/api/contracts/${encodeURIComponent(String(input.ref))}`),
  },
  {
    def: {
      name: 'preview_query',
      description: 'Run a guarded aggregate query against a registry metric — scalar, grouped by dims, or a series when dims includes as_of_date. Use it to check a binding returns real numbers before it goes in a spec.',
      input_schema: obj({
        metric: { type: 'string' },
        dims: { type: 'array', items: { type: 'string' } },
        window: { type: 'object', properties: { trailing: { type: 'string' } }, required: ['trailing'], additionalProperties: false },
        max_cells: { type: 'integer' },
      }, ['metric']),
    },
    run: (input, deps) => call(deps)('POST', '/api/query', input),
  },
  {
    def: {
      name: 'list_patterns',
      description: 'The reviewed dashboard archetypes with slots, wireframes, and when NOT to use each. A brief instantiates one or justifies why none fits.',
      input_schema: obj({}),
    },
    run: (_input, deps) => call(deps)('GET', '/api/patterns'),
  },
  {
    def: {
      name: 'get_design_rules',
      description: 'The design guide as rules with rationale — cite these when routing a request somewhere better than asked.',
      input_schema: obj({}),
    },
    run: (_input, deps) => call(deps)('GET', '/api/design-rules'),
  },
  {
    def: {
      name: 'lint_spec',
      description: 'The deterministic linter with fresh registry contracts. Findings carry JSON Patch fixes — apply them rather than hand-editing. BLOCKs must clear before a dashboard leaves draft.',
      input_schema: obj({ spec: { type: 'object', additionalProperties: true } }, ['spec']),
    },
    run: (input, deps) => call(deps)('POST', '/api/lint', { spec: input.spec }),
  },
  {
    def: {
      name: 'data_critique',
      description: 'The deterministic data critic: grouped sums reconcile with the headline, one as-of everywhere, everything finite — findings carry computed evidence. Run alongside lint before calling a composition done.',
      input_schema: obj({ spec: { type: 'object', additionalProperties: true } }, ['spec']),
    },
    run: (input, deps) => call(deps)('POST', '/api/data-critique', { spec: input.spec }),
  },
  {
    def: {
      name: 'list_dashboards',
      description: 'Every dashboard with status — check for existing overlap before proposing a new one.',
      input_schema: obj({}),
    },
    run: (_input, deps) => call(deps)('GET', '/api/dashboards'),
  },
  {
    def: {
      name: 'get_dashboard',
      description: 'A dashboard with its latest saved version: spec, lint report, and the version number to pass as expectedVersion when saving on top.',
      input_schema: obj({ dashboard_id: { type: 'string' } }, ['dashboard_id']),
    },
    run: (input, deps) => call(deps)('GET', `/api/dashboards/${String(input.dashboard_id)}`),
  },
  {
    def: {
      name: 'create_dashboard',
      description: 'Register a dashboard shell (slug id + title) before the brief.',
      input_schema: obj({ id: { type: 'string' }, title: { type: 'string' } }, ['id', 'title']),
    },
    run: (input, deps) => call(deps)('POST', '/api/dashboards', input),
  },
  {
    def: {
      name: 'create_brief',
      description: 'File the design brief. All eight intake slots are required — the server names any missing slot. The brief then waits for the human to approve it in the Brief tab; you cannot approve it.',
      input_schema: obj({
        dashboard_id: { type: 'string' },
        brief: { type: 'object', additionalProperties: true },
      }, ['dashboard_id', 'brief']),
    },
    run: (input, deps) => call(deps)('POST', `/api/dashboards/${String(input.dashboard_id)}/brief`, { brief: input.brief }),
  },
  {
    def: {
      name: 'get_brief',
      description: 'The latest brief and its approval status. "approved" unlocks save_dashboard for this session; "draft" means ask the human to review it.',
      input_schema: obj({ dashboard_id: { type: 'string' } }, ['dashboard_id']),
    },
    run: (input, deps) => call(deps)('GET', `/api/dashboards/${String(input.dashboard_id)}/brief`),
  },
  {
    def: {
      name: 'save_dashboard',
      description: 'Compose: save a spec as a new version. Requires the approved brief for an agent session — plan before pixels, enforced server-side. The save is linted with fresh contracts.',
      input_schema: obj({
        dashboard_id: { type: 'string' },
        spec: { type: 'object', additionalProperties: true },
        expectedVersion: { type: ['integer', 'null'] },
      }, ['dashboard_id', 'spec']),
    },
    run: (input, deps) => call(deps)('POST', `/api/dashboards/${String(input.dashboard_id)}/versions`, {
      spec: input.spec, expectedVersion: input.expectedVersion ?? null,
    }),
  },
  {
    def: {
      name: 'propose_metric',
      description: 'File a metric proposal: a full KEEL YAML document plus a rationale a steward can read. Validated through the real engine; a steward decides in the studio — you cannot.',
      input_schema: obj({
        id: { type: 'string' }, yaml: { type: 'string' }, rationale: { type: 'string' },
        dashboard_id: { type: 'string' },
      }, ['id', 'yaml', 'rationale']),
    },
    run: (input, deps) => call(deps)('POST', '/api/proposals', input),
  },
  {
    def: {
      name: 'get_promotion_checklist',
      description: 'Where a dashboard stands in the draft → team → certified matrix: requirements met/unmet, approvals, lint at the target status. Read-only — promotion is a human act.',
      input_schema: obj({ dashboard_id: { type: 'string' } }, ['dashboard_id']),
    },
    run: (input, deps) => call(deps)('GET', `/api/dashboards/${String(input.dashboard_id)}/promotion`),
  },
];

export const TOOLS_BY_NAME = new Map(CHAT_TOOLS.map((t) => [t.def.name, t]));

// ---------------------------------------------------------------------------
// The loop
// ---------------------------------------------------------------------------

export interface ChatEvent {
  type: 'text' | 'tool_start' | 'tool_result' | 'turn_end' | 'done' | 'error' | 'unavailable';
  [k: string]: unknown;
}

export interface ChatTurnRequest {
  /** Text-only history from the client; tool traffic is per-turn (ADR-34). */
  messages: Array<{ role: 'user' | 'assistant'; text: string }>;
  /** The dashboard open in the studio, as context. */
  dashboard_id?: string | null;
}

const MAX_TOOL_TURNS = 24;

/** Truncate tool results so one grid query cannot flood the context. */
const toolResultText = (value: unknown): string => {
  const text = JSON.stringify(value);
  return text.length > 20_000 ? `${text.slice(0, 20_000)} …[truncated]` : text;
};

/**
 * Run one full agentic turn, emitting events as they happen. Everything the
 * model streams and every tool boundary goes to `emit`; the transport (SSE
 * in production, an array in tests) is the caller's business.
 */
export async function runChatTurn(
  request: ChatTurnRequest,
  deps: ApiDeps,
  emit: (e: ChatEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  if (!process.env.ANTHROPIC_API_KEY) {
    emit({
      type: 'unavailable',
      message: 'No model is configured (ANTHROPIC_API_KEY is not set). The rest of the '
        + 'studio works without me — the linter and data critic are deterministic.',
    });
    return;
  }

  const { default: Anthropic } = await import('@anthropic-ai/sdk');
  const client = new Anthropic();

  const system = request.dashboard_id
    ? `${SYSTEM_PROMPT}\n\nThe studio currently has dashboard "${request.dashboard_id}" open.`
    : SYSTEM_PROMPT;

  const messages: Anthropic.MessageParam[] = request.messages.map((m) => ({
    role: m.role, content: m.text,
  }));

  try {
    for (let turn = 0; turn < MAX_TOOL_TURNS; turn += 1) {
      const stream = client.messages.stream({
        model: CHAT_MODEL,
        max_tokens: 16000,
        system,
        tools: CHAT_TOOLS.map((t) => t.def),
        messages,
      }, { signal });

      stream.on('text', (delta) => emit({ type: 'text', delta }));
      const response = await stream.finalMessage();

      if (response.stop_reason !== 'tool_use') {
        emit({ type: 'done', stop_reason: response.stop_reason });
        return;
      }

      messages.push({ role: 'assistant', content: response.content });
      const results: Anthropic.ToolResultBlockParam[] = [];
      for (const block of response.content) {
        if (block.type !== 'tool_use') continue;
        emit({ type: 'tool_start', name: block.name, input: block.input });
        const tool = TOOLS_BY_NAME.get(block.name);
        try {
          if (!tool) throw new Error(`no such tool: ${block.name}`);
          const value = await tool.run(block.input as Record<string, unknown>, deps);
          results.push({ type: 'tool_result', tool_use_id: block.id, content: toolResultText(value) });
          emit({ type: 'tool_result', name: block.name, ok: true, result: value });
        } catch (e) {
          const message = e instanceof Error ? e.message : String(e);
          // A refusal is a result — the 403s teach the agent the seam exists.
          results.push({ type: 'tool_result', tool_use_id: block.id, content: message, is_error: true });
          emit({ type: 'tool_result', name: block.name, ok: false, error: message });
        }
      }
      messages.push({ role: 'user', content: results });
      emit({ type: 'turn_end' });
    }
    emit({ type: 'error', message: `stopped after ${MAX_TOOL_TURNS} tool turns — ask me to continue` });
  } catch (e) {
    if (signal?.aborted) {
      emit({ type: 'done', stop_reason: 'aborted' });
      return;
    }
    emit({ type: 'error', message: e instanceof Error ? e.message : String(e) });
  }
}
