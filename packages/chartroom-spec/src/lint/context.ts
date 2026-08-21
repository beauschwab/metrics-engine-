/**
 * The linter's world, injected whole.
 *
 * A rule is a pure function of (spec, context). Contracts are handed in by
 * whoever has them — the server with fresh registry state, the studio with its
 * cache, a golden test with fixtures — and the linter never fetches, which is
 * why the same rule file gives the same finding in all three places.
 */

import type { DashboardSpec, WidgetInstance } from '../schema';
import { parseWidgetType } from '../schema';
import type { MetricContract, WidgetContract } from '../contracts';
import type { PatchOp } from '../patch';

export type Severity = 'BLOCK' | 'WARN' | 'SUGGEST';

export interface LintFinding {
  rule: string;
  severity: Severity;
  /** JSON Pointer to the offending node — same grammar the fixes patch. */
  path: string;
  widget?: string;
  message: string;
  /** RFC-6902 ops that resolve the finding, when a fix is mechanical. */
  fix?: PatchOp[];
  fixLabel?: string;
}

export interface LintContext {
  /** Keyed by full ref (keel://doc.measure@rev). */
  contracts: Map<string, MetricContract>;
  /** Keyed by type ref (timeseries@1). */
  widgets: Map<string, WidgetContract>;
}

export interface LintReport {
  findings: LintFinding[];
  counts: { block: number; warn: number; suggest: number };
}

/** Per-widget view a rule iterates — index gives the patch path root. */
export interface WidgetAt {
  w: WidgetInstance;
  i: number;
  path: string; // /widgets/<i>
  widgetContract: WidgetContract | null;
  metricContract: MetricContract | null;
}

export function widgetsOf(spec: DashboardSpec, ctx: LintContext): WidgetAt[] {
  return spec.widgets.map((w, i) => {
    const t = parseWidgetType(w.type);
    return {
      w,
      i,
      path: `/widgets/${i}`,
      widgetContract: (t && ctx.widgets.get(w.type)) || null,
      metricContract: ctx.contracts.get(w.bind.metric) || null,
    };
  });
}

export type Rule = (spec: DashboardSpec, ctx: LintContext) => LintFinding[];
