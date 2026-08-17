/**
 * LAY-01 — widgets fit the grid and do not overlap.
 *
 * Out-of-bounds gets a clamping fix; overlap does not, because which of two
 * colliding widgets should move is a layout decision, and a linter that makes
 * layout decisions is a linter people turn off.
 */

import type { Rule } from '../context';

const COLS = 12;

export const LAY_01: Rule = (spec) => {
  const out = [];

  spec.widgets.forEach((w, i) => {
    if (w.pos.x + w.pos.w > COLS) {
      out.push({
        rule: 'LAY-01', severity: 'BLOCK' as const, path: `/widgets/${i}/pos`, widget: w.id,
        message: `${w.id} runs off the ${COLS}-column grid (x ${w.pos.x} + w ${w.pos.w})`,
        fix: [{ op: 'replace' as const, path: `/widgets/${i}/pos/w`, value: COLS - w.pos.x }],
        fixLabel: `Shrink to ${COLS - w.pos.x} columns`,
      });
    }
  });

  for (let i = 0; i < spec.widgets.length; i++) {
    for (let j = i + 1; j < spec.widgets.length; j++) {
      const a = spec.widgets[i];
      const b = spec.widgets[j];
      const hit = a.pos.x < b.pos.x + b.pos.w && b.pos.x < a.pos.x + a.pos.w
        && a.pos.y < b.pos.y + b.pos.h && b.pos.y < a.pos.y + a.pos.h;
      if (hit) {
        out.push({
          rule: 'LAY-01', severity: 'BLOCK' as const, path: `/widgets/${j}/pos`, widget: b.id,
          message: `${b.id} overlaps ${a.id}`,
        });
      }
    }
  }
  return out;
};
