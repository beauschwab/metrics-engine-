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

/** Compact axis labels: $1.2B, $840M, 98% — a tick is a landmark, not a figure. */
export function formatTick(v: number, format: string): string {
  if (format.startsWith('percent')) return `${v.toFixed(0)}%`;
  if (format.startsWith('currency')) {
    const a = Math.abs(v);
    const sign = v < 0 ? '-$' : '$';
    if (a >= 1e9) return `${sign}${(a / 1e9).toFixed(1)}B`;
    if (a >= 1e6) return `${sign}${(a / 1e6).toFixed(0)}M`;
    if (a >= 1e3) return `${sign}${(a / 1e3).toFixed(0)}K`;
    return `${sign}${a.toFixed(0)}`;
  }
  return v.toLocaleString('en-US', { maximumFractionDigits: 1 });
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
