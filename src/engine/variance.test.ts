/**
 * Variance semantics.
 *
 * Most of these are about a distinction that is easy to collapse and expensive to
 * get wrong: a control that could not run is not a control that ran and found
 * nothing. A monitor whose thresholds mostly report `insufficient` looks green in
 * a summary that only counts breaches, and covers nothing.
 */

import { describe, expect, it } from 'vitest';
import { readReport } from './compile';
import { compileMonitor } from './compile-variance';
import { diagnose, type Diagnostic } from './diagnostics';
import { INITIAL_DOCS } from './documents';
import { Evaluator } from './evaluate';
import { DATES } from './fixtures';
import { parseDoc } from './parse';
import { buildRegistry } from './registry';
import {
  BASIS_WINDOW, MIN_OBSERVATIONS, evaluate, pointsOf, readMonitor, runMonitor,
  stddev, type Point, type RollupSeries, type ThresholdSpec,
} from './variance';

const MONITOR = INITIAL_DOCS.fr2052a_variance;

const workspace = (over: Record<string, string> = {}) =>
  ({ ...INITIAL_DOCS, ...over } as Record<string, string>);

const monitorOf = (docs = workspace()) => readMonitor(parseDoc(docs.fr2052a_variance));
const reportOf = (docs = workspace()) => readReport(parseDoc(docs.fr2052a_submission));
const viewOf = (docs = workspace()) => parseDoc(docs.fr2052a_outflows);

function analyse(docs = workspace()): Diagnostic[] {
  const registry = buildRegistry(docs);
  const g = parseDoc(docs.fr2052a_variance);
  const ev = new Evaluator(g, 'nominal', registry);
  return diagnose(g, ev, undefined, registry, docs);
}

const withCode = (d: Diagnostic[], code: string) => d.filter((x) => x.code === code);

function threshold(over: Partial<ThresholdSpec> = {}): ThresholdSpec {
  return {
    id: 'T', basis: 'static_abs', limit: 100, sigma: 3, severity: 'warn',
    appliesTo: '', citation: '',
    block: { name: 'T', blockKey: 'id', line: 0, section: 'thresholds', f: {}, lineOf: {}, contentOf: {} },
    ...over,
  };
}

/** A series with a value on every date. */
function flat(values: number[]): RollupSeries {
  return { key: ['K'], values, present: values.map(() => true) };
}

const dates = (n: number) => DATES.slice(0, n);

// ---------------------------------------------------------------------------

describe('reading a monitor', () => {
  it('reads what it watches and the thresholds that judge it', () => {
    const m = monitorOf();
    expect(m.name).toBe('fr2052a_variance');
    expect(m.report).toBe('fr2052a_submission');
    expect(m.measure).toBe('weighted_outflows_30d');
    expect(m.grain).toEqual(['product_id', 'entity_id']);
    expect(m.thresholds.map((t) => t.basis)).toEqual([
      'static_abs', 'static_pct', 'stddev_30d', 'stddev_60d',
    ]);
    expect(m.thresholds.every((t) => t.citation)).toBe(true);
  });

  it('reads a scope as a predicate over the rollup key', () => {
    const retail = monitorOf().thresholds.find((t) => t.id === 'RETAIL-PCT')!;
    expect(retail.appliesTo).toContain('product_id in');
    expect(retail.severity).toBe('warn');
  });
});

