/**
 * TS-02 — a line chart is not a haystack.
 *
 * The series count of a time-series widget is the product of its categorical
 * dims' cardinalities, read from the metric contract. Past the widget's
 * `max_series` (8 by default) the right answer is small multiples, so that is
 * what the finding says — a WARN, because density is a judgment, unlike a
 * missing axis.
 */

import type { Rule } from '../context';
import { widgetsOf } from '../context';

export const TS_02: Rule = (spec, ctx) =>
  widgetsOf(spec, ctx).flatMap(({ w, path, widgetContract, metricContract }) => {
    if (widgetContract?.family !== 'timeseries' || !metricContract) return [];
    const max = widgetContract.accepts.max_series ?? 8;

    let series = 1;
    for (const name of w.bind.dims ?? []) {
      const dim = metricContract.dims.find((d) => d.name === name);
      if (dim && dim.type !== 'time') series *= dim.values?.length ?? 2;
    }
    if (series <= max) return [];
    return [{
      rule: 'TS-02', severity: 'WARN' as const, path: `${path}/bind/dims`, widget: w.id,
      message: `${series} series on one chart (max ${max}) — split into small multiples `
        + 'or filter the dimension down',
    }];
  });
