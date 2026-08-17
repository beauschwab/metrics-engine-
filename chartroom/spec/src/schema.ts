/**
 * The dashboard spec DSL — Zod as the single source of truth (ADR-6).
 *
 * The schema is the strongest of the design guide's three enforcement layers:
 * what it does not express cannot be built. There is no raw SQL field, no
 * freeform HTML, no color property, no dual-axis flag — those are not
 * "linted against", they are unrepresentable. `strictObject` everywhere, so an
 * unknown key is a schema error rather than a payload smuggled past review.
 */

import { z } from 'zod';

// keel://<document>.<measure>@<revision> — the version segment is the registry
// document revision, the unit of versioning this registry actually has (ADR-13).
export const METRIC_REF = /^keel:\/\/([a-z0-9_]+)\.([a-z0-9_]+)@(\d+)$/;
export const MetricRefSchema = z.string().regex(METRIC_REF, {
  message: 'metric refs look like keel://liquidity_pit.lcr_pct@4',
});
export type MetricRef = z.infer<typeof MetricRefSchema>;

export function parseMetricRef(ref: string): { doc: string; measure: string; version: number } | null {
  const m = METRIC_REF.exec(ref);
  return m ? { doc: m[1], measure: m[2], version: Number(m[3]) } : null;
}

// <widget>@<version>, e.g. timeseries@1
export const WIDGET_TYPE_REF = /^([a-z][a-z0-9-]*)@(\d+)$/;
export const WidgetTypeRefSchema = z.string().regex(WIDGET_TYPE_REF);
export type WidgetTypeRef = z.infer<typeof WidgetTypeRefSchema>;

export function parseWidgetType(ref: string): { widget: string; version: number } | null {
  const m = WIDGET_TYPE_REF.exec(ref);
  return m ? { widget: m[1], version: Number(m[2]) } : null;
}

const Slug = z.string().regex(/^[a-z][a-z0-9-]*$/, {
  message: 'ids are lower-case slugs, like lcr-monitor',
});

export const AUDIENCES = ['trader', 'alm-analyst', 'treasury-committee', 'cfo', 'exec'] as const;
export const CADENCES = ['streaming', 'intraday', 'eod', 'monthly'] as const;
export const STATUSES = ['draft', 'team', 'certified'] as const;

const ContextParamSchema = z.strictObject({
  dim: z.string().min(1),
  default: z.string(),
});

const FilterSchema = z.union([
  z.strictObject({
    dim: z.string().min(1),
    op: z.enum(['=', '!=']),
    value: z.union([z.string(), z.number(), z.boolean()]),
  }),
  z.strictObject({
    dim: z.string().min(1),
    op: z.literal('in'),
    value: z.array(z.union([z.string(), z.number()])).min(1),
  }),
  // A filter bound to a dashboard context param rather than a literal —
  // `{ dim: legal_entity, op: '=', param: entity }`. CTX-01 checks the
  // declaration exists.
  z.strictObject({
    dim: z.string().min(1),
    op: z.literal('='),
    param: z.string().min(1),
  }),
]);
export type FilterExpr = z.infer<typeof FilterSchema>;

const WindowSchema = z.strictObject({
  // Days only, because the underlying series is daily (ADR-15).
  trailing: z.string().regex(/^\d+d$/, { message: 'windows are day-counts, like 60d' }),
});

const CompareSchema = z.strictObject({
  vs: z.union([MetricRefSchema, z.literal('prior_period')]),
  style: z.enum(['threshold', 'delta']),
});
export type CompareSpec = z.infer<typeof CompareSchema>;

// Draft-mode-only derived expressions (PRD open question #2, answered yes):
// binary ops over exactly two registered metrics, nothing else. GOV-01 blocks
// them from ever leaving draft.
const DerivedSchema = z.strictObject({
  op: z.enum(['ratio', 'delta', 'pct_change']),
  of: z.tuple([MetricRefSchema, MetricRefSchema]),
});
export type DerivedExpr = z.infer<typeof DerivedSchema>;

