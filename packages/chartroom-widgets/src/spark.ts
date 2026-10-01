/**
 * Sparklines (ADR-89) — the geometry and the words, React-free.
 *
 * A sparkline is a trend read at a glance: no axes, no gridlines, no labels
 * on the points. What it owes the reader instead is a tooltip that says
 * exactly what the pointer is on — the date first, then the value, then
 * what the value means against the window or the limit — and the same
 * reading from the keyboard. Four styles, one per question:
 *
 *  - `line`   — where is it heading? A line, the current point accented.
 *  - `band`   — is it on the right side of its limit? The line against a
 *               governed limit, the breach side shaded, breaching points
 *               marked in the status colour *and* named in words.
 *  - `column` — how big was each day? Columns from zero, so a move is a
 *               length — the right reading for a daily change.
 *  - `range`  — where does today sit in its own history? Every day as a
 *               tick along the window's low-to-high, today's emphasised.
 *
 * Two renderers draw these marks — the card widgets here and the grid's
 * trend cell (`spec ← widgets/spark ← grid`) — and both draw *these* marks,
 * from this module, so a row in a table and a card on a board can never
 * disagree about the same history. It is a subpath of its own because the
 * grid may import the widgets' React-free parts only (boundaries).
 */

import { scaleLinear } from 'd3-scale';
import type { SeriesPoint } from './types';

export type { SeriesPoint };
import { formatDate, formatDelta, formatTick, formatValue } from './format';
import { xPositions, yPos, type Extent } from './scale';

export type SparkStyle = 'line' | 'band' | 'column' | 'range';
export const SPARK_STYLES: readonly SparkStyle[] = ['line', 'band', 'column', 'range'];
export const SPARK_LABELS: Record<SparkStyle, string> = {
  line: 'Line', band: 'Against limit', column: 'Columns', range: 'Range strip',
};

/**
 * A governed limit and its safe side. Never a typed number: the card reads it
 * from a `compare` bound to a registry metric (GAUGE-01), the grid from a
 * column's declared meta. A floor must be stayed above, a ceiling below.
 */
export interface SparkLimit {
  value: number;
  side: 'floor' | 'ceiling';
  label: string;
}

/** Whether a value sits on the wrong side of its limit. On the line is not a breach. */
export const breaches = (value: number, limit: SparkLimit): boolean =>
  limit.side === 'floor' ? value < limit.value : value > limit.value;

/** One point the pointer (or the keyboard) can land on. */
export interface SparkMark {
  /** Index into the series as given. */
  i: number;
  x: number;
  y: number;
  date: string;
  value: number;
  breach: boolean;
}

export interface SparkColumn {
  i: number;
  x: number;
  y: number;
  w: number;
  h: number;
  negative: boolean;
}

export interface SparkScene {
  style: SparkStyle;
  width: number;
  height: number;
  /** Hover targets, in date order, finite values only. */
  marks: SparkMark[];
  /** The current point: the last finite one. */
  last: SparkMark | null;
  /** `line`, `band`: the path; NaNs break it rather than bridge it. */
  line?: string;
  /** `column`: one bar per point, from the zero line. */
  columns?: SparkColumn[];
  /** `column`: where zero is. */
  baseline?: number;
  /** `band`: the limit line, and the rectangle on its breach side — when the limit is within reach. */
  limit?: { y: number; zone: { y: number; h: number } };
  /**
   * `band`: the limit is too far from the window to draw without flattening
   * it, and which side it lies off. The words still say the side of the
   * limit and every breach; only the line and the shading are left out.
   */
  limitOff?: 'above' | 'below';
  /** `range`: the track from the window's low to its high. */
  strip?: { x0: number; x1: number; y: number };
}

export interface SparkOptions {
  width: number;
  height: number;
  /** Required for `band`; ignored by the others. */
  limit?: SparkLimit;
  /** Inset so the end dot and its halo are not clipped. */
  pad?: number;
}

/**
 * The y-extent of a sparkline: the data's own low and high, not nice round
 * bounds — there is no axis to label, and nicing would spend a 24px-tall
 * chart's height on empty margin. A limit joins the extent (a band chart
 * whose limit is off-screen says nothing), and columns join zero (a bar's
 * length is its value only if it starts at zero).
 */
