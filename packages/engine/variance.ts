/**
 * Day-over-day variance on the rollups the business rules produce, and the
 * thresholds that decide when a move is worth waking someone for.
 *
 * The classification layer answers *which bucket does this record belong to*.
 * The report answers *what are we filing*. Neither answers the question a
 * liquidity team actually asks every morning, which is **which of these numbers
 * moved more than it should have overnight** — and that question cannot be asked
 * of a single as-of date, because it is about a change.
 *
 * Three decisions here carry most of the weight.
 *
 * **The threshold is compared against the change, and the σ is the σ of past
 * changes.** Not of the levels. A balance series that trends has a large σ of
 * levels and a small σ of daily moves, so testing `|Δ| > k·σ(level)` fires
 * essentially never and reads as a working control. Testing `|Δ| > k·σ(Δ)` is
 * the actual statement "today's move is unusual for this series".
 *
 * **The trailing window excludes today.** A window that includes the current
 * observation lets an outlier inflate the very threshold it is being tested
 * against — the bigger the break, the wider the band, and the largest breaks are
 * the ones most likely to be missed. The window is the N days *before* today.
 *
 * **A σ from too few observations is not a threshold, and is not silently
 * treated as one.** Early in a series, or for a rollup that has only just
 * appeared, there is no dispersion to speak of; two observations give a σ that is
 * arbitrary and usually tiny, so every subsequent day breaches. Those points are
 * reported as `insufficient` rather than as passes or as breaches.
 *
 * Windows count *observations*, not calendar days. For a business-day series
 * "trailing 30 days" operationally means the last 30 points, and counting
 * observations is also the one definition that can be matched exactly by a SQL
 * `ROWS BETWEEN` frame — which is what lets the compiled plan and this evaluator
 * be held to the same numbers.
 */

import { compilePredicate } from './predicate';
import { DATES, type Row } from './fixtures';
import { sectionBlocks, type Graph, type Measure } from './parse';
import type { Registry } from './registry';
import { runReport } from './report';
import { asFiled } from './money';
import type { FixtureName, Severity } from './vocab';
import type { ReportSpec } from './compile';

// ---------------------------------------------------------------------------
// Specification
// ---------------------------------------------------------------------------

export type ThresholdBasis = 'static_abs' | 'static_pct' | 'stddev_30d' | 'stddev_60d';

export const THRESHOLD_BASES: ThresholdBasis[] = [
  'static_abs', 'static_pct', 'stddev_30d', 'stddev_60d',
];

/** How many trailing observations each dynamic basis looks at. */
export const BASIS_WINDOW: Record<string, number> = {
  stddev_30d: 30,
  stddev_60d: 60,
};

/**
 * Below this many trailing changes, a standard deviation is noise.
 *
 * Ten is a judgement call, stated rather than buried: with fewer, σ is dominated
 * by whichever two days happen to be in the window, and a threshold built on it
 * either never fires or fires constantly. Points with less history are reported
 * as having no threshold rather than as passing one.
 */
export const MIN_OBSERVATIONS = 10;

export interface ThresholdSpec {
  id: string;
  basis: ThresholdBasis;
  /** The limit for a static basis: dollars for `static_abs`, percent for `static_pct`. */
  limit: number;
  /** The multiplier for a dynamic basis. */
  sigma: number;
  severity: Severity;
  /** Optional predicate over the rollup key, so a rule can scope to some buckets. */
  appliesTo: string;
  citation: string;
  block: Measure;
}

export interface MonitorSpec {
  name: string;
  /** The report whose rollup is being watched. */
  report: string;
  /** Which of the report's measures. */
  measure: string;
  /** The level to watch at — a subset of the report's grouping. */
  grain: string[];
  thresholds: ThresholdSpec[];
}

function listItems(raw: string): string[] {
  return (raw || '').replace(/[[\]]/g, '').split(',').map((s) => s.trim()).filter(Boolean);
}