const BindingSchema = z.strictObject({
  metric: MetricRefSchema,
  dims: z.array(z.string().min(1)).max(4).optional(),
  filters: z.array(FilterSchema).max(8).optional(),
  window: WindowSchema.optional(),
  compare: CompareSchema.optional(),
  bands: z.array(MetricRefSchema).max(4).optional(),
  max_cells: z.number().int().positive().optional(),
  sort: z.enum(['value', 'dim']).optional(),
  derived: DerivedSchema.optional(),
});
export type Binding = z.infer<typeof BindingSchema>;

// Deliberately narrow. No unit override (NUM-01 makes units a property of the
// registry function), no palette, no color — emphasis is the only chromatic
// knob, and COL-03 reserves 'semantic' for widgets with a threshold to show.
const FormatSchema = z.strictObject({
  decimals: z.number().int().min(0).max(6).optional(),
  emphasis: z.enum(['neutral', 'semantic']).optional(),
});
export type FormatOverrides = z.infer<typeof FormatSchema>;

const PosSchema = z.strictObject({
  x: z.number().int().min(0).max(11),
  y: z.number().int().min(0),
  w: z.number().int().min(1).max(12),
  h: z.number().int().min(1).max(12),
});

const WidgetInstanceSchema = z.strictObject({
  id: Slug,
  type: WidgetTypeRefSchema,
  title: z.string().max(80).optional(),
  pos: PosSchema,
  bind: BindingSchema,
  format: FormatSchema.optional(),
  /**
   * Author commentary (Phase 9, `annotation@1`). Prose, not markup — the
   * panel renders it as text. It lives on the widget rather than floating
   * free so a comment always travels with the metric it is about: when that
   * metric's revision moves, the upgrade notice names the commentary too.
   */
  note: z.string().max(600).optional(),
});
export type WidgetInstance = z.infer<typeof WidgetInstanceSchema>;

const InteractionSchema = z.strictObject({
  cross_filter: z.strictObject({
    source: Slug,
    dim: z.string().min(1),
    targets: z.array(Slug).min(1),
  }),
});
export type Interaction = z.infer<typeof InteractionSchema>;

export const DashboardSpecSchema = z
  .strictObject({
    chartroom: z.literal('0.1'),
    dashboard: z.strictObject({
      id: Slug,
      title: z.string().min(1).max(120),
      pattern: z.union([
        z.string().regex(WIDGET_TYPE_REF),
        z.strictObject({ none: z.strictObject({ justification: z.string().min(10) }) }),
      ]),
      brief_ref: z.string().optional(),
      audience: z.enum(AUDIENCES),
      cadence: z.enum(CADENCES),
      status: z.enum(STATUSES),
    }),
    context: z.record(z.string().regex(/^[a-z][a-z0-9_]*$/), ContextParamSchema).default({}),
    layout: z.strictObject({
      grid: z.strictObject({ cols: z.literal(12), row_height: z.number().int().min(48).max(240) }),
    }),
    widgets: z.array(WidgetInstanceSchema).min(1).max(24),
    interactions: z.array(InteractionSchema).default([]),
  })
  .superRefine((spec, ctx) => {
    const seen = new Set<string>();
    spec.widgets.forEach((w, i) => {
      if (seen.has(w.id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['widgets', i, 'id'],
          message: `duplicate widget id ${w.id}`,
        });
      }
      seen.add(w.id);
    });
    spec.interactions.forEach((ix, i) => {
      const names = [ix.cross_filter.source, ...ix.cross_filter.targets];
      names.forEach((n) => {
        if (!seen.has(n)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['interactions', i],
            message: `interaction names a widget that does not exist: ${n}`,
          });
        }
      });
    });
  });

export type DashboardSpec = z.infer<typeof DashboardSpecSchema>;

/** Parse unknown input into a spec, or a list of human-readable problems. */
export function parseSpec(input: unknown):
  | { ok: true; spec: DashboardSpec }
  | { ok: false; problems: string[] } {
  const r = DashboardSpecSchema.safeParse(input);
  if (r.success) return { ok: true, spec: r.data };
  return {
    ok: false,
    problems: r.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`),
  };
}