export function sparkExtent(values: readonly number[], extra: readonly number[] = []): Extent {
  const all = [...values, ...extra].filter((v) => Number.isFinite(v));
  if (!all.length) return { min: 0, max: 1 };
  let min = all[0];
  let max = all[0];
  for (const v of all) {
    if (v < min) min = v;
    if (v > max) max = v;
  }
  if (min === max) {
    const pad = Math.abs(min) * 0.1 || 1;
    return { min: min - pad, max: max + pad };
  }
  return { min, max };
}

/**
 * Whether a limit is close enough to the window to share its scale: within
 * one and a half of the window's own spans of the nearest value. A trade a
 * hundred times inside its limit would otherwise draw a flat line pressed
 * against one edge — every day's shape spent to show a distance the words
 * can say ("below ceiling … $250,000") without costing the shape.
 */
export function limitInReach(values: readonly number[], limit: number): boolean {
  const finite = values.filter((v) => Number.isFinite(v));
  if (!finite.length) return true;
  let min = finite[0];
  let max = finite[0];
  for (const v of finite) {
    if (v < min) min = v;
    if (v > max) max = v;
  }
  if (limit >= min && limit <= max) return true;
  const span = max - min || Math.abs(max) * 0.1 || 1;
  return Math.min(Math.abs(limit - min), Math.abs(limit - max)) <= span * 1.5;
}

/** The scene for one series in one style: every mark in pixels, nothing drawn. */
export function sparkScene(points: readonly SeriesPoint[], style: SparkStyle, opts: SparkOptions): SparkScene {
  const { width, height } = opts;
  const pad = opts.pad ?? 3;
  const iw = Math.max(1, width - 2 * pad);
  const ih = Math.max(1, height - 2 * pad);
  const limit = style === 'band' ? opts.limit : undefined;
  const values = points.map((p) => p.value);
  const finite = (i: number) => Number.isFinite(values[i]);
  const scene: SparkScene = { style, width, height, marks: [], last: null };
  if (!points.length) return scene;

  if (style === 'range') {
    const e = sparkExtent(values);
    const x = scaleLinear().domain([e.min, e.max]).range([pad, pad + iw]);
    const y = pad + ih / 2;
    scene.strip = { x0: pad, x1: pad + iw, y };
    scene.marks = points.flatMap((p, i) => (finite(i) ? [{ i, x: x(p.value), y, date: p.date, value: p.value, breach: false }] : []));
  } else if (style === 'column') {
    const e = sparkExtent(values, [0]);
    const n = points.length;
    // A bar per point, centred on its date; the gap between bars is a third
    // of a slot, so thirty days read as thirty bars and not as an area.
    const bw = Math.max(1, (iw / n) * 0.66);
    const xs = xPositions(points.map((p) => p.date), iw - bw).map((v) => v + pad + bw / 2);
    const zero = pad + yPos(0, e, ih);
    scene.baseline = zero;
    scene.columns = points.flatMap((p, i) => {
      if (!finite(i)) return [];
      const top = pad + yPos(p.value, e, ih);
      // A zero day still draws a hairline, so a gap means "no value", not "nothing moved".
      const h = Math.max(1, Math.abs(zero - top));
      return [{ i, x: xs[i] - bw / 2, y: p.value >= 0 ? zero - h : zero, w: bw, h, negative: p.value < 0 }];
    });
    scene.marks = points.flatMap((p, i) => (finite(i) ? [{ i, x: xs[i], y: pad + yPos(p.value, e, ih), date: p.date, value: p.value, breach: false }] : []));
  } else {
    const reach = limit ? limitInReach(values, limit.value) : false;
    if (limit && !reach) scene.limitOff = limit.value > Math.max(...values.filter((v) => Number.isFinite(v))) ? 'above' : 'below';
    const e = sparkExtent(values, limit && reach ? [limit.value] : []);
    const xs = xPositions(points.map((p) => p.date), iw).map((v) => v + pad);
    const at = (v: number) => pad + yPos(v, e, ih);
    // NaNs lift the pen rather than bridge the gap — a missing day is not a straight line.
    let pen = false;
    scene.line = values.reduce((d, v, i) => {
      if (!finite(i)) { pen = false; return d; }
      const seg = `${pen ? 'L' : 'M'}${xs[i].toFixed(2)},${at(v).toFixed(2)}`;
      pen = true;
      return d + seg;
    }, '');
    scene.marks = points.flatMap((p, i) => (finite(i) ? [{
      i, x: xs[i], y: at(p.value), date: p.date, value: p.value, breach: !!limit && breaches(p.value, limit),
    }] : []));
    if (limit && reach) {
      const ly = at(limit.value);
      // The breach side: below a floor, above a ceiling — to the chart's edge.
      scene.limit = {
        y: ly,
        zone: limit.side === 'floor' ? { y: ly, h: Math.max(0, height - ly) } : { y: 0, h: Math.max(0, ly) },
      };
    }
  }
  scene.last = scene.marks.reduce<SparkMark | null>((acc, m) => (!acc || m.i > acc.i ? m : acc), null);
  return scene;
}