export function readMonitor(g: Graph): MonitorSpec {
  return {
    name: (g.view.name || g.docName || '').trim(),
    report: (g.view.report || '').trim(),
    measure: (g.view.measure || '').trim(),
    grain: listItems(g.view['watch.grain'] || g.view.grain || ''),
    thresholds: sectionBlocks(g, 'thresholds').map((b) => ({
      id: b.name,
      basis: (b.f.basis || '').trim() as ThresholdBasis,
      limit: parseFloat((b.f.limit || '').trim()),
      sigma: parseFloat((b.f.sigma || '').trim()),
      severity: ((b.f.severity || 'warn').trim() as Severity),
      appliesTo: (b.f.applies_to || '').trim(),
      citation: (b.f.citation || '').trim(),
      block: b,
    })),
  };
}

// ---------------------------------------------------------------------------
// Rollup series
// ---------------------------------------------------------------------------

export interface RollupSeries {
  key: string[];
  /** The measure's value per date, index-aligned with `DATES`. NaN where absent. */
  values: number[];
  /** Whether the rollup existed at all on each date. */
  present: boolean[];
}

/**
 * The filed measure, per rollup key, per day.
 *
 * This rolls up **what was filed**, rather than recomputing the measure from
 * positions at the watched grain. The distinction is not academic: each filed row
 * is quantized to the cent, so the sum of a hundred filed rows and the same
 * measure recomputed over the underlying positions differ by rounding. A monitor
 * that recomputes would raise alerts about a number nobody submitted, and would
 * disagree with the compiled plan — which reads the sink, because the sink is
 * what was filed.
 *
 * The whole derivation chain still runs once per date, because a day-over-day
 * comparison of a *classified* rollup has to compare what the rules said on each
 * of those days. Applying today's rules to both days would hide exactly what a
 * rule change does, which is move money between buckets.
 */
/**
 * The rolled-up series, cached.
 *
 * Building it runs the whole report once per day in the window — a few hundred
 * milliseconds — and the editing loop calls it on every keystroke. Nothing about
 * the *series* depends on the thresholds, though: tightening a limit or adding a
 * sigma re-judges points that are already computed. So the expensive half is
 * keyed on what it actually depends on and the cheap half runs freely, which is
 * the difference between a responsive editor and a sluggish one.
 *
 * A single entry is enough. The loop asks for the same series repeatedly while an
 * author edits one document; it does not interleave two.
 */
let seriesCache: { key: string; value: RollupSeries[] } | null = null;

function seriesKey(
  report: ReportSpec,
  view: Graph,
  fixture: FixtureName,
  measureName: string,
  grain: string[],
  dates: string[],
): string {
  return [
    fixture, measureName, grain.join(','), dates.length,
    report.view, report.grouping.join(','), report.measures.join(','),
    view.lines.join('\n'),
  ].join('\u001f');
}

export function rollupSeries(
  report: ReportSpec,
  view: Graph,
  registry: Registry,
  fixture: FixtureName,
  measureName: string,
  grain: string[],
  dates: string[] = DATES,
): RollupSeries[] {
  const key = seriesKey(report, view, fixture, measureName, grain, dates);
  if (seriesCache && seriesCache.key === key) return seriesCache.value;
  const computed = computeRollupSeries(report, view, registry, fixture, measureName, grain, dates);
  seriesCache = { key, value: computed };
  return computed;
}

