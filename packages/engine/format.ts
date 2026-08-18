/**
 * Number formatting. Sign sits outside the currency symbol (`-$41,222,870`),
 * units are always shown, and nothing is ever rendered raw.
 */

export function fmt(v: number | null | undefined, format?: string): string {
  if (v === null || v === undefined || isNaN(v)) return '—';
  if (format === 'percent_1dp') return `${v.toFixed(1)}%`;
  if (format === 'percent_2dp') return `${v.toFixed(2)}%`;
  if (format === 'currency_usd_mm') return `${v < 0 ? '-$' : '$'}${Math.abs(v / 1e6).toFixed(1)}M`;
  if (format === 'bps') {
    return `${v < 0 ? '-' : ''}${Math.round(Math.abs(v) * 100).toLocaleString('en-US')} bps`;
  }
  if (format === 'number') return Math.round(v).toLocaleString('en-US');
  return `${v < 0 ? '-$' : '$'}${Math.round(Math.abs(v)).toLocaleString('en-US')}`;
}

/** `3 errors` / `1 error` — counts read as prose, not as `1 error(s)`. */
export function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

/** Levenshtein, for "did you mean" suggestions. */
export function lev(a: string, b: string): number {
  const m: number[][] = [];
  for (let i = 0; i <= b.length; i++) {
    m[i] = [i];
    for (let j = 1; j <= a.length; j++) {
      m[i][j] = i === 0
        ? j
        : Math.min(
            m[i - 1][j] + 1,
            m[i][j - 1] + 1,
            m[i - 1][j - 1] + (b.charAt(i - 1) === a.charAt(j - 1) ? 0 : 1),
          );
    }
  }
  return m[b.length][a.length];
}
