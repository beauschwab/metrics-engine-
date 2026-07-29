/**
 * The evaluation core.
 *
 * Every measure resolves to a 60-point daily series, not a single number —
 * that is what makes the sparkline, the day-over-day window ops and the
 * trailing-volatility measures real rather than decorative. The value shown in
 * the panel is simply the last point.
 *
 * An Evaluator is scoped to one (document, fixture) pair and memoises within
 * that scope. When the document changes the caller builds a new one, which is
 * why there is no cache-invalidation logic here to get wrong.
 */

import { DATES, LAST, TABLES, type Row } from './fixtures';
import { evalExpression } from './expression';
import { compilePredicate } from './predicate';
import { exprNames, reqs, type Graph, type Measure } from './parse';
import { DOMAINS, ENUMS, EXTERNAL, isReferenceName, type FixtureName } from './vocab';
import { deriveRows, runClassification, type Coverage, type RowResult } from './rows';
import { buildRegistry, resolveClassification, type Registry } from './registry';

export interface Series {
  /** One value per date in DATES. */
  s: number[];
  format: string;
  cyclic?: boolean;
  missing?: boolean;
  ext?: boolean;
  // simple
  simple?: boolean;
  rows?: number;
  scanned?: number;
  agg?: string;
  field?: string;
  where?: string;
  predErr?: string | null;
  predCols?: string[];
  // windowed
  windowed?: boolean;
  op?: string;
  over?: number;
  input?: string;
  // derived
  derived?: boolean;
  branch?: string | null;
  hasCase?: boolean;
}

export interface Value extends Series {
  /** The as-of value — the last point of the series. */
  v: number;
}

export function aggregate(op: string, vals: number[]): number {
  const n = vals.length;
  if (op === 'count') return n;
  if (!n) return op === 'sum' ? 0 : NaN;
  if (op === 'avg') return vals.reduce((a, b) => a + b, 0) / n;
  if (op === 'min') return Math.min.apply(null, vals);
  if (op === 'max') return Math.max.apply(null, vals);
  if (op === 'first') return vals[0];
  if (op === 'last') return vals[n - 1];
  return vals.reduce((a, b) => a + b, 0);
}

export function windowOp(op: string, s: number[], i: number, n: number): number {
  if (op === 'delta') return i >= n ? s[i] - s[i - n] : NaN;
  if (op === 'pct_change') return i >= n && s[i - n] ? (s[i] / s[i - n] - 1) * 100 : NaN;
  if (i < n - 1) return NaN;

  const w = s.slice(i - n + 1, i + 1).filter((v) => !isNaN(v));
  if (!w.length) return NaN;
  if (op === 'avg') return aggregate('avg', w);
  if (op === 'sum') return aggregate('sum', w);
  if (op === 'min') return Math.min.apply(null, w);
  if (op === 'max') return Math.max.apply(null, w);

  const mean = aggregate('avg', w);
  const varc = w.reduce((a, v) => a + (v - mean) * (v - mean), 0) / Math.max(1, w.length - 1);
  return op === 'variance' ? varc : Math.sqrt(varc);
}

/** sum(w·x) / sum(w) — NaN when no usable weight, never a silent plain mean. */
export function weightedAvg(vals: number[], weights: number[]): number {
  let num = 0;
  let den = 0;
  for (let i = 0; i < vals.length; i++) {
    const w = weights[i];
    if (!Number.isFinite(w)) continue;
    num += w * vals[i];
    den += w;
  }
  return den === 0 ? NaN : num / den;
}

const flat = (v: number) => DATES.map(() => v);

/** An empty registry, for views that use no classifications or parameters. */
const NO_REGISTRY: Registry = buildRegistry({});

export class Evaluator {
  private memo: Record<string, Series> = {};
  /** Derived rows per as-of date — computed once, read by every measure. */
  private derived: Record<string, RowResult> = {};

  constructor(
    readonly graph: Graph,
    readonly fixture: FixtureName,
    readonly registry: Registry = NO_REGISTRY,
  ) {}

  /**
   * Source rows for a date with every row-level derivation applied.
   *
   * Memoised per date because a view with a classification would otherwise
   * re-run the whole rule set once per measure, and there are seven of them.
   */
  rowsFor(date: string): RowResult {
    const hit = this.derived[date];
    if (hit) return hit;
    const table = (TABLES[this.fixture] || {})[this.graph.view.source] || {};
    const r = deriveRows(this.graph, this.registry, table[date] || [], date, DOMAINS);
    this.derived[date] = r;
    return r;
  }

  /** Classification coverage at the as-of date — the answer for a rule set. */
  coverage(): Record<string, Coverage> {
    return this.rowsFor(DATES[LAST]).coverage;
  }

  /**
   * Coverage for a classification document verified on its own source, so a
   * rule set can be authored and checked without a metrics view around it.
   */
  selfCoverage(): Coverage | null {
    if (this.graph.kind !== 'classification') return null;
    const c = resolveClassification(this.registry, this.graph.docName, DATES[LAST]);
    if (!c) return null;
    const table = (TABLES[this.fixture] || {})[c.source] || {};
    const rows = (table[DATES[LAST]] || []).map((r) => ({ ...r }));
    return runClassification(c, rows, DOMAINS);
  }

