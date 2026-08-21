/**
 * The design brief — the grilling protocol as a schema.
 *
 * The PRD's intake table (§3.1) says the brief *cannot be generated* until
 * eight slots are resolved. That sentence is enforceable, so it is enforced:
 * the slots are required fields with minimum lengths, and `create_brief`
 * rejects an intake that skips one. An agent cannot charm its way past a
 * schema, which is exactly why the protocol lives here and not in a prompt.
 *
 * The decision slot is the load-bearing one — "what decision does this
 * dashboard support", never "what data do you want to see" — and the minimum
 * length exists because "monitoring" is not a decision.
 */

import { z } from 'zod';
import { AUDIENCES, CADENCES, MetricRefSchema, WIDGET_TYPE_REF } from './schema';

const Slot = (min: number) => z.string().trim().min(min);

export const IntakeSchema = z.strictObject({
  /** What decision or action this dashboard supports. Not a data wishlist. */
  decision: Slot(20),
  audience: z.enum(AUDIENCES),
  cadence: z.enum(CADENCES),
  /** Legal entity, currency, desk, tenor — must match candidate grains. */
  grain_entities: Slot(10),
  /** Against what — limit, budget, prior period, scenario. */
  comparisons: Slot(10),
  /** Limits and triggers, or an explicit statement that there are none. */
  thresholds: Slot(10),
  sharing_scope: z.enum(['personal', 'team', 'certified-ambition']),
  /** What the catalog already shows, and why this is not that. */
  existing_overlap: Slot(10),
});
export type Intake = z.infer<typeof IntakeSchema>;

const BindingRow = z.strictObject({
  widget_slot: z.string().min(1),
  metric: MetricRefSchema,
  dims: z.array(z.string()).default([]),
  note: z.string().optional(),
});

const GapRow = z.strictObject({
  /** The calculation that does not exist in the registry. */
  needs: z.string().min(10),
  /** Why no existing function serves — cited, not asserted. */
  because: z.string().min(10),
});

export const BriefSchema = z.strictObject({
  dashboard_id: z.string().regex(/^[a-z][a-z0-9-]*$/),
  intake: IntakeSchema,
  /** A catalog pattern, or an explicit justification that none fits. */
  pattern: z.union([
    z.strictObject({
      ref: z.string().regex(WIDGET_TYPE_REF),
      deviations: z.array(z.string()).default([]),
    }),
    z.strictObject({ none: z.strictObject({ justification: z.string().min(20) }) }),
  ]),
  /** widget slot → registry function. The brief binds before anything renders. */
  bindings: z.array(BindingRow).min(1),
  /** Calculations the registry lacks; each becomes a proposal (Phase 3). */
  gaps: z.array(GapRow).default([]),
  /** ASCII layout sketch. */
  wireframe: z.string().min(10),
  /** What was asked for but excluded, and the guide citation for why. */
  excluded: z.array(z.strictObject({ what: z.string().min(3), why: z.string().min(10) })).default([]),
});
export type Brief = z.infer<typeof BriefSchema>;

export type BriefStatus = 'draft' | 'approved' | 'superseded';

/** Parse an intake or brief, with slot-by-slot problems for the agent to fix. */
export function parseBrief(input: unknown):
  | { ok: true; brief: Brief }
  | { ok: false; problems: string[] } {
  const r = BriefSchema.safeParse(input);
  if (r.success) return { ok: true, brief: r.data };
  return {
    ok: false,
    problems: r.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`),
  };
}
