/**
 * REF-01 — every binding resolves.
 *
 * Not one of the spec's 13 named rules, but the precondition most of them
 * share: a metric ref the registry doesn't know, a widget type the catalog
 * doesn't carry, or a dim the contract doesn't declare. Without this pass each
 * downstream rule would half-check unresolvable bindings and the report would
 * say "clean" about a dashboard that cannot render — the linter's version of a
 * confident zero.
 */

import type { Rule } from '../context';
import { widgetsOf } from '../context';

export const REF_01: Rule = (spec, ctx) =>
  widgetsOf(spec, ctx).flatMap(({ w, path, widgetContract, metricContract }) => {
    const out = [];
    if (!widgetContract) {
      out.push({
        rule: 'REF-01', severity: 'BLOCK' as const, path: `${path}/type`, widget: w.id,
        message: `${w.type} is not in the widget catalog`,
      });
    }
    if (!metricContract) {
      out.push({
        rule: 'REF-01', severity: 'BLOCK' as const, path: `${path}/bind/metric`, widget: w.id,
        message: `${w.bind.metric} is not in the registry — check the name and the pinned revision`,
      });
    } else {
      const known = new Set(metricContract.dims.map((d) => d.name));
      for (const dim of w.bind.dims ?? []) {
        if (!known.has(dim)) {
          out.push({
            rule: 'REF-01', severity: 'BLOCK' as const, path: `${path}/bind/dims`, widget: w.id,
            message: `${metricContract.measure} has no dimension called ${dim} `
              + `(it has: ${metricContract.dims.map((d) => d.name).join(', ')})`,
          });
        }
      }
      for (const f of w.bind.filters ?? []) {
        if (!known.has(f.dim)) {
          out.push({
            rule: 'REF-01', severity: 'BLOCK' as const, path: `${path}/bind/filters`, widget: w.id,
            message: `filter names a dimension ${metricContract.measure} does not have: ${f.dim}`,
          });
        }
      }
    }
    return out;
  });
