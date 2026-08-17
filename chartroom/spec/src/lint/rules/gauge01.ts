/**
 * GAUGE-01 — a limit nobody governs is not a limit.
 *
 * A bullet's entire claim is "here is the number, here is the line it must
 * not cross". The line therefore has to be a governed number: a registry
 * metric ref, with an owner, a revision, and a review trail. The spec's
 * `compare.vs` already admits exactly two things — a metric ref, or the
 * literal `prior_period` — so the failure mode this rule catches is not a
 * hardcoded literal (the schema forbids that) but the two ways an author
 * gets a *governed-looking* gauge that isn't one:
 *
 *  - no comparison at all, so the bar has nothing to be judged against; or
 *  - `prior_period`, which is a movement, not a limit. Yesterday's value is
 *    not a threshold — a metric that drifts a little every day never breaches
 *    its own prior, which is precisely the failure a limit is meant to catch.
 *
 * Both BLOCK: a gauge that renders without a real limit looks identical to
 * one that has it, and that is the kind of quiet wrongness this linter exists
 * to make impossible. No mechanical fix — *which* limit applies is the
 * judgment the brief was for.
 */

import type { Rule } from '../context';
import { widgetsOf } from '../context';

export const GAUGE_01: Rule = (spec, ctx) =>
  widgetsOf(spec, ctx).flatMap(({ w, path, widgetContract }) => {
    if (widgetContract?.widget !== 'bullet') return [];

    if (!w.bind.compare) {
      return [{
        rule: 'GAUGE-01', severity: 'BLOCK' as const, path: `${path}/bind`, widget: w.id,
        message: 'a bullet draws a value against its limit, but this one binds no '
          + 'comparison — bind `compare.vs` to the registry metric that carries the '
          + 'threshold (a limit with an owner and a revision, not a number typed here)',
      }];
    }

    if (w.bind.compare.vs === 'prior_period') {
      return [{
        rule: 'GAUGE-01', severity: 'BLOCK' as const, path: `${path}/bind/compare/vs`, widget: w.id,
        message: 'a bullet compared to `prior_period` shows movement, not a limit — a '
          + 'measure that drifts daily never breaches its own prior. Bind the registry '
          + 'metric that carries the governed threshold.',
      }];
    }

    // `delta` styles the comparison as a reference point, which renders a
    // gauge that can never breach: governed limit, ungoverned reading.
    if (w.bind.compare.style !== 'threshold') {
      return [{
        rule: 'GAUGE-01', severity: 'BLOCK' as const,
        path: `${path}/bind/compare/style`, widget: w.id,
        message: 'a bullet compares against a limit, so its compare style must be '
          + '`threshold` — as `delta` the reference renders as a movement marker and '
          + 'the gauge can never show a breach.',
        fix: [{ op: 'replace' as const, path: `${path}/bind/compare/style`, value: 'threshold' }],
        fixLabel: 'Compare as a threshold',
      }];
    }

    // Which side is safe cannot be inferred from the numbers — a floor and a
    // ceiling look identical — so a gauge that renders breaches must say.
    if (!w.bind.compare.limit) {
      return [{
        rule: 'GAUGE-01', severity: 'BLOCK' as const, path: `${path}/bind/compare`, widget: w.id,
        message: 'this gauge does not say which side of the limit is safe, so it cannot '
          + 'colour a breach without guessing — declare `compare.limit` as `floor` (the '
          + 'measure must stay above) or `ceiling` (it must stay below).',
      }];
    }

    return [];
  });
