/**
 * Widget and pattern proposals — the escape hatch, run through the same
 * machinery as metrics (E10.2, ADR-47).
 *
 * The PRD's credibility argument is that a custom visual enters through
 * review rather than through a dashboard. Phase 3 built that for metrics: a
 * proposal carries evidence a steward reads, and approval's real act is a
 * write to the thing the rest of the system trusts. This module says what
 * "evidence" and "the write" mean when the artifact is a catalog entry rather
 * than a registry document.
 *
 * A metric proposal is validated by *running* it — parse, diagnose, evaluate.
 * A catalog entry has nothing to run, so its evidence is structural: does it
 * satisfy the contract schema, and does every reference it makes point at
 * something real? A widget citing `guide_rules: [FOO-99]` claims the linter
 * enforces a rule that does not exist, and a reviewer reading the contract
 * has no way to notice. That check is the whole point.
 */

import { z } from 'zod';
import { RULE_IDS } from 'chartroom-spec';
import { PatternSchema } from 'chartroom-patterns';
import type { ProposalArtifact } from './repository';

/** The families a rule may key off — kept in step with WidgetContract. */
const FAMILIES = [
  'kpi', 'timeseries', 'bar', 'table', 'grid', 'part_to_whole',
  'waterfall', 'heatmap', 'annotation',
] as const;

const SUPPORTS = ['bands', 'compare', 'window', 'sort', 'max_cells', 'filters'] as const;

export const WidgetContractSchema = z.strictObject({
  widget: z.string().regex(/^[a-z][a-z0-9-]*$/, 'a widget name is a slug'),
  version: z.number().int().positive(),
  family: z.enum(FAMILIES),
  accepts: z.strictObject({
    requires_time_dim: z.boolean().optional(),
    max_series: z.number().int().positive().optional(),
    categorical_dims: z.strictObject({
      min: z.number().int().min(0), max: z.number().int().min(1),
    }).optional(),
    supports: z.array(z.enum(SUPPORTS)),
  }),
  guide_rules: z.array(z.string()),
  description: z.string().min(20, 'a catalog entry needs a description a reviewer can read'),
});

export interface CatalogEvidence {
  parse: { ok: boolean; error?: string };
  /** The entry's own identity — the caller does not get to name it. */
  name: string | null;
  version: number | null;
  /** Schema problems, in the reviewer's words. */
  schema: string[];
  /** Dangling references: rules, families, slots that name nothing real. */
  references: string[];
  /** True when an implementation exists for this name (ADR-47). */
  renderable: boolean;
  /** Set at approval: the catalog version the entry became. */
  published?: { name: string; version: number };
}

const blank = (): CatalogEvidence => ({
  parse: { ok: false }, name: null, version: null,
  schema: [], references: [], renderable: false,
});

const problems = (e: z.ZodError): string[] =>
  e.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`);

/**
 * Validate a proposed widget contract.
 *
 * `renderableNames` is the set of widget names the studio actually has a
 * component for — injected, never imported, because this module runs on the
 * server and the renderers are React (the same boundary the linter keeps).
 */
export function validateWidgetProposal(
  payload: string,
  renderableNames: ReadonlySet<string>,
  taken: (name: string, version: number) => boolean,
): CatalogEvidence {
  const evidence = blank();

  let parsed: unknown;
  try {
    parsed = JSON.parse(payload);
    evidence.parse = { ok: true };
  } catch (e) {
    evidence.parse = { ok: false, error: e instanceof Error ? e.message : String(e) };
    return evidence;
  }

  const result = WidgetContractSchema.safeParse(parsed);
  if (!result.success) {
    evidence.schema = problems(result.error);
    return evidence;
  }
  const c = result.data;
  evidence.name = c.widget;
  evidence.version = c.version;
  evidence.renderable = renderableNames.has(c.widget);

  // A cited rule the linter cannot emit is a promise nothing keeps.
  const known = new Set<string>(RULE_IDS);
  for (const r of c.guide_rules) {
    if (!known.has(r)) {
      evidence.references.push(
        `guide_rules names ${r}, which the linter cannot emit — cite a real rule id, `
        + 'or propose the rule first',
      );
    }
  }

  if (c.accepts.categorical_dims && c.accepts.categorical_dims.max < c.accepts.categorical_dims.min) {
    evidence.references.push('categorical_dims.max is below its min — no binding could satisfy it');
  }

  if (taken(c.widget, c.version)) {
    evidence.references.push(
      `${c.widget}@${c.version} is already in the catalog — versions are append-only, `
      + 'so a revision needs the next version number',
    );
  }

  return evidence;
}

/** Validate a proposed pattern: the shipped schema, plus slot references. */
export function validatePatternProposal(
  payload: string,
  taken: (name: string, version: number) => boolean,
): CatalogEvidence {
  const evidence = blank();

  let parsed: unknown;
  try {
    parsed = JSON.parse(payload);
    evidence.parse = { ok: true };
  } catch (e) {
    evidence.parse = { ok: false, error: e instanceof Error ? e.message : String(e) };
    return evidence;
  }

  const result = PatternSchema.safeParse(parsed);
  if (!result.success) {
    evidence.schema = problems(result.error);
    return evidence;
  }
  const p = result.data;
  evidence.name = p.pattern;
  evidence.version = p.version;
  // A pattern is a layout of widgets, not a renderer — nothing to implement.
  evidence.renderable = true;

  const names = new Set<string>();
  for (const slot of p.slots) {
    if (names.has(slot.name)) {
      evidence.references.push(`two slots are both called ${slot.name}`);
    }
    names.add(slot.name);
  }
  if (!p.slots.some((s) => s.required)) {
    evidence.references.push(
      'no slot is required, so any dashboard at all would instantiate this pattern — '
      + 'a pattern that constrains nothing is not an archetype',
    );
  }

  if (taken(p.pattern, p.version)) {
    evidence.references.push(
      `${p.pattern}@${p.version} is already in the catalog — versions are append-only, `
      + 'so a revision needs the next version number',
    );
  }

  return evidence;
}

/** What blocks submission — the catalog half of `submitBlockers`. */
export function catalogBlockers(evidence: CatalogEvidence): string[] {
  const out: string[] = [];
  if (!evidence.parse.ok) out.push(`the contract is not valid JSON: ${evidence.parse.error}`);
  out.push(...evidence.schema);
  out.push(...evidence.references);
  return out;
}

/** Which validator a proposal needs, by what it proposes. */
export const isCatalogArtifact = (t: ProposalArtifact): t is 'widget' | 'pattern' =>
  t === 'widget' || t === 'pattern';
