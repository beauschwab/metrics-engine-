/**
 * Trends in the grid (ADR-89): a measure's recent history drawn beside its
 * value, in the style a reader chose from the column's format menu.
 *
 * The marks are `chartroom-widgets/spark`'s — the same scene the sparkline
 * cards draw — so a row's trend and a card's trend over the same history
 * cannot disagree. What the grid adds is the reading: numbers said through
 * the column's own meta (its unit, decimals, scale, negatives), because a
 * tooltip that read "$1.2M" beside a cell reading "$1.24M" would be two
 * answers to one question.
 */

import type { SeriesPoint, SparkFormatter, SparkStyle } from 'chartroom-widgets/spark';
import { formatValue, type ColumnMeta } from './meta';

/** The trend's box in a cell: wide enough for thirty days, as tall as a compact row allows. */
export const TREND_SIZE = { width: 64, height: 18 } as const;

/**
 * Where a host's histories come from: one series per row and column, by the
 * row's id. `undefined` draws no trend — the cell still says its number.
 */
export type GridHistory = (rowId: string, columnId: string) => readonly SeriesPoint[] | undefined;

/** The trend a column draws, if any: chosen, declared, and — for a band — governed. */
export function trendOf(meta: ColumnMeta | undefined): SparkStyle | undefined {
  if (!meta?.history || !meta.trend) return undefined;
  if (meta.trend === 'band' && !meta.limit) return undefined;
  return meta.trend;
}

/** The column's own readings for the trend's words: a value as the cell says it, a move in the same unit. */
export function trendReadings(meta: ColumnMeta): SparkFormatter {
  const plain: ColumnMeta = { ...meta, negatives: 'minus' };
  return {
    value: (v) => formatValue(v, meta),
    delta: (v, from) => {
      const d = v - from;
      const sign = d > 0 ? '+' : '';
      // A move in a percent is in points, not in percent of a percent.
      if (meta.unit === 'pct') return `${sign}${d.toFixed(meta.dp ?? 2)}pp`;
      return `${sign}${formatValue(d, plain)}`;
    },
  };
}
