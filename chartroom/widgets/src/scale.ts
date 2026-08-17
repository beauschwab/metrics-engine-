/**
 * Chart geometry helpers — pure, exported, and unit-tested, because "the line
 * is drawn in the right place" is checkable arithmetic and should be checked
 * as arithmetic, not by squinting at a screenshot.
 */

export interface Extent {
  min: number;
  max: number;
}

/**
 * The y-extent of a chart, guide-aware: currency measures include zero
 * (a bar or an area cut off above zero exaggerates), ratios do not (an LCR
 * around 100% plotted from zero is a flat line that hides the story). That is
 * the "zero_baseline: per-guide" contract default, as arithmetic.
 */
export function yExtent(values: number[], format: string): Extent {
  const finite = values.filter((v) => Number.isFinite(v));
  if (!finite.length) return { min: 0, max: 1 };
  let min = Math.min(...finite);
  let max = Math.max(...finite);
  if (format.startsWith('currency') && min > 0) min = 0;
  if (min === max) {
    const pad = Math.abs(min) * 0.1 || 1;
    return { min: min - pad, max: max + pad };
  }
  const pad = (max - min) * 0.08;
  return { min: min === 0 ? 0 : min - pad, max: max + pad };
}

export const yPos = (v: number, e: Extent, height: number): number =>
  height - ((v - e.min) / (e.max - e.min)) * height;

export const xPos = (i: number, n: number, width: number): number =>
  n <= 1 ? width / 2 : (i / (n - 1)) * width;

/** An SVG polyline through a series, NaNs breaking the line rather than lying. */
export function linePath(values: number[], e: Extent, width: number, height: number): string {
  let d = '';
  let pen = false;
  values.forEach((v, i) => {
    if (!Number.isFinite(v)) {
      pen = false;
      return;
    }
    const x = xPos(i, values.length, width).toFixed(2);
    const y = yPos(v, e, height).toFixed(2);
    d += `${pen ? 'L' : 'M'}${x},${y}`;
    pen = true;
  });
  return d;
}

/** Three round-ish horizontal gridlines between min and max. */
export function ticks(e: Extent, count = 3): number[] {
  const step = (e.max - e.min) / (count + 1);
  return Array.from({ length: count }, (_, i) => e.min + step * (i + 1));
}

/**
 * Sort grouped rows for a bar chart: by value descending unless the dimension
 * is ordinal, in which case the incoming (ladder) order *is* the order.
 * BAR-02's runtime half — the linter checks the declaration, this applies it.
 */
export function barOrder<T extends { value: number }>(rows: T[], sort: 'value' | 'dim'): T[] {
  return sort === 'dim' ? rows.slice() : rows.slice().sort((a, b) => b.value - a.value);
}