function computeRollupSeries(
  report: ReportSpec,
  view: Graph,
  registry: Registry,
  fixture: FixtureName,
  measureName: string,
  grain: string[],
  dates: string[],
): RollupSeries[] {
  const byKey: Record<string, RollupSeries> = {};
  const order: string[] = [];
  // Where each watched key sits inside the report's own grouping.
  const positions = grain.map((c) => report.grouping.indexOf(c));

  dates.forEach((date, di) => {
    const filed = runReport(report, view, registry, fixture, date);

    const sums: Record<string, { key: string[]; total: number }> = {};
    filed.rows.forEach((row) => {
      const value = row.values[measureName];
      if (!Number.isFinite(value)) return;
      const key = positions.map((p, i) => (p >= 0 ? row.key[p] : grain[i]));
      const bucket = (sums[key.join('\u001f')] ||= { key, total: 0 });
      bucket.total += value;
    });

    Object.keys(sums).forEach((id) => {
      let series = byKey[id];
      if (!series) {
        series = byKey[id] = {
          key: sums[id].key,
          values: dates.map(() => NaN),
          present: dates.map(() => false),
        };
        order.push(id);
      }
      // Quantized again after the roll-up, matching `ROUND(SUM(...), 2)` in the
      // compiled plan. A sum of exact cents is still a float64 sum.
      series.values[di] = asFiled(sums[id].total, 'currency_usd');
      series.present[di] = true;
    });
  });

  return order.map((id) => byKey[id]);
}

// ---------------------------------------------------------------------------
// Variance
// ---------------------------------------------------------------------------

/** Sample standard deviation. NaN below two observations, where it is undefined. */
export function stddev(values: number[]): number {
  const w = values.filter((v) => Number.isFinite(v));
  if (w.length < 2) return NaN;
  const mean = w.reduce((a, b) => a + b, 0) / w.length;
  return Math.sqrt(w.reduce((a, v) => a + (v - mean) * (v - mean), 0) / (w.length - 1));
}

export interface Point {
  date: string;
  index: number;
  value: number;
  previous: number;
  /** Absolute change since the previous *observation*, whenever that was. */
  delta: number;
  /**
   * How many days back the compared observation is. 1 on a normal day.
   *
   * A rollup can be absent for a day — no position in that bucket was filed —
   * and the change on the day it returns is then measured across the gap. That
   * is deliberate: suppressing the comparison would silence a breach because a
   * bucket happened to be empty, which is exactly when a breach matters. The
   * distance is carried so the surface can say so rather than implying the move
   * happened overnight.
   */
  gapDays: number;
  /** Change as a percentage of the prior value. NaN when the prior value is zero. */
  deltaPct: number;
  /** σ of the trailing changes, per basis, excluding today. */
  sigma: Record<string, number>;
  /** How many trailing changes each σ was computed from. */
  observations: Record<string, number>;
  /** The rollup appeared for the first time on this date. */
  appeared: boolean;
  /** The rollup existed yesterday and does not today. */
  disappeared: boolean;
}

/**
 * Turn a level series into the day-over-day changes and their trailing
 * dispersion.
 *
 * A rollup that appears or disappears has no meaningful percentage change — a
 * product ID that did not exist yesterday has not moved, it has arrived — so
 * those points are flagged rather than assigned an infinite delta. They are
 * genuinely interesting on their own: a new product ID in a regulatory
 * submission is a reportable event, not a rounding difference.
 */
export function pointsOf(series: RollupSeries, dates: string[] = DATES): Point[] {
  const out: Point[] = [];
  const deltas: number[] = [];
  // The last date index on which this rollup was filed at all. `LAG` in the
  // compiled plan skips absent days the same way, and the two have to match or
  // the warehouse and the browser disagree about which mornings had a breach.
  let lastSeen = -1;

  for (let i = 0; i < dates.length; i++) {
    const value = series.values[i];
    const here = series.present[i];
    const before = lastSeen >= 0;
    const previous = before ? series.values[lastSeen] : NaN;
    const gapDays = here && before ? i - lastSeen : NaN;

    const delta = here && before ? value - previous : NaN;
    const deltaPct = Number.isFinite(delta) && previous !== 0 ? (delta / Math.abs(previous)) * 100 : NaN;

    // The window is the changes *before* this one. Including today would let an
    // outlier widen the band it is measured against.
    const sigma: Record<string, number> = {};
    const observations: Record<string, number> = {};
    Object.keys(BASIS_WINDOW).forEach((basis) => {
      const n = BASIS_WINDOW[basis];
      const window = deltas.slice(Math.max(0, deltas.length - n));
      const usable = window.filter((d) => Number.isFinite(d));
      observations[basis] = usable.length;
      sigma[basis] = usable.length >= MIN_OBSERVATIONS ? stddev(usable) : NaN;
    });

    out.push({
      date: dates[i],
      index: i,
      value,
      previous,
      delta,
      gapDays,
      deltaPct,
      sigma,
      observations,
      appeared: here && !before && i > 0,
      disappeared: !here && before && i === lastSeen + 1,
    });

    if (Number.isFinite(delta)) deltas.push(delta);
    if (here) lastSeen = i;
  }

  return out;
}

