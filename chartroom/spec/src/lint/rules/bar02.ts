/**
 * BAR-02 — bars sort by value, unless the dimension is ordinal.
 *
 * Tenor buckets stay in tenor order; everything else sorts by magnitude so the
 * reader's first glance answers "what's biggest". Ordinality is a property of
 * the dimension, read from the metric contract — never guessed from the name.
 * Both violations carry a one-op fix.
 */

import type { Rule } from '../context';
import { widgetsOf } from '../context';

export const BAR_02: Rule = (spec, ctx) =>
  widgetsOf(spec, ctx).flatMap(({ w, path, widgetContract, metricContract }) => {
    if (widgetContract?.family !== 'bar' || !metricContract) return [];
    const catName = (w.bind.dims ?? []).find((d) =>
      metricContract.dims.some((c) => c.name === d && c.type !== 'time'));
    if (!catName) return [];
    const dim = metricContract.dims.find((c) => c.name === catName)!;

    const want = dim.ordinal ? 'dim' : 'value';
    const have = w.bind.sort ?? want; // absent = the guide's default, which is fine
    if (have === want) return [];

    const sortPath = `${path}/bind/sort`;
    return [{
      rule: 'BAR-02', severity: 'WARN' as const, path: sortPath, widget: w.id,
      message: dim.ordinal
        ? `${catName} is ordinal — sorting by value scrambles the ${catName} order the reader expects`
        : `bars over ${catName} should sort by value so the biggest reads first`,
      fix: [w.bind.sort === undefined
        ? { op: 'add' as const, path: sortPath, value: want }
        : { op: 'replace' as const, path: sortPath, value: want }],
      fixLabel: `Sort by ${want === 'dim' ? catName : 'value'}`,
    }];
  });
