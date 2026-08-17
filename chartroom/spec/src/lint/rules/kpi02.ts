/**
 * KPI-02 — a naked number is a question, not an answer.
 *
 * A KPI tile exists to be judged at a glance, and a glance needs a reference:
 * a limit, the prior period, a budget. A tile without a compare is a WARN, not
 * a BLOCK — sometimes the number genuinely is the headline — and it carries no
 * auto-fix, because *which* comparison matters is exactly the judgment the
 * design brief was for.
 */

import type { Rule } from '../context';
import { widgetsOf } from '../context';

export const KPI_02: Rule = (spec, ctx) =>
  widgetsOf(spec, ctx).flatMap(({ w, path, widgetContract }) => {
    if (widgetContract?.family !== 'kpi' || w.bind.compare) return [];
    return [{
      rule: 'KPI-02', severity: 'WARN' as const, path: `${path}/bind`, widget: w.id,
      message: 'a KPI tile with no comparison — against a limit, the prior period, a budget — '
        + 'shows a number the reader cannot judge',
    }];
  });