describe('day-over-day changes', () => {
  it('has no change on the first observation', () => {
    const p = pointsOf(flat([100, 110, 120]), dates(3));
    expect(p[0].delta).toBeNaN();
    expect(p[1].delta).toBe(10);
    expect(p[1].gapDays).toBe(1);
  });

  it('expresses a percentage against the magnitude of the prior value', () => {
    const p = pointsOf(flat([100, 150]), dates(2));
    expect(p[1].deltaPct).toBeCloseTo(50, 9);
    // Off a negative base the sign of the *change* is what matters, so the
    // denominator is the magnitude — otherwise a fall from -100 to -150 reads
    // as an improvement.
    const q = pointsOf(flat([-100, -150]), dates(2));
    expect(q[1].delta).toBe(-50);
    expect(q[1].deltaPct).toBeCloseTo(-50, 9);
  });

  it('has no percentage off a zero base', () => {
    // Not an infinite move — an undefined one. Reporting it as a breach would
    // fire on every rollup that starts from nothing.
    const p = pointsOf(flat([0, 25]), dates(2));
    expect(p[1].delta).toBe(25);
    expect(p[1].deltaPct).toBeNaN();
  });

  it('compares across a gap, and says how wide the gap was', () => {
    // A bucket with nothing filed for a day must not silence the next day's
    // move. The distance is carried so the surface does not imply the change
    // happened overnight.
    const s: RollupSeries = {
      key: ['K'],
      values: [100, NaN, 160],
      present: [true, false, true],
    };
    const p = pointsOf(s, dates(3));
    expect(p[1].delta).toBeNaN();
    expect(p[1].disappeared).toBe(true);
    expect(p[2].delta).toBe(60);
    expect(p[2].gapDays).toBe(2);
  });

  it('flags a rollup that appears part-way through', () => {
    const s: RollupSeries = {
      key: ['K'],
      values: [NaN, NaN, 40],
      present: [false, false, true],
    };
    const p = pointsOf(s, dates(3));
    expect(p[2].appeared).toBe(true);
    // Arrived, not moved. No threshold can see it, which is why it is reported
    // separately.
    expect(p[2].delta).toBeNaN();
  });
});

describe('trailing dispersion', () => {
  it('is the sample standard deviation, undefined below two points', () => {
    expect(stddev([])).toBeNaN();
    expect(stddev([5])).toBeNaN();
    expect(stddev([2, 4])).toBeCloseTo(Math.SQRT2, 9);
  });

  it('is computed from the changes, not the levels', () => {
    // A strongly trending series has a large σ of levels and a tiny σ of daily
    // moves. Using the levels makes a threshold that never fires and still
    // reads like a working control.
    const values = Array.from({ length: 40 }, (_, i) => 1000 + i * 100);
    const p = pointsOf(flat(values), dates(40));
    const last = p[p.length - 1];
    expect(stddev(values)).toBeGreaterThan(1000);
    // Every daily move is exactly 100, so the dispersion of the moves is zero.
    expect(last.sigma.stddev_30d).toBe(0);
  });

  it('excludes the current observation from its own window', () => {
    // Thirty quiet days then one enormous one. If the window included today, σ
    // would jump on the very day being judged and the breach could vanish.
    const values = Array.from({ length: 35 }, (_, i) => 1000 + (i % 2));
    values.push(50_000);
    const p = pointsOf(flat(values), dates(36));
    const spike = p[p.length - 1];
    expect(spike.delta).toBeGreaterThan(40_000);
    // σ reflects the quiet run only — order of a single unit, not tens of
    // thousands.
    expect(spike.sigma.stddev_30d).toBeLessThan(5);
  });

  it('refuses to produce a sigma from too little history', () => {
    const p = pointsOf(flat([1, 2, 3, 4, 5]), dates(5));
    p.forEach((point) => {
      expect(point.observations.stddev_30d).toBeLessThan(MIN_OBSERVATIONS);
      expect(point.sigma.stddev_30d).toBeNaN();
    });
  });

  it('counts observations, not calendar days', () => {
    const values = Array.from({ length: 45 }, (_, i) => 100 + i);
    const p = pointsOf(flat(values), dates(45));
    // The window saturates at its size, which is what a ROWS frame does.
    expect(p[44].observations.stddev_30d).toBe(BASIS_WINDOW.stddev_30d);
  });
});

