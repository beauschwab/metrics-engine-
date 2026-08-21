/**
 * PIE-01 — part-to-whole beyond five slices becomes a sorted bar.
 *
 * No pie widget ships in Phase 1, so most of this rule's teeth are in the
 * schema: you cannot write `pie@1` because the catalog doesn't carry it. The
 * rule exists for the part-to-whole family that *will* ship (stacked-area is
 * Phase 2) and for any future catalog addition — the guide's judgment is about
 * the family, not one widget. The auto-fix rewrites the widget to a sorted bar
 * in place, keeping the binding.
 */

import type { Rule } from '../context';
import { widgetsOf } from '../context';

export const PIE_01: Rule = (spec, ctx) =>
  widgetsOf(spec, ctx).flatMap(({ w, path, widgetContract, metricContract }) => {
    if (widgetContract?.family !== 'part_to_whole' || !metricContract) return [];
    const cat = (w.bind.dims ?? [])
      .map((d) => metricContract.dims.find((c) => c.name === d))
      .find((c) => c && c.type === 'categorical');
    if (!cat?.values || cat.values.length <= 5) return [];

    const hasBar = ctx.widgets.has('bar@1');
    return [{
      rule: 'PIE-01', severity: 'BLOCK' as const, path: `${path}/type`, widget: w.id,
      message: `part-to-whole with ${cat.values.length} slices of ${cat.name} is unreadable — `
        + 'the guide routes this to a sorted bar',
      ...(hasBar
        ? {
          fix: [
            { op: 'replace' as const, path: `${path}/type`, value: 'bar@1' },
            { op: w.bind.sort === undefined ? ('add' as const) : ('replace' as const), path: `${path}/bind/sort`, value: 'value' },
          ],
          fixLabel: 'Convert to sorted bar',
        }
        : {}),
    }];
  });
