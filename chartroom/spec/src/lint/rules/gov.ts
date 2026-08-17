/**
 * GOV-01 / GOV-02 — what may not leave draft.
 *
 * Draft mode is deliberately loose: ad-hoc derived expressions (a ratio of two
 * governed metrics) keep exploration fast, and a metric that only exists at a
 * revision production has never served can still be previewed. Promotion is
 * where the looseness ends. Both rules key off `dashboard.status`, so the same
 * spec that lints clean as a draft blocks as `team` — the gate is in the
 * artifact, and the server's promote path runs this same linter (never trust
 * the studio).
 */

import type { Rule } from '../context';
import { widgetsOf } from '../context';

export const GOV_01: Rule = (spec, ctx) => {
  if (spec.dashboard.status === 'draft') return [];
  return widgetsOf(spec, ctx).flatMap(({ w, path }) => {
    if (!w.bind.derived) return [];
    return [{
      rule: 'GOV-01', severity: 'BLOCK' as const, path: `${path}/bind/derived`, widget: w.id,
      message: `an ad-hoc ${w.bind.derived.op} cannot leave draft — formalise it as a registry `
        + 'function so the calculation is governed, then bind that',
    }];
  });
};

export const GOV_02: Rule = (spec, ctx) => {
  if (spec.dashboard.status === 'draft') return [];
  return widgetsOf(spec, ctx).flatMap(({ w, path, metricContract }) => {
    const refs = [
      { ref: w.bind.metric, where: `${path}/bind/metric` },
      ...(w.bind.bands ?? []).map((b, k) => ({ ref: b, where: `${path}/bind/bands/${k}` })),
      ...(w.bind.compare && w.bind.compare.vs !== 'prior_period'
        ? [{ ref: w.bind.compare.vs, where: `${path}/bind/compare/vs` }]
        : []),
      ...(w.bind.derived ? w.bind.derived.of.map((r, k) => ({ ref: r, where: `${path}/bind/derived/of/${k}` })) : []),
    ];
    return refs.flatMap(({ ref, where }) => {
      const c = ref === w.bind.metric ? metricContract : ctx.contracts.get(ref) || null;
      if (!c || c.status === 'approved') return [];
      return [{
        rule: 'GOV-02', severity: 'BLOCK' as const, path: where, widget: w.id,
        message: c.status === 'deprecated'
          ? `${ref} is deprecated — a promoted dashboard cannot depend on it`
          : `${ref} has never been promoted to production — a ${spec.dashboard.status} dashboard `
            + 'cannot depend on an ungoverned metric',
      }];
    });
  });
};