/**
 * The mark nearest the pointer, along x — the crosshair snaps to a real
 * point and never interpolates between two days. Ties go to the later
 * point, which is the one a reader scanning right-to-left from "now" meant.
 */
export function nearestMark(marks: readonly SparkMark[], x: number): SparkMark | null {
  let best: SparkMark | null = null;
  let gap = Infinity;
  for (const m of marks) {
    const d = Math.abs(m.x - x);
    if (d < gap || (d === gap && best && m.i > best.i)) { best = m; gap = d; }
  }
  return best;
}

/** The next mark in date order, for the arrow keys: −1 back, +1 forward, clamped. */
export function stepMark(marks: readonly SparkMark[], from: SparkMark | null, dir: -1 | 1): SparkMark | null {
  if (!marks.length) return null;
  const byDate = [...marks].sort((a, b) => a.i - b.i);
  if (!from) return dir < 0 ? byDate[byDate.length - 1] : byDate[0];
  const at = byDate.findIndex((m) => m.i === from.i);
  return byDate[Math.min(byDate.length - 1, Math.max(0, at + dir))];
}

/** The window's facts, said once and read by the tooltip, the card and the grid's copy. */
export interface SparkStats {
  n: number;
  first: SeriesPoint | null;
  last: SeriesPoint | null;
  low: SeriesPoint | null;
  high: SeriesPoint | null;
}

export function sparkStats(points: readonly SeriesPoint[]): SparkStats {
  const finite = points.filter((p) => Number.isFinite(p.value));
  let low: SeriesPoint | null = null;
  let high: SeriesPoint | null = null;
  for (const p of finite) {
    if (!low || p.value < low.value) low = p;
    if (!high || p.value > high.value) high = p;
  }
  return { n: finite.length, first: finite[0] ?? null, last: finite[finite.length - 1] ?? null, low, high };
}

/** Where a value sits in the window's range, 0 at the low and 100 at the high. */
export function rangePosition(value: number, stats: SparkStats): number | null {
  if (!stats.low || !stats.high) return null;
  const span = stats.high.value - stats.low.value;
  if (span === 0) return 50;
  return Math.round(((value - stats.low.value) / span) * 100);
}

/**
 * How a sparkline says a number: a catalog format name (`percent_1dp`,
 * `currency_usd`, …), or a host's own readings — the grid formats through
 * its column meta, whose units are not the catalog's (ADR-74), and a trend
 * in a row must read exactly as the cell beside it.
 */
export interface SparkFormatter {
  value(v: number): string;
  /** The move from `from` to `v`, signed. */
  delta(v: number, from: number): string;
  /** A landmark inside a sentence — a low, a high; defaults to `value`. */
  brief?(v: number): string;
}
export type SparkFormat = string | SparkFormatter;

/**
 * The catalog's readings. A landmark is said briefly — dollars at their
 * scale ($41.195B), everything else as the value reads; the point under the
 * pointer is always said in full, and only the numbers that place it are short.
 */
function readings(format: SparkFormat, decimals?: number): Required<SparkFormatter> {
  if (typeof format !== 'string') return { brief: format.value, ...format } as Required<SparkFormatter>;
  return {
    value: (v) => formatValue(v, format, decimals),
    delta: (v, from) => formatDelta(v, from, format),
    brief: (v) => (format.startsWith('currency') ? formatTick(v, format) : formatValue(v, format, decimals)),
  };
}

/** What the tooltip says about one point: the date, the value, and one line of meaning. */
export interface SparkTip {
  date: string;
  value: string;
  note?: string;
  /** `breach` paints the note in the status colour — the words carry it too. */
  state?: 'breach' | 'ok';
}