describe('judging a point', () => {
  const point = (over: Partial<Point> = {}): Point => ({
    date: DATES[0], index: 5, value: 1000, previous: 900, delta: 100, gapDays: 1,
    deltaPct: 11.1, sigma: { stddev_30d: 20, stddev_60d: 25 },
    observations: { stddev_30d: 30, stddev_60d: 60 },
    appeared: false, disappeared: false,
    ...over,
  });

  it('breaches a static amount on magnitude, in either direction', () => {
    const t = threshold({ basis: 'static_abs', limit: 50 });
    expect(evaluate(point(), t, ['k'], ['K']).verdict).toBe('breach');
    expect(evaluate(point({ delta: -100 }), t, ['k'], ['K']).verdict).toBe('breach');
    expect(evaluate(point({ delta: 10 }), t, ['k'], ['K']).verdict).toBe('pass');
  });

  it('breaches a percentage on magnitude', () => {
    const t = threshold({ basis: 'static_pct', limit: 10 });
    expect(evaluate(point({ deltaPct: 11 }), t, ['k'], ['K']).verdict).toBe('breach');
    expect(evaluate(point({ deltaPct: -11 }), t, ['k'], ['K']).verdict).toBe('breach');
    expect(evaluate(point({ deltaPct: 9 }), t, ['k'], ['K']).verdict).toBe('pass');
  });

  it('reports a sigma threshold with the limit it actually used', () => {
    const t = threshold({ basis: 'stddev_30d', sigma: 3 });
    const ev = evaluate(point({ delta: 70 }), t, ['k'], ['K']);
    expect(ev.limit).toBe(60);
    expect(ev.sigma).toBe(20);
    expect(ev.observations).toBe(30);
    expect(ev.verdict).toBe('breach');
    // A breach an analyst cannot check is a breach they will not act on, so the
    // σ and the count travel with the verdict.
    expect(evaluate(point({ delta: 50 }), t, ['k'], ['K']).verdict).toBe('pass');
  });

  it('says insufficient rather than pass when there is no threshold', () => {
    const t = threshold({ basis: 'stddev_30d', sigma: 3 });
    expect(evaluate(point({ observations: { stddev_30d: 4, stddev_60d: 4 } }), t, ['k'], ['K']).verdict)
      .toBe('insufficient');
    expect(evaluate(point({ sigma: { stddev_30d: NaN, stddev_60d: NaN } }), t, ['k'], ['K']).verdict)
      .toBe('insufficient');
  });

  it('treats a flat series as having no threshold, not one everything breaches', () => {
    // σ = 0 makes every move infinitely many standard deviations. True, and
    // useless.
    const t = threshold({ basis: 'stddev_30d', sigma: 3 });
    const ev = evaluate(point({ sigma: { stddev_30d: 0, stddev_60d: 0 } }), t, ['k'], ['K']);
    expect(ev.verdict).toBe('insufficient');
  });

  it('says insufficient when there was no prior observation', () => {
    const t = threshold({ basis: 'static_abs', limit: 1 });
    expect(evaluate(point({ delta: NaN }), t, ['k'], ['K']).verdict).toBe('insufficient');
  });

  it('scopes to the keys its predicate matches', () => {
    const t = threshold({ basis: 'static_abs', limit: 1, appliesTo: "product_id = 'O.D.1'" });
    expect(evaluate(point(), t, ['product_id'], ['O.D.1']).verdict).toBe('breach');
    expect(evaluate(point(), t, ['product_id'], ['O.W.2']).verdict).toBe('not_applicable');
  });

  it('applies to nothing when the scope cannot be read', () => {
    const t = threshold({ basis: 'static_abs', limit: 1, appliesTo: 'product_id <<' });
    expect(evaluate(point(), t, ['product_id'], ['O.D.1']).verdict).toBe('not_applicable');
  });
});

