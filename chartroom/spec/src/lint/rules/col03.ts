/**
 * COL-03 — semantic color is reserved for thresholds.
 *
 * The palette itself is schema-impossible to override; the one chromatic knob
 * a spec has is `format.emphasis: 'semantic'`, which turns on breach red /
 * amber. That colour is a *meaning* — "this number is judged against
 * something" — so a widget with nothing to judge against (no compare, no
 * bands) may not wear it. Decoration that borrows the breach palette teaches
 * readers to ignore the breach palette.
 */

import type { Rule } from '../context';
import { widgetsOf } from '../context';

export const COL_03: Rule = (spec, ctx) =>
  widgetsOf(spec, ctx).flatMap(({ w, path }) => {
    if (w.format?.emphasis !== 'semantic') return [];
    if (w.bind.compare || (w.bind.bands && w.bind.bands.length)) return [];
    return [{
      rule: 'COL-03', severity: 'BLOCK' as const, path: `${path}/format/emphasis`, widget: w.id,
      message: 'semantic colour is reserved for widgets with a threshold — this one has no '
        + 'compare and no bands, so red here would be decoration wearing a warning’s clothes',
      fix: [{ op: 'replace' as const, path: `${path}/format/emphasis`, value: 'neutral' }],
      fixLabel: 'Use neutral emphasis',
    }];
  });
