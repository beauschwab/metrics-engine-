/**
 * DEN-01 — ratios shown side by side must share a denominator.
 *
 * Two ratio tiles on the same visual row invite the reader to compare them,
 * and comparing a/x with b/y as if they were a/x with b/x is how a committee
 * reaches a wrong conclusion politely. "Side by side" means overlapping
 * y-extents — same band of the grid. Denominator lineage comes from the
 * contract (`denominator_of`), never from parsing expressions here. WARN, no
 * fix: the resolution is a design decision (move one, or restate it).
 */

import type { Rule } from '../context';
import { widgetsOf, type WidgetAt } from '../context';

const overlapY = (a: WidgetAt, b: WidgetAt) =>
  a.w.pos.y < b.w.pos.y + b.w.pos.h && b.w.pos.y < a.w.pos.y + a.w.pos.h;

export const DEN_01: Rule = (spec, ctx) => {
  const ratios = widgetsOf(spec, ctx).filter((x) => x.metricContract?.denominator_of);
  const out = [];
  for (let i = 0; i < ratios.length; i++) {
    for (let j = i + 1; j < ratios.length; j++) {
      const a = ratios[i];
      const b = ratios[j];
      if (!overlapY(a, b)) continue;
      const da = a.metricContract!.denominator_of;
      const db = b.metricContract!.denominator_of;
      if (da === db) continue;
      out.push({
        rule: 'DEN-01', severity: 'WARN' as const, path: `${b.path}/bind/metric`, widget: b.w.id,
        message: `${a.w.id} (over ${da}) and ${b.w.id} (over ${db}) sit side by side but are `
          + 'ratios over different denominators — readers will compare them as if they were not',
      });
    }
  }
  return out;
};
