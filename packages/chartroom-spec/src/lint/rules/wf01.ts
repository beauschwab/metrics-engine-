/**
 * WF-01 — a bridge must actually bridge.
 *
 * A waterfall asserts an identity: opening total, plus every contribution,
 * equals closing total. When that holds, the chart explains a change. When it
 * doesn't, it still *looks* like an explanation — the bars are drawn, the
 * labels read, and the reader concludes the move is understood when in fact
 * some of it is unaccounted for. That is the failure this rule exists to
 * prevent, and it is a governance failure rather than a drawing one.
 *
 * The linter cannot check the arithmetic — it never sees values (that check
 * is the data critic's, over live numbers). What it *can* check is whether
 * the binding is capable of reconciling at all:
 *
 *  - the split must be exhaustive. A filtered waterfall bridges a subset
 *    while presenting two totals as *the* totals, so the residual is silently
 *    dropped into the gap between them.
 *  - the measure must be additive, for the same reason AGG-01 and AREA-01
 *    care: contributions that do not sum cannot compose a total.
 *
 * The runtime half is the renderer's: it draws the closing bar where the data
 * puts it, not where the steps end, so an unreconciled bridge shows its own
 * discrepancy rather than absorbing it.
 */

import type { LintFinding, Rule } from '../context';
import { widgetsOf } from '../context';

export const WF_01: Rule = (spec, ctx) =>
  widgetsOf(spec, ctx).flatMap(({ w, path, widgetContract, metricContract }): LintFinding[] => {
    if (widgetContract?.family !== 'waterfall' || !metricContract) return [];
    const findings: LintFinding[] = [];

    if (!metricContract.allowed_aggregations.includes('sum')) {
      findings.push({
        rule: 'WF-01', severity: 'BLOCK' as const, path: `${path}/bind/metric`, widget: w.id,
        message: `${metricContract.measure} does not re-aggregate by sum `
          + `(allowed_aggregations: ${metricContract.allowed_aggregations.length
            ? metricContract.allowed_aggregations.join(', ')
            : 'none'}) — its per-group moves cannot compose the total move the `
          + 'bridge claims to explain.',
      });
    }

    // A filter narrows the bars but not the story the two totals tell: the
    // excluded rows are part of the real change and land nowhere on the chart.
    //
    // The one filter that excludes nothing is an `in` naming every value the
    // contract enumerates for that dim — so that is the exemption, decided
    // from the contract rather than guessed from the list's length. (A short
    // list is the *most* narrowing, not the least.)
    const narrowing = (w.bind.filters ?? []).filter((f) => {
      if (f.op !== 'in') return true;
      const domain = metricContract.dims.find((d) => d.name === f.dim)?.values;
      if (!domain) return true; // unknown domain — assume it narrows
      return !domain.every((v) => (f.value as Array<string | number>).some((x) => String(x) === v));
    });
    if (narrowing.length) {
      const dims = narrowing.map((f) => f.dim).join(', ');
      findings.push({
        rule: 'WF-01', severity: 'WARN' as const, path: `${path}/bind/filters`, widget: w.id,
        message: `this bridge is filtered on ${dims}, so the contributions explain only `
          + 'part of the move between the totals it draws — the excluded rows go '
          + 'missing rather than showing up as a residual. Bridge the whole '
          + 'population, or say in the title which slice this is.',
      });
    }

    return findings;
  });
