/**
 * NUM-01 — formatting belongs to the function, not the dashboard.
 *
 * The unit is not overridable at all (the schema has no unit field); precision
 * may drift by at most one decimal from the contract's declared precision,
 * because "show one fewer decimal in a dense tile" is layout and "show a bp
 * metric as raw ratio" is a different number. The fix clamps to the nearest
 * permitted value.
 */

import type { Rule } from '../context';
import { widgetsOf } from '../context';

export const NUM_01: Rule = (spec, ctx) =>
  widgetsOf(spec, ctx).flatMap(({ w, path, metricContract }) => {
    const decimals = w.format?.decimals;
    if (decimals === undefined || !metricContract) return [];
    const p = metricContract.precision;
    if (Math.abs(decimals - p) <= 1) return [];
    const clamped = Math.max(Math.min(decimals, p + 1), Math.max(0, p - 1));
    return [{
      rule: 'NUM-01', severity: 'BLOCK' as const, path: `${path}/format/decimals`, widget: w.id,
      message: `${metricContract.measure} declares ${p} decimal${p === 1 ? '' : 's'} `
        + `(±1 allowed); ${decimals} makes the same number read differently on different dashboards`,
      fix: [{ op: 'replace' as const, path: `${path}/format/decimals`, value: clamped }],
      fixLabel: `Clamp to ${clamped}`,
    }];
  });
