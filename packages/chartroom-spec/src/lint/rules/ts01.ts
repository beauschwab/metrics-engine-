/**
 * TS-01 — time on the x-axis.
 *
 * A widget whose contract requires a time dimension must bind one. The fix
 * adds the time dim from the metric's own contract, so applying it can never
 * introduce a name the data doesn't have. (Reversed or non-time x-axes are
 * schema-impossible — there is no axis field to abuse — so the rule's whole
 * job is the missing case.)
 */

import type { Rule } from '../context';
import { widgetsOf } from '../context';

export const TS_01: Rule = (spec, ctx) =>
  widgetsOf(spec, ctx).flatMap(({ w, path, widgetContract, metricContract }) => {
    if (!widgetContract?.accepts.requires_time_dim || !metricContract) return [];
    const timeDim = metricContract.dims.find((d) => d.type === 'time');
    if (!timeDim) return [];
    const dims = w.bind.dims ?? [];
    if (dims.includes(timeDim.name)) return [];
    return [{
      rule: 'TS-01', severity: 'BLOCK' as const, path: `${path}/bind/dims`, widget: w.id,
      message: `${w.type} plots over time, but the binding has no ${timeDim.name} dimension`,
      fix: [dims.length
        ? { op: 'replace' as const, path: `${path}/bind/dims`, value: [timeDim.name, ...dims] }
        : { op: 'add' as const, path: `${path}/bind/dims`, value: [timeDim.name] }],
      fixLabel: `Add ${timeDim.name}`,
    }];
  });