/**
 * The tooltip's words for a mark. The note is what each style is *for*:
 * the move since the window opened (line), the side of the limit (band),
 * the move from the day before (column), the place in the range (range).
 */
export function sparkTip(
  points: readonly SeriesPoint[],
  mark: SparkMark,
  style: SparkStyle,
  format: SparkFormat,
  opts: { decimals?: number; limit?: SparkLimit } = {},
): SparkTip {
  const f = readings(format, opts.decimals);
  const stats = sparkStats(points);
  const tip: SparkTip = { date: mark.date, value: f.value(mark.value) };
  if (style === 'band' && opts.limit) {
    const { limit } = opts;
    const breach = breaches(mark.value, limit);
    const side = mark.value < limit.value ? 'below' : mark.value > limit.value ? 'above' : 'at';
    tip.note = `${side} ${limit.side} ${limit.label} ${f.value(limit.value)}${breach ? ' — breach' : ''}`;
    tip.state = breach ? 'breach' : 'ok';
  } else if (style === 'column') {
    const prior = [...points.slice(0, mark.i)].reverse().find((p) => Number.isFinite(p.value));
    if (prior) tip.note = `${f.delta(mark.value, prior.value)} vs ${formatDate(prior.date)}`;
  } else if (style === 'range') {
    const pos = rangePosition(mark.value, stats);
    if (stats.low && stats.high && pos !== null) {
      tip.note = mark.value === stats.high.value ? `the window's high`
        : mark.value === stats.low.value ? `the window's low`
          : `${pos}% of the way from low ${f.brief(stats.low.value)} to high ${f.brief(stats.high.value)}`;
    }
  } else if (stats.first && mark.i > 0) {
    tip.note = `${f.delta(mark.value, stats.first.value)} since ${formatDate(stats.first.date)}`;
  }
  return tip;
}

/**
 * The card's judgment line — the window said in words, so the chart is
 * never the only carrier of its meaning (and a reader without the pointer
 * still gets it).
 */
export function sparkJudgment(
  points: readonly SeriesPoint[],
  style: SparkStyle,
  format: SparkFormat,
  opts: { decimals?: number; limit?: SparkLimit } = {},
): { text: string; state: 'up' | 'down' | 'flat' | 'ok' | 'breach' } | null {
  const f = readings(format, opts.decimals);
  const stats = sparkStats(points);
  if (!stats.first || !stats.last) return null;
  const since = formatDate(stats.first.date);
  if (style === 'band' && opts.limit) {
    const { limit } = opts;
    const breach = breaches(stats.last.value, limit);
    const count = points.filter((p) => Number.isFinite(p.value) && breaches(p.value, limit)).length;
    const side = stats.last.value < limit.value ? 'below' : stats.last.value > limit.value ? 'above' : 'at';
    return {
      text: `${side} ${limit.side} ${f.value(limit.value)} · `
        + `${count === 0 ? 'no breaches' : count === 1 ? '1 breach' : `${count} breaches`} since ${since}`,
      state: breach ? 'breach' : 'ok',
    };
  }
  if (style === 'range') {
    const pos = rangePosition(stats.last.value, stats);
    if (pos === null || !stats.low || !stats.high) return null;
    return {
      text: `${pos}% of its range since ${since} · low ${f.brief(stats.low.value)}, high ${f.brief(stats.high.value)}`,
      state: 'flat',
    };
  }
  const d = stats.last.value - stats.first.value;
  return {
    text: `${f.delta(stats.last.value, stats.first.value)} since ${since}`,
    state: d > 0 ? 'up' : d < 0 ? 'down' : 'flat',
  };
}

/**
 * The whole window in one sentence: the accessible name of the chart, and
 * what the grid copies for a trend cell's hover. Low and high name their
 * dates, because "the low was 98%" invites "when?".
 */
export function sparkSummary(points: readonly SeriesPoint[], format: SparkFormat, decimals?: number): string {
  const s = sparkStats(points);
  if (!s.first || !s.last || !s.low || !s.high) return 'no points in the window';
  const v = readings(format, decimals).value;
  return `${s.n} points, ${formatDate(s.first.date)} to ${formatDate(s.last.date)}: `
    + `latest ${v(s.last.value)}, low ${v(s.low.value)} on ${formatDate(s.low.date)}, `
    + `high ${v(s.high.value)} on ${formatDate(s.high.date)}`;
}
