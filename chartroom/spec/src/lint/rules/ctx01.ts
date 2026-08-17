/**
 * CTX-01 — a filter's parameter must be a declared context.
 *
 * `{ dim: legal_entity, op: '=', param: entity }` reads the dashboard-level
 * `context.entity` control. If no such control is declared the filter is a
 * dangling reference — it would silently match nothing or everything depending
 * on how charitably a renderer treated it, and both are wrong. No auto-fix:
 * inventing a default value for a governed filter is not the linter's call.
 */

import type { Rule } from '../context';
import { widgetsOf } from '../context';

export const CTX_01: Rule = (spec, ctx) =>
  widgetsOf(spec, ctx).flatMap(({ w, path }) =>
    (w.bind.filters ?? []).flatMap((f, k) => {
      if (!('param' in f)) return [];
      if (spec.context[f.param]) return [];
      return [{
        rule: 'CTX-01', severity: 'BLOCK' as const, path: `${path}/bind/filters/${k}`, widget: w.id,
        message: `filter reads context param "${f.param}", but the dashboard declares no such `
          + `context (declared: ${Object.keys(spec.context).join(', ') || 'none'})`,
      }];
    }));
