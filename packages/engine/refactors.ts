/**
 * Refactor prompts (§7.3).
 *
 * Passive, informational, never modal — a dim gutter hint that expands on
 * hover. These are not diagnostics: nothing here is wrong, and none of it
 * blocks. They exist to surface structure the author cannot see from one
 * screenful of text.
 */

import { dependents } from './trace';
import type { Graph, Measure } from './parse';

export interface RefactorHint {
  line: number;
  text: string;
}

/** How many dependents make a change worth warning about before it is made. */
const DEPENDENT_THRESHOLD = 3;

/** How many repeats of the same aggregate justify extracting it. */
const REPEAT_THRESHOLD = 3;

/** How many `_suffix` siblings suggest a parameter rather than a family. */
const FAMILY_THRESHOLD = 3;

function suggestName(agg: string, field: string): string {
  const stem = field.replace(/_amount$|_amt$/, '');
  return `${agg === 'sum' ? 'total' : agg}_${stem}`.replace(/__+/g, '_');
}

export function refactorHints(g: Graph): RefactorHint[] {
  const out: RefactorHint[] = [];

  // "lcr_pct has 6 dependents. Adding a filter here changes all of them."
  // The most valuable of the three, and it must fire *before* the change.
  g.measures.forEach((m) => {
    const deps = dependents(g, m.name);
    if (deps.length < DEPENDENT_THRESHOLD) return;
    out.push({
      line: m.lineOf.name,
      text:
        `${m.name} has ${deps.length} dependents — ${deps.slice(0, 3).join(', ')}` +
        `${deps.length > 3 ? ', …' : ''}. A change here moves all of them.`,
    });
  });

  // "sum(balance) appears in 3 measures. Extract as total_deposits?"
  const byAggregate: Record<string, Measure[]> = {};
  g.measures.forEach((m) => {
    if ((m.f.type || '').trim() !== 'simple' || !m.f.field) return;
    const key = `${(m.f.agg || 'sum').trim()}(${m.f.field.trim()})`;
    (byAggregate[key] || (byAggregate[key] = [])).push(m);
  });
  Object.keys(byAggregate).forEach((key) => {
    const group = byAggregate[key];
    if (group.length < REPEAT_THRESHOLD) return;
    const [agg, field] = key.replace(')', '').split('(');
    out.push({
      line: group[0].lineOf.name,
      text: `${key} appears in ${group.length} measures. Extract as ${suggestName(agg, field)}?`,
    });
  });

  // "This is the fourth _up200 variant. Consider parameterising by scenario."
  const bySuffix: Record<string, Measure[]> = {};
  g.measures.forEach((m) => {
    const parts = m.name.split('_');
    if (parts.length < 2) return;
    const suffix = parts[parts.length - 1];
    if (!/^[a-z]{1,4}\d+$/.test(suffix) && !/^\d/.test(suffix)) return;
    (bySuffix[suffix] || (bySuffix[suffix] = [])).push(m);
  });
  Object.keys(bySuffix).forEach((suffix) => {
    const group = bySuffix[suffix];
    if (group.length < FAMILY_THRESHOLD) return;
    out.push({
      line: group[group.length - 1].lineOf.name,
      text:
        `This is the ${group.length}${ordinal(group.length)} _${suffix} variant. ` +
        'Consider parameterising by scenario instead.',
    });
  });

  return out;
}

function ordinal(n: number): string {
  if (n % 100 >= 11 && n % 100 <= 13) return 'th';
  if (n % 10 === 1) return 'st';
  if (n % 10 === 2) return 'nd';
  if (n % 10 === 3) return 'rd';
  return 'th';
}