// ---------------------------------------------------------------------------
// Thresholds
// ---------------------------------------------------------------------------

export type Verdict = 'pass' | 'breach' | 'insufficient' | 'not_applicable';

export interface Evaluation {
  threshold: ThresholdSpec;
  verdict: Verdict;
  /** What the change was measured against — dollars or percent, per basis. */
  observed: number;
  /** The limit in force at this point. For a dynamic basis, k·σ. */
  limit: number;
  sigma: number;
  observations: number;
}

export function appliesToKey(threshold: ThresholdSpec, grain: string[], key: string[]): boolean {
  if (!threshold.appliesTo) return true;
  const pred = compilePredicate(threshold.appliesTo);
  if (pred.err) return false;
  const row: Record<string, string> = {};
  grain.forEach((g, i) => {
    row[g] = key[i];
  });
  return pred.fn(row as unknown as Row);
}

/**
 * Test one point against one threshold.
 *
 * `not_applicable` and `insufficient` are deliberately distinct from `pass`. A
 * control that could not run is not a control that ran and found nothing, and
 * collapsing the two is how a monitor comes to look green while covering
 * nothing — the failure mode this whole layer exists to make visible.
 */
export function evaluate(
  point: Point,
  threshold: ThresholdSpec,
  grain: string[],
  key: string[],
): Evaluation {
  const base = {
    threshold,
    observed: NaN,
    limit: NaN,
    sigma: NaN,
    observations: 0,
  };

  if (!appliesToKey(threshold, grain, key)) return { ...base, verdict: 'not_applicable' };
  if (!Number.isFinite(point.delta)) return { ...base, verdict: 'insufficient' };

  switch (threshold.basis) {
    case 'static_abs': {
      const observed = Math.abs(point.delta);
      if (!Number.isFinite(threshold.limit)) return { ...base, observed, verdict: 'insufficient' };
      return {
        ...base, observed, limit: threshold.limit,
        verdict: observed > threshold.limit ? 'breach' : 'pass',
      };
    }

    case 'static_pct': {
      const observed = Math.abs(point.deltaPct);
      // A percentage move off a zero base is not a large move, it is an
      // undefined one. Reporting it as a breach would fire on every rollup that
      // starts from nothing.
      if (!Number.isFinite(observed) || !Number.isFinite(threshold.limit)) {
        return { ...base, observed, verdict: 'insufficient' };
      }
      return {
        ...base, observed, limit: threshold.limit,
        verdict: observed > threshold.limit ? 'breach' : 'pass',
      };
    }

    case 'stddev_30d':
    case 'stddev_60d': {
      const observed = Math.abs(point.delta);
      const sigma = point.sigma[threshold.basis];
      const observations = point.observations[threshold.basis] || 0;
      if (!Number.isFinite(sigma) || observations < MIN_OBSERVATIONS) {
        return { ...base, observed, observations, verdict: 'insufficient' };
      }
      // A flat series has σ = 0, and any move at all is then infinitely many
      // standard deviations. That is arithmetically true and operationally
      // useless, so a zero σ is treated as no threshold rather than as one that
      // everything breaches.
      if (sigma === 0) {
        return { ...base, observed, sigma, observations, verdict: 'insufficient' };
      }
      const limit = threshold.sigma * sigma;
      return {
        ...base, observed, limit, sigma, observations,
        verdict: observed > limit ? 'breach' : 'pass',
      };
    }

    default:
      return { ...base, verdict: 'insufficient' };
  }
}