describe('running the shipped monitor', () => {
  const result = () => runMonitor(monitorOf(), reportOf(), viewOf(), buildRegistry(workspace()), 'nominal');

  it('watches every rollup the report files, at the declared grain', () => {
    const r = result();
    expect(r.keys).toBeGreaterThan(20);
    expect(r.evaluated).toBeGreaterThan(1000);
  });

  it('exercises every threshold basis on the sample data', () => {
    // A feature demonstrated only on the paths that happen to fire is a feature
    // half tested.
    const r = result();
    r.stats.forEach((s) => {
      expect(s.breaches + s.passes, `${s.id} never ran`).toBeGreaterThan(0);
    });
    expect(r.stats.every((s) => s.breaches > 0)).toBe(true);
  });

  it('ranks errors above warnings, and larger moves first', () => {
    const r = result();
    const severities = r.breaches.map((b) => b.evaluation.threshold.severity);
    const firstWarn = severities.indexOf('warn');
    const lastError = severities.lastIndexOf('error');
    expect(lastError).toBeLessThan(firstWarn === -1 ? severities.length : firstWarn);
  });

  it('carries the evidence for each breach', () => {
    const r = result();
    r.breaches.forEach((b) => {
      expect(Number.isFinite(b.delta)).toBe(true);
      expect(Number.isFinite(b.evaluation.limit)).toBe(true);
      expect(Math.abs(b.evaluation.observed)).toBeGreaterThan(b.evaluation.limit);
    });
  });

  it('finds a rollup that stops being filed', () => {
    // Positions mature off the book, so a product bucket can empty. That is a
    // reportable event, not a variance, and no threshold can express it.
    expect(result().disappeared.length).toBeGreaterThan(0);
  });
});

describe('monitor diagnostics', () => {
  it('is clean enough to ship', () => {
    const errors = analyse().filter((d) => d.sev === 'error');
    expect(errors.map((d) => `${d.code} ${d.message}`)).toEqual([]);
  });

  it('KEEL090 a report that does not exist', () => {
    const d = analyse(workspace({
      fr2052a_variance: MONITOR.replace('report: fr2052a_submission', 'report: nope'),
    }));
    expect(withCode(d, 'KEEL090')[0].message).toContain('nope');
  });

  it('KEEL091 a measure the report does not file', () => {
    const d = analyse(workspace({
      fr2052a_variance: MONITOR.replace('measure: weighted_outflows_30d', 'measure: lcr_pct'),
    }));
    expect(withCode(d, 'KEEL091')[0].message).toContain('lcr_pct');
  });

  it('KEEL092 a grain the report does not group by', () => {
    const d = analyse(workspace({
      fr2052a_variance: MONITOR.replace('grain: [product_id, entity_id]', 'grain: [product_id, segment]'),
    }));
    expect(withCode(d, 'KEEL092')[0].message).toContain('segment');
  });

  it('KEEL092 a scope on something the key does not carry', () => {
    // A scope naming a column outside the watched grain matches nothing, so the
    // threshold silently covers no rows at all.
    const d = analyse(workspace({
      fr2052a_variance: MONITOR.replace(
        "applies_to: product_id in ('O.D.1', 'O.D.2', 'O.D.3')",
        "applies_to: currency = 'USD'",
      ),
    }));
    expect(withCode(d, 'KEEL092').some((x) => x.message.includes('currency'))).toBe(true);
  });

  it('KEEL093 a threshold with no basis, and one with no limit', () => {
    expect(withCode(analyse(workspace({
      fr2052a_variance: MONITOR.replace('    basis: static_abs\n', ''),
    })), 'KEEL093').length).toBeGreaterThan(0);

    expect(withCode(analyse(workspace({
      fr2052a_variance: MONITOR.replace('    limit: 1000000\n', ''),
    })), 'KEEL093').length).toBeGreaterThan(0);

    expect(withCode(analyse(workspace({
      fr2052a_variance: MONITOR.replace('    sigma: 3.0\n', ''),
    })), 'KEEL093').length).toBeGreaterThan(0);
  });

  it('KEEL097 a limit every change exceeds', () => {
    const d = analyse(workspace({
      fr2052a_variance: MONITOR.replace('limit: 1000000', 'limit: 0'),
    }));
    expect(withCode(d, 'KEEL097')[0].message).toContain('every change exceeds');
  });

  it('KEEL095 a threshold that never fires', () => {
    // "No alerts" and "no coverage" look identical from outside, and only one is
    // good news.
    const d = analyse(workspace({
      fr2052a_variance: MONITOR.replace('limit: 1000000', 'limit: 900000000'),
    }));
    expect(withCode(d, 'KEEL095')[0].message).toContain('never fires');
  });

  it('KEEL096 a threshold nobody could read', () => {
    const d = analyse(workspace({
      fr2052a_variance: MONITOR.replace('limit: 1000000', 'limit: 1'),
    }));
    expect(withCode(d, 'KEEL096')[0].message).toContain('nobody reads');
  });

  it('KEEL099 a tier-2 threshold with no citation', () => {
    const d = analyse(workspace({
      fr2052a_variance: MONITOR.replace('    citation: Internal liquidity risk policy 4.2\n', ''),
    }));
    expect(withCode(d, 'KEEL099').length).toBeGreaterThan(0);
  });
});

