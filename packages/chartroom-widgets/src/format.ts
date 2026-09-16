/**
 * Value formatting — deliberately the engine's `fmt` semantics, restated here
 * because widgets may not import the engine (boundaries). The golden test
 * pins this copy to the same outputs, so if the engine's formatting ever
 * changes, one failing test says both must move together.
 *
 * `decimals` is the spec's constrained override (NUM-01: contract ±1); it
 * adjusts percent precision only — currency and counts have exact renderings.
 */

export function formatValue(v: number | null | undefined, format: string, decimals?: number): string {
  if (v === null || v === undefined || Number.isNaN(v)) return '—';
  const pct = /^percent_(\d)dp$/.exec(format);
  if (pct) {
    const d = decimals ?? Number(pct[1]);
    return `${v.toFixed(d)}%`;
  }
  if (format === 'currency_usd_mm') return `${v < 0 ? '-$' : '$'}${Math.abs(v / 1e6).toFixed(1)}M`;
  if (format === 'bps') {
    return `${v < 0 ? '-' : ''}${Math.round(Math.abs(v) * 100).toLocaleString('en-US')} bps`;
  }
  if (format === 'number') return Math.round(v).toLocaleString('en-US');
  return `${v < 0 ? '-$' : '$'}${Math.round(Math.abs(v)).toLocaleString('en-US')}`;
}

/**
 * The fewest decimals that still say the number exactly, capped so a float's
 * last bit of noise does not become three digits of false precision.
 */
function decimalsFor(x: number, max = 3): number {
  for (let d = 0; d < max; d++) if (Number(x.toFixed(d)) === x) return d;
  return max;
}

/** The number at its own precision — no more digits, and no fewer. */
function exact(x: number): string {
  const d = decimalsFor(x);
  return x.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
}

/**
 * Compact axis labels: $1.25B, $840M, 100% — a tick is a landmark, but a
 * landmark has to be where it says it is.
 *
 * Precision is chosen per value rather than fixed, because a fixed one lies:
 * `toFixed(0)` labelled a gridline drawn at 100.67% as "101%", and rounded a
 * $1.25B tick to "$1.3B". A reader lining a series up against a gridline is
 * measuring against the label, so the label is what has to be true. Ticks off
 * a nice domain are round anyway, so this stays short in the case that
 * matters and only grows digits when the value genuinely has them.
 */
export function formatTick(v: number, format: string): string {
  if (format.startsWith('percent')) return `${exact(v)}%`;
  if (format.startsWith('currency')) {
    const a = Math.abs(v);
    const sign = v < 0 ? '-$' : '$';
    if (a >= 1e9) return `${sign}${exact(a / 1e9)}B`;
    if (a >= 1e6) return `${sign}${exact(a / 1e6)}M`;
    if (a >= 1e3) return `${sign}${exact(a / 1e3)}K`;
    return `${sign}${exact(a)}`;
  }
  return exact(v);
}

/** The day-over-day move, said the way the surface says it. */
export function formatDelta(value: number, prior: number, format: string): string {
  const d = value - prior;
  const sign = d > 0 ? '+' : '';
  if (format.startsWith('percent')) return `${sign}${d.toFixed(1)}pp`;
  return `${sign}${formatValue(d, format)}`.replace('+-', '-');
}

/** MM-DD — sixty daily points do not need their year repeated sixty times. */
export function formatDate(iso: string): string {
  return iso.slice(5);
}
