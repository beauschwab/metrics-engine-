/**
 * Conditional formatting's arithmetic: how far a value sits along its
 * column's range, 0..1, for a heatmap cell. Notional is log-uniform across
 * three orders of magnitude, so a linear ramp would light the top decile
 * and leave the rest dark; the ramp is logarithmic when the range is
 * strictly positive and linear otherwise. The colour itself is the theme's
 * — the cell mixes a data hue by this fraction (ADR-48, ADR-68). Not the
 * accent: the accent is selection, focus and the brand, and a selected
 * block over amber heat read as amber on amber.
 */

export function heatIntensity(value: unknown, range: [number, number] | undefined): number | undefined {
  if (!range || typeof value !== 'number' || !Number.isFinite(value)) return undefined;
  const [min, max] = range;
  if (!(max > min)) return undefined;
  const t = min > 0 && value > 0
    ? (Math.log(value) - Math.log(min)) / (Math.log(max) - Math.log(min))
    : (value - min) / (max - min);
  return Math.min(1, Math.max(0, t));
}

/** The strongest mix a heatmap cell takes, in percent of the data hue. */
export const HEAT_MAX_PERCENT = 38;

export function heatBackground(intensity: number | undefined): string | undefined {
  if (intensity === undefined) return undefined;
  const pct = Math.round(intensity * HEAT_MAX_PERCENT * 10) / 10;
  return pct <= 0 ? undefined : `color-mix(in oklab, var(--cr-s1) ${pct}%, transparent)`;
}
