/**
 * Chart geometry helpers — pure, exported, and unit-tested, because "the line
 * is drawn in the right place" is checkable arithmetic and should be checked
 * as arithmetic, not by squinting at a screenshot.
 *
 * The y domain, its ticks and the x positions come from d3-scale (ADR-63).
 * ADR-8 chose to hand-render the *marks*, and that still holds — but it also
 * hand-rolled the *scale*, and the scale is where a chart lies: an extent cut
 * into equal steps put a gridline at 100.67% under a label reading "101%",
 * and an x built from the array index drew a three-day gap the same width as
 * a one-day one. d3-scale is arithmetic only — no React, no DOM, no CSS — so
 * every mark below is still an SVG element this package writes itself.
 */

import { scaleLinear, scaleUtc } from 'd3-scale';

export interface Extent {
  min: number;
  max: number;
}

/** Gridlines asked for between the bounds. d3 may return a couple more. */
const TICKS = 3;

/** `Math.min(...xs)` blows the stack on a long series; this does not. */
function bounds(values: number[]): [number, number] {
  let min = values[0];
  let max = values[0];
  for (const v of values) {
    if (v < min) min = v;
    if (v > max) max = v;
  }
  return [min, max];
}

/**
 * The y-extent of a chart, guide-aware: currency measures include zero
 * (a bar or an area cut off above zero exaggerates), ratios do not (an LCR
 * around 100% plotted from zero is a flat line that hides the story). That is
 * the "zero_baseline: per-guide" contract default, as arithmetic.
 *
 * The bounds are then *nice*: extended out to round numbers, so the ticks
 * drawn inside them are round too. That replaces the old flat 8% padding,
 * which bought headroom at the cost of an extent whose divisions landed
 * nowhere a reader could name. Zero survives nicing — it is already round —
 * so the currency rule above is not quietly undone by it.
 */
export function yExtent(values: number[], format: string): Extent {
  const finite = values.filter((v) => Number.isFinite(v));
  if (!finite.length) return { min: 0, max: 1 };
  let [min, max] = bounds(finite);
  if (format.startsWith('currency') && min > 0) min = 0;
  if (min === max) {
    const pad = Math.abs(min) * 0.1 || 1;
    min -= pad;
    max += pad;
  }
  const [lo, hi] = scaleLinear().domain([min, max]).nice(TICKS + 1).domain();
  return { min: lo, max: hi };
}

export const yPos = (v: number, e: Extent, height: number): number =>
  height - ((v - e.min) / (e.max - e.min)) * height;

/** Even spacing by position — for categories, and the fallback for undated series. */
export const xPos = (i: number, n: number, width: number): number =>
  n <= 1 ? width / 2 : (i / (n - 1)) * width;

/**
 * X positions proportional to elapsed time, which is the only honest spacing
 * for a series whose dates have gaps: `query.ts` returns the as-of dates that
 * exist, so a business-day series skips weekends, and spacing those by array
 * index draws a Friday-to-Monday move as though it happened overnight.
 *
 * `domain` is the set of dates the axis should span — pass every series and
 * band on the chart, so they all share one axis instead of each stretching to
 * fill the width. Unparseable or single-valued dates fall back to even
 * spacing: no worse than what it replaces, and never a NaN in a path.
 *
 * UTC, not local: an as-of date is a calendar day, and reading it in a zone
 * with DST would move some points by an hour relative to others.
 */
export function xPositions(
  dates: readonly string[],
  width: number,
  domain: readonly string[] = dates,
): number[] {
  const even = (): number[] => dates.map((_, i) => xPos(i, dates.length, width));
  const at = dates.map((d) => Date.parse(d));
  if (at.some((t) => !Number.isFinite(t))) return even();
  const span = domain.map((d) => Date.parse(d)).filter((t) => Number.isFinite(t));
  if (span.length < 2) return even();
  const [lo, hi] = bounds(span);
  if (lo === hi) return even();
  const s = scaleUtc().domain([new Date(lo), new Date(hi)]).range([0, width]);
  return at.map((t) => s(new Date(t)));
}

/**
 * An SVG polyline through a series, NaNs breaking the line rather than lying.
 * `xs` carries the x of each point when the caller has a time axis; without
 * it the points are spaced evenly.
 */
export function linePath(
  values: number[],
  e: Extent,
  width: number,
  height: number,
  xs?: readonly number[],
): string {
  let d = '';
  let pen = false;
  values.forEach((v, i) => {
    if (!Number.isFinite(v)) {
      pen = false;
      return;
    }
    const x = (xs?.[i] ?? xPos(i, values.length, width)).toFixed(2);
    const y = yPos(v, e, height).toFixed(2);
    d += `${pen ? 'L' : 'M'}${x},${y}`;
    pen = true;
  });
  return d;
}

/**
 * Round gridline values inside the extent. Round is the whole point: these
 * are drawn *and labelled*, and `formatTick` has to be able to say where the
 * line is without rounding it somewhere else.
 */
export function ticks(e: Extent, count = TICKS): number[] {
  return scaleLinear().domain([e.min, e.max]).ticks(count);
}

/**
 * Sort grouped rows for a bar chart: by value descending unless the dimension
 * is ordinal, in which case the incoming (ladder) order *is* the order.
 * BAR-02's runtime half — the linter checks the declaration, this applies it.
 */
export function barOrder<T extends { value: number }>(rows: T[], sort: 'value' | 'dim'): T[] {
  return sort === 'dim' ? rows.slice() : rows.slice().sort((a, b) => b.value - a.value);
}
