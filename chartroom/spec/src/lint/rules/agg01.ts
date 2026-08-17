/**
 * AGG-01 — totals only total what totals.
 *
 * The grid family renders margin totals structurally — every row and column
 * sums. That is exactly right for an additive measure and exactly wrong for a
 * ratio: a totals row over LCR percentages is the "summing ratios" mistake
 * the metric catalog exists to make uncheatable. The contract already says
 * which is which — `allowed_aggregations` — so a grid over a measure that
 * does not re-aggregate by sum is a BLOCK, not a judgment call. Graduated
 * from the data critic per the working agreement: this is checkable from the
 * contract alone, so it lives here, where it runs before any query does.
 *
 * No mechanical fix: the right move (a bar of the per-group ratios, a KPI of
 * the headline, or a different measure) is a design decision.
 */

import type { Rule } from '../context';
import { widgetsOf } from '../context';

export const AGG_01: Rule = (spec, ctx) =>
  widgetsOf(spec, ctx).flatMap(({ w, path, widgetContract, metricContract }) => {
    if (widgetContract?.family !== 'grid' || !metricContract) return [];
    if (metricContract.allowed_aggregations.includes('sum')) return [];
    return [{
      rule: 'AGG-01', severity: 'BLOCK' as const, path: `${path}/bind/metric`, widget: w.id,
      message: `${metricContract.measure} does not re-aggregate by sum `
        + `(allowed_aggregations: ${metricContract.allowed_aggregations.length
          ? metricContract.allowed_aggregations.join(', ')
          : 'none'}) — a grid's totals row would sum it anyway. `
        + 'Show the per-group values on a bar, or the headline on a KPI tile.',
    }];
  });
