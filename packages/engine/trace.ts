/**
 * The derivation trace and the blast radius.
 *
 * The trace is the answer to "is this number right?" — the expression
 * re-rendered with live values substituted, indented to its evaluation
 * structure, so an analyst reconciling against a regulatory report can walk
 * down until the numbers diverge. The divergent node is the defect.
 *
 * Row counts sit beside every aggregate: `0 rows` next to a `0` value makes the
 * commonest silent error self-evident.
 */

import type { Evaluator, Value } from './evaluate';
import { exprNames, reqs, type Graph } from './parse';
import { isReferenceName, WINDOW_HELP } from './vocab';

export type TraceMode = 'full' | 'drill';

export interface TraceDetail {
  text: string;
  rows: string;
  /** A predicate that matched nothing — coloured as a failure. */
  zero?: boolean;
}

export interface TraceNode {
  name: string;
  depth: number;
  value: Value;
  childCount: number;
  open: boolean;
  /** Expansion state is remembered per measure *and* depth. */
  key: string;
  detail: TraceDetail[];
  tier: number;
}

function childrenOf(g: Graph, name: string): string[] {
  const m = g.byName[name];
  if (!m) return [];
  const type = (m.f.type || '').trim();
  if (type === 'windowed') return reqs(m);
  if (type === 'simple') return [];
  return exprNames(m)
    .filter(isReferenceName)
    .filter((n, i, a) => a.indexOf(n) === i);
}

export function defaultOpen(mode: TraceMode, depth: number): boolean {
  // Q1 is built both ways: the full transitive tree, and one level with
  // drill-down. The toggle in the panel header switches between them.
  return mode === 'full' ? true : depth < 1;
}

export function traceNodes(
  g: Graph,
  ev: Evaluator,
  root: string,
  mode: TraceMode,
  collapsed: Record<string, boolean>,
): TraceNode[] {
  const out: TraceNode[] = [];

  const walk = (name: string, depth: number, seen: Record<string, true>) => {
    const m = g.byName[name];
    const r = ev.value(name);
    const kids = seen[name] ? [] : childrenOf(g, name);
    const key = `${name}@${depth}`;
    const open = collapsed[key] === undefined ? defaultOpen(mode, depth) : !collapsed[key];

    const detail: TraceDetail[] = [];
    if (m && (m.f.type || '').trim() === 'simple') {
      detail.push({
        text: `${m.f.agg || 'sum'}(${m.f.field || '?'})${m.f.where ? `  where ${m.f.where}` : ''}`,
        rows: r.rows === undefined ? '' : `${r.rows.toLocaleString('en-US')} rows`,
        zero: r.rows === 0,
      });
    }
    if (r.windowed) {
      detail.push({
        text: `${WINDOW_HELP[r.op || ''] || r.op} · ${r.over} day window`,
        rows: `${r.over} points`,
      });
    }
    if (r.hasCase) detail.push({ text: `case → ${r.branch || 'no branch matched'}`, rows: '' });
    if (r.ext && !m) detail.push({ text: 'defined in another file', rows: '' });

    out.push({
      name, depth, value: r, childCount: kids.length, open, key, detail,
      tier: m ? parseInt(m.f.sr_11_7_tier || '0', 10) : 0,
    });

    if (open) {
      const next = { ...seen, [name]: true as const };
      kids.forEach((k) => walk(k, depth + 1, next));
    }
  };

  walk(root, 0, {});
  return out;
}

/**
 * Every downstream dependent, transitively. Unchanged dependents stay listed
 * rather than being filtered out — confirming a change *didn't* propagate is as
 * informative as seeing that it did.
 */
export function dependents(g: Graph, name: string): string[] {
  const out: string[] = [];
  const seen: Record<string, true> = {};

  const direct = (n: string) =>
    g.measures
      .filter((m) => (exprNames(m).indexOf(n) >= 0 || reqs(m).indexOf(n) >= 0) && m.name !== n)
      .map((m) => m.name);

  const walk = (n: string) => {
    direct(n).forEach((d) => {
      if (!seen[d]) {
        seen[d] = true;
        out.push(d);
        walk(d);
      }
    });
  };

  walk(name);
  return out;
}