describe('compiled monitor', () => {
  const sql = () => compileMonitor(monitorOf(), 'reg.fr2052a_daily', monitorOf().grain, 'sql');

  it('frames the window on the rows before today', () => {
    // The single most consequential character in this file. `CURRENT ROW` would
    // let a spike widen the band that judges it.
    expect(sql()).toContain('ROWS BETWEEN 30 PRECEDING AND 1 PRECEDING');
    expect(sql()).toContain('ROWS BETWEEN 60 PRECEDING AND 1 PRECEDING');
    expect(sql()).not.toContain('CURRENT ROW');
  });

  it('names the sample standard deviation explicitly', () => {
    // Population and sample σ differ by √(n/(n−1)) — enough to flip a marginal
    // breach, and engines default differently.
    expect(sql()).toContain('STDDEV_SAMP');
    expect(sql()).not.toContain('STDDEV_POP');
    expect(sql()).not.toMatch(/STDDEV\(/);
  });

  it('requires the same observation floor the evaluator does', () => {
    expect(sql()).toContain(`>= ${MIN_OBSERVATIONS}`);
    expect(sql()).toContain('> 0');
  });

  it('reads the filed table rather than recomputing the rollup', () => {
    // A variance alert that disagrees with the submission it is about is worse
    // than no alert.
    expect(sql()).toContain('FROM reg.fr2052a_daily');
    expect(sql()).not.toContain('fct_2052a_positions');
  });

  it('rounds the roll-up the same way the evaluator does', () => {
    expect(sql()).toContain('ROUND(SUM(weighted_outflows_30d), 2)');
  });

  it('guards a percentage against a zero base', () => {
    expect(sql()).toContain('NULLIF(ABS(prev_value), 0)');
  });

  it('emits every point when asked, and only breaches otherwise', () => {
    const all = compileMonitor(monitorOf(), 'reg.fr2052a_daily', monitorOf().grain, 'sql', { allRows: true });
    expect(sql()).toContain('WHERE breach_HARD_USD = 1');
    expect(all).not.toContain('WHERE breach_');
    expect(all).toContain('SELECT * FROM judged');
  });

  it('emits for Polars and PySpark with the same frame semantics', () => {
    const polars = compileMonitor(monitorOf(), 'reg.fr2052a_daily', monitorOf().grain, 'polars');
    expect(polars).toContain('.shift(1).rolling_std(window_size=30');
    expect(polars).toContain(`min_samples=${MIN_OBSERVATIONS}`);

    const spark = compileMonitor(monitorOf(), 'reg.fr2052a_daily', monitorOf().grain, 'pyspark');
    expect(spark).toContain('rowsBetween(-30, -1)');
    expect(spark).toContain('stddev_samp');
    expect(spark).not.toContain('rowsBetween(-30, 0)');
  });
});
