/**
 * chartroom-critics — LLM judgment over what the linter cannot check.
 *
 * Three commitments from the implementation spec, kept literally:
 *
 * - **The deterministic linter is the hard gate; the critic never blocks the
 *   pipeline.** Any failure — no API key, a network error, twice-unparseable
 *   output — degrades to a WARN-severity "critic unavailable" finding. A
 *   dashboard is never stuck because a model was.
 * - **Findings are Zod-validated, one retry on mismatch.** The API is asked
 *   for structured JSON (`output_config.format`), and the response is still
 *   validated here — the schema at the API layer and the parser here must
 *   agree, and this is where a disagreement surfaces.
 * - **The critic reasons over a render digest, not data.** Layout, widget
 *   types, titles, bindings — no evaluated values. Composition judgment does
 *   not need the numbers, and the numbers are the thing governance says never
 *   leaves the query path.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import type { Brief, DashboardSpec } from 'chartroom-spec';

export const CriticFindingSchema = z.strictObject({
  critic: z.enum(['design', 'data']),
  severity: z.enum(['BLOCK', 'WARN', 'SUGGEST']),
  widget_id: z.string().nullable().optional(),
  claim: z.string().min(10),
  guide_ref: z.string().nullable().optional(),
  suggestion: z.string().nullable().optional(),
});
export type CriticFinding = z.infer<typeof CriticFindingSchema>;

const ResponseSchema = z.strictObject({
  findings: z.array(CriticFindingSchema.omit({ critic: true })),
});

/** The JSON Schema handed to the API — kept in lockstep with ResponseSchema. */
const RESPONSE_JSON_SCHEMA = {
  type: 'object',
  properties: {
    findings: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          severity: { type: 'string', enum: ['BLOCK', 'WARN', 'SUGGEST'] },
          widget_id: { type: ['string', 'null'] },
          claim: { type: 'string' },
          guide_ref: { type: ['string', 'null'] },
          suggestion: { type: ['string', 'null'] },
        },
        required: ['severity', 'claim'],
        additionalProperties: false,
      },
    },
  },
  required: ['findings'],
  additionalProperties: false,
} as const;

/**
 * The composition, compacted for judgment: layout + types + titles + bindings,
 * no evaluated values (see header). Sorted reading order, so "the hero widget"
 * means the same thing to the critic as to a human scanning the canvas.
 */
export function renderDigest(spec: DashboardSpec): string {
  const widgets = [...spec.widgets]
    .sort((a, b) => a.pos.y - b.pos.y || a.pos.x - b.pos.x)
    .map((w) => ({
      id: w.id,
      type: w.type,
      title: w.title ?? null,
      pos: w.pos,
      area: w.pos.w * w.pos.h,
      metric: w.bind.metric,
      dims: w.bind.dims ?? [],
      compare: w.bind.compare ?? null,
      bands: w.bind.bands ?? [],
      emphasis: w.format?.emphasis ?? 'neutral',
    }));
  return JSON.stringify({
    dashboard: spec.dashboard,
    grid: spec.layout.grid,
    widgets,
  }, null, 2);
}

export interface CriticDeps {
  /** Test seam: replaces the API call. Given (system, user), returns raw text. */
  call?: (system: string, user: string) => Promise<string>;
  model?: string;
}

const PROMPT_PATH = join(dirname(fileURLToPath(import.meta.url)), 'prompts', 'design-critic.md');

export const unavailable = (why: string): CriticFinding[] => [{
  critic: 'design',
  severity: 'WARN',
  claim: `design critic unavailable: ${why}. The deterministic linter still ran — `
    + 'this dashboard has not been reviewed for composition, only for rules.',
}];

async function apiCall(system: string, user: string, model: string): Promise<string> {
  const client = new Anthropic();
  const response = await client.messages.create({
    model,
    max_tokens: 4096,
    system,
    output_config: {
      format: { type: 'json_schema', schema: RESPONSE_JSON_SCHEMA },
    },
    messages: [{ role: 'user', content: user }],
  } as Parameters<typeof client.messages.create>[0]);

  const msg = response as { stop_reason?: string; content: Array<{ type: string; text?: string }> };
  if (msg.stop_reason === 'refusal') throw new Error('the model declined the request');
  const text = msg.content.find((b) => b.type === 'text')?.text;
  if (!text) throw new Error('no text in the response');
  return text;
}

/**
 * Run the design critic. One retry on unparseable output, then degrade —
 * never a throw, never a block (see header).
 */
export async function runDesignCritic(
  spec: DashboardSpec,
  brief: Brief | null,
  deps: CriticDeps = {},
): Promise<CriticFinding[]> {
  const call = deps.call
    ?? (process.env.ANTHROPIC_API_KEY
      ? (s: string, u: string) => apiCall(s, u, deps.model ?? process.env.CHARTROOM_CRITIC_MODEL ?? 'claude-opus-5')
      : null);
  if (!call) return unavailable('no ANTHROPIC_API_KEY configured');

  const system = readFileSync(PROMPT_PATH, 'utf8');
  const user = [
    '## The approved design brief',
    brief ? JSON.stringify(brief, null, 2) : '(no brief exists for this dashboard)',
    '',
    '## The composed dashboard (render digest — layout and bindings, no data)',
    renderDigest(spec),
    '',
    'Return your findings as JSON: {"findings": [{"severity", "claim", "widget_id"?, "guide_ref"?, "suggestion"?}]}',
  ].join('\n');

  for (let attempt = 0; attempt < 2; attempt++) {
    let text: string;
    try {
      text = await call(system, user);
    } catch (e) {
      return unavailable(e instanceof Error ? e.message : 'model call failed');
    }
    try {
      const parsed = ResponseSchema.parse(JSON.parse(text));
      return parsed.findings.map((f) => ({ ...f, critic: 'design' as const }));
    } catch {
      // Once is a hiccup worth one retry; twice is unavailability.
    }
  }
  return unavailable('the model returned findings that do not match the schema, twice');
}