  /** Everything the row stage could not resolve or look up. */
  rowProblems(): Pick<RowResult, 'paramMisses' | 'unknownOps' | 'unresolved'> {
    const r = this.rowsFor(DATES[LAST]);
    return { paramMisses: r.paramMisses, unknownOps: r.unknownOps, unresolved: r.unresolved };
  }

  series(name: string, seen?: Record<string, true>): Series {
    // Cycle detection has to bypass the cache: the same name means something
    // different once it appears inside its own dependency chain.
    if (seen && seen[name]) return { s: flat(NaN), cyclic: true, format: 'number' };
    const hit = this.memo[name];
    if (hit) return hit;
    const r = this.compute(name, seen || {});
    this.memo[name] = r;
    return r;
  }

  value(name: string): Value {
    const r = this.series(name);
    return { ...r, v: r.s[LAST] };
  }

  /** As-of value of every measure in the view — the blast-radius baseline. */
  snapshot(): Record<string, number> {
    const out: Record<string, number> = {};
    this.graph.measures.forEach((m) => {
      out[m.name] = this.series(m.name).s[LAST];
    });
    return out;
  }

  private compute(name: string, seen: Record<string, true>): Series {
    const g = this.graph;

    const ext = EXTERNAL[name];
    if (ext && !g.byName[name]) {
      const v = ext.v[this.fixture];
      return { s: DATES.map((_, i) => v * (0.968 + 0.0011 * i)), format: ext.format, ext: true };
    }

    const m = g.byName[name];
    if (!m) return { s: flat(NaN), missing: true, format: 'number' };

    const next = { ...seen, [name]: true as const };
    const fmt = m.f.format || 'number';
    const type = (m.f.type || '').trim();

    if (type === 'simple') return this.computeSimple(m, fmt);
    if (type === 'windowed') return this.computeWindowed(m, fmt, next);
    return this.computeDerived(m, fmt, next);
  }

  private computeSimple(m: Measure, fmt: string): Series {
    const pred = compilePredicate(m.f.where || '');
    const op = (m.f.agg || 'sum').trim();
    const field = (m.f.field || '').trim();
    const weightField = (m.f.weight || '').trim();

    const s: number[] = [];
    let rows = 0;
    let scanned = 0;

    DATES.forEach((d, i) => {
      // Read the derived rows, so a measure can aggregate a classified column
      // exactly as it aggregates a source column.
      const rs: Row[] = this.rowsFor(d).rows;
      const vals: number[] = [];
      const weights: number[] = [];
      let n = 0;
      for (let k = 0; k < rs.length; k++) {
        if (!pred.fn(rs[k])) continue;
        n++;
        const val = rs[k][field];
        if (typeof val === 'number' && !Number.isNaN(val)) {
          vals.push(val);
          const w = rs[k][weightField];
          weights.push(typeof w === 'number' ? w : NaN);
        }
      }
      if (i === LAST) {
        rows = n;
        scanned = rs.length;
      }
      s.push(op === 'weighted_avg' ? weightedAvg(vals, weights) : aggregate(op, vals));
    });

    return {
      s, rows, scanned, format: fmt, agg: op, field,
      where: (m.f.where || '').trim(),
      predErr: pred.err, predCols: pred.cols, simple: true,
    };
  }

  private computeWindowed(m: Measure, fmt: string, seen: Record<string, true>): Series {
    const input = reqs(m)[0];
    const op = (m.f['window.op'] || '').trim();
    const over = parseInt(m.f['window.over'] || '1', 10) || 1;

    if (!input || ENUMS['window.op'].indexOf(op) < 0) {
      return { s: flat(NaN), format: fmt, windowed: true, op, over, input };
    }

    const inp = this.series(input, seen);
    return {
      s: DATES.map((_, i) => windowOp(op, inp.s, i, over)),
      format: fmt, windowed: true, op, over, input, cyclic: inp.cyclic,
    };
  }

  private computeDerived(m: Measure, fmt: string, seen: Record<string, true>): Series {
    let cyc = false;
    const names = exprNames(m)
      .filter(isReferenceName)
      .filter((n, i, a) => a.indexOf(n) === i);

    // Children are resolved once and indexed by date. Resolving them per-date
    // recomputes the whole subtree 60 times over and compounds down the chain.
    const child: Record<string, number[]> = {};
    names.forEach((n) => {
      const r = this.series(n, seen);
      if (r.cyclic) cyc = true;
      child[n] = r.s;
    });

    let branch: string | null = null;
    const s = DATES.map((_, i) => {
      const r = evalExpression(m.f.expression || '', (n) => (child[n] ? child[n][i] : NaN));
      if (i === LAST) branch = r.branch;
      return r.value;
    });

    return {
      s, format: fmt, derived: true, cyclic: cyc, branch,
      hasCase: /\bcase\b/i.test(m.f.expression || ''),
    };
  }
}