// ---------------------------------------------------------------------------
// Running a monitor
// ---------------------------------------------------------------------------

export interface Breach {
  key: string[];
  date: string;
  value: number;
  previous: number;
  delta: number;
  gapDays: number;
  deltaPct: number;
  evaluation: Evaluation;
}

export interface ThresholdStat {
  id: string;
  severity: Severity;
  basis: ThresholdBasis;
  breaches: number;
  passes: number;
  insufficient: number;
  notApplicable: number;
}

export interface MonitorResult {
  /** Rollup keys watched, at the declared grain. */
  keys: number;
  /** Key-days where a change could be computed at all. */
  evaluated: number;
  breaches: Breach[];
  /** Per threshold, how it behaved across every key-day. */
  stats: ThresholdStat[];
  /** Rollups that appeared mid-series — a new product ID is a reportable event. */
  appeared: Array<{ key: string[]; date: string; value: number }>;
  /** Rollups that stopped being filed. */
  disappeared: Array<{ key: string[]; date: string; previous: number }>;
  series: RollupSeries[];
  points: Point[][];
}

export function runMonitor(
  monitor: MonitorSpec,
  report: ReportSpec,
  view: Graph,
  registry: Registry,
  fixture: FixtureName,
  dates: string[] = DATES,
): MonitorResult {
  const grain = monitor.grain.length ? monitor.grain : report.grouping;
  const series = rollupSeries(report, view, registry, fixture, monitor.measure, grain, dates);

  const stats: Record<string, ThresholdStat> = {};
  monitor.thresholds.forEach((t) => {
    stats[t.id] = {
      id: t.id, severity: t.severity, basis: t.basis,
      breaches: 0, passes: 0, insufficient: 0, notApplicable: 0,
    };
  });

  const breaches: Breach[] = [];
  const appeared: MonitorResult['appeared'] = [];
  const disappeared: MonitorResult['disappeared'] = [];
  const points: Point[][] = [];
  let evaluated = 0;

  series.forEach((s) => {
    const ps = pointsOf(s, dates);
    points.push(ps);

    ps.forEach((p) => {
      if (p.appeared) appeared.push({ key: s.key, date: p.date, value: p.value });
      if (p.disappeared) disappeared.push({ key: s.key, date: p.date, previous: p.previous });
      if (Number.isFinite(p.delta)) evaluated++;

      monitor.thresholds.forEach((t) => {
        const ev = evaluate(p, t, grain, s.key);
        const stat = stats[t.id];
        if (ev.verdict === 'breach') {
          stat.breaches++;
          breaches.push({
            key: s.key, date: p.date, value: p.value, previous: p.previous,
            delta: p.delta, gapDays: p.gapDays, deltaPct: p.deltaPct, evaluation: ev,
          });
        } else if (ev.verdict === 'pass') stat.passes++;
        else if (ev.verdict === 'insufficient') stat.insufficient++;
        else stat.notApplicable++;
      });
    });
  });

  // Worst first, and within a severity the largest move — an author triaging a
  // morning's breaches wants the biggest error before the biggest warning.
  const rank: Record<Severity, number> = { error: 0, warn: 1, info: 2 };
  breaches.sort((a, b) => {
    const s = rank[a.evaluation.threshold.severity] - rank[b.evaluation.threshold.severity];
    if (s !== 0) return s;
    return Math.abs(b.delta) - Math.abs(a.delta);
  });

  return {
    keys: series.length,
    evaluated,
    breaches,
    stats: monitor.thresholds.map((t) => stats[t.id]),
    appeared,
    disappeared,
    series,
    points,
  };
}
