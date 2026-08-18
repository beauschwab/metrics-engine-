/**
 * AREA-01 — a stack is a claim that the parts make the whole.
 *
 * AGG-01's sibling, one family over. Where a grid sums margins, a stacked
 * area sums *bands*: the height at any date is the sum of everything below
 * it, and the top edge is read as a total. That reading is only true for a
 * measure that re-aggregates by sum — stack a ratio and the top edge is the
 * sum of percentages, a number with no referent that nonetheless looks
 * authoritative.
 *
 * Two separate failures, both BLOCK:
 *
 *  - the measure does not re-aggregate by sum (the contract says so), or
 *  - the measure can go negative, which makes a stack self-overlapping —
 *    bands below the axis are drawn *through* the ones beneath them, so the
 *    picture is not merely imprecise but wrong about ordering.
 *
 * The second is inferred conservatively: only measures whose unit and format
 * make signed values ordinary (deltas, bps moves) are called out, because a
 * false positive here blocks a legitimate chart.
 *
 * The fix routes to `timeseries@1`, which draws the same series unstacked —
 * the honest rendering of non-additive lines over time.
 */

import type { Rule } from '../context';
import { widgetsOf } from '../context';

/** Measure names that describe a signed quantity rather than a level. */
const SIGNED_NAME = /(^|_)(delta|change|move|variance|net_change|pnl|swing)(_|$)/;

export const AREA_01: Rule = (spec, ctx) =>
  widgetsOf(spec, ctx).flatMap(({ w, path, widgetContract, metricContract }) => {
    if (widgetContract?.family !== 'part_to_whole' || !metricContract) return [];

    const hasTimeseries = ctx.widgets.has('timeseries@1');
    const toTimeseries = hasTimeseries
      ? {
        fix: [{ op: 'replace' as const, path: `${path}/type`, value: 'timeseries@1' }],
        fixLabel: 'Draw as unstacked lines',
      }
      : {};

    if (!metricContract.allowed_aggregations.includes('sum')) {
      return [{
        rule: 'AREA-01', severity: 'BLOCK' as const, path: `${path}/bind/metric`, widget: w.id,
        message: `${metricContract.measure} does not re-aggregate by sum `
          + `(allowed_aggregations: ${metricContract.allowed_aggregations.length
            ? metricContract.allowed_aggregations.join(', ')
            : 'none'}) — stacking it makes the top edge a sum of values that `
          + 'do not add up. Draw the bands as separate lines instead.',
        ...toTimeseries,
      }];
    }

    if (SIGNED_NAME.test(metricContract.measure) || metricContract.format === 'bps') {
      return [{
        rule: 'AREA-01', severity: 'BLOCK' as const, path: `${path}/bind/metric`, widget: w.id,
        message: `${metricContract.measure} is a signed measure — a stack of values that `
          + 'can go negative overlaps itself, so the bands stop meaning what their '
          + 'height says. Draw the bands as separate lines instead.',
        ...toTimeseries,
      }];
    }

    return [];
  });
