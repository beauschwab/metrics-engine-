/**
 * SM-01 — small multiples share one scale, or they compare nothing.
 *
 * The panels of a small-multiples chart are read against each other; that is
 * the only reason to draw them side by side rather than as one overlaid
 * chart. A shared scale is what makes the comparison true, and the renderer
 * computes one extent across every panel precisely so it cannot drift.
 *
 * What the *linter* can still catch is the binding that makes a shared scale
 * meaningless: panels split across a dimension whose groups live at wildly
 * different magnitudes. On one scale, the small panels flatten to a line at
 * the axis; per-panel scales would compare nothing. Either way the chart
 * fails, and the fix is a different split or a different measure — a design
 * decision, so no mechanical fix.
 *
 * The check is structural rather than numeric (the linter never sees values):
 * a split on a dim the contract marks as spanning heterogeneous magnitudes
 * cannot be verified here, so SM-01 instead enforces the two things that are
 * checkable from the spec alone — that the split exists at all, and that the
 * panel count stays inside what the contract admits as readable.
 */

import type { LintFinding, Rule } from '../context';
import { widgetsOf } from '../context';

export const SM_01: Rule = (spec, ctx) =>
  widgetsOf(spec, ctx).flatMap(({ w, path, widgetContract, metricContract }): LintFinding[] => {
    if (widgetContract?.widget !== 'small-multiples') return [];

    // Categorical means "not the contract's time dim" — read from the
    // contract, like every other rule, rather than assuming it is named
    // `as_of_date` (a differently-named time dim would make this rule inert).
    const dims = w.bind.dims ?? [];
    const isTime = (d: string) => metricContract
      ? metricContract.dims.find((c) => c.name === d)?.type === 'time'
      : d === 'as_of_date';
    const catDims = dims.filter((d) => !isTime(d));

    // No split: one panel is a timeseries wearing the wrong widget.
    if (!catDims.length) {
      const hasTimeseries = ctx.widgets.has('timeseries@1');
      return [{
        rule: 'SM-01', severity: 'BLOCK' as const, path: `${path}/bind/dims`, widget: w.id,
        message: 'small multiples with no categorical split render a single panel — '
          + 'there is nothing to compare. Split on a dimension, or use a timeseries.',
        ...(hasTimeseries
          ? {
            fix: [{ op: 'replace' as const, path: `${path}/type`, value: 'timeseries@1' }],
            fixLabel: 'Use a timeseries',
          }
          : {}),
      }];
    }

    // Too many panels: past the contract's ceiling every panel is a thumbnail,
    // and a shared scale makes the small ones unreadable rather than comparable.
    const max = widgetContract.accepts.max_series;
    const split = catDims[0];
    const values = metricContract?.dims.find((d) => d.name === split)?.values;
    if (max !== undefined && values && values.length > max) {
      return [{
        rule: 'SM-01', severity: 'WARN' as const, path: `${path}/bind/dims`, widget: w.id,
        message: `${split} has ${values.length} values — past ${max} panels the shared `
          + 'scale that makes small multiples comparable renders the smaller ones flat. '
          + 'Filter to the drivers worth comparing, or split on a coarser dimension.',
      }];
    }

    return [];
  });
