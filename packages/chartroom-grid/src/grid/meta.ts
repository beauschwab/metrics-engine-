/**
 * Column meta — the one place a column says what it is.
 *
 * Formatting, groupability, aggregation, conditional formatting and export
 * all read from here. There is no per-feature column list anywhere in the
 * grid: a feature that needs to know something about a column asks its meta,
 * and a column that wants a behaviour declares it once. This is the grid's
 * version of the widget contract — the seam the later phases plug into
 * without touching each other.
 *
 * `formatValue` is likewise the one formatter: cells, footers, tooltips and
 * the xlsx export all render a number through it, so a subtotal can never
 * read differently from the cells it sums. Where a unit already has a
 * rendering in the widget catalog (`currency_usd`, `currency_usd_mm`,
 * `percent_Ndp`) it delegates to the catalog's `formatValue` rather than
 * restating it — the committee deck formats through that same function
 * (ADR-29), and a treasury grid that said $4.1M where the deck said $4.12M
 * would be the kind of disagreement this product exists to remove.
 */

import { formatValue as catalogFormat } from 'chartroom-widgets/format';

export type Unit = 'ccy' | 'mm' | 'bps' | 'pct' | 'years' | 'date';
export type Agg = 'sum' | 'wavg' | 'min' | 'max' | 'count';

export interface ColumnMeta {
  /** The header label — what a reader calls the column. */
  label: string;
  /** A dimension is grouped and filtered by; a measure is aggregated. */
  kind: 'dimension' | 'measure';
  /**
   * The unit the *stored* value is in. Note that this differs from the
   * catalog's `bps` *format*, which converts a percent to basis points at
   * render: a grid column whose unit is `bps` holds basis points already.
   * When the grid binds to a registry metric (Phase 4+) meta is derived from
   * the contract's `format`, and that mapping is where the two vocabularies
   * meet — TODO(grid-phase-4).
   */
  unit?: Unit;
  /** Decimal places, where the unit does not fix them. */
  dp?: number;
  /** Dimensions only: may this column be a grouping level? */
  groupable?: boolean;
  /** Measures only: how the column rolls up under grouping. */
  agg?: Agg;
  /** For `wavg`: the column id to weight by, e.g. `notional`. */
  weightBy?: string;
  /** Background scaled to the column's min/max over the filtered rows. */
  heatmap?: boolean;
  /** Negative values read in the breach colour. */
  negativeRed?: boolean;
}

/** The dash every widget renders for a value it does not have. */
export const MISSING = '—';

function fixed(v: number, dp: number): string {
  return v.toLocaleString('en-US', { minimumFractionDigits: dp, maximumFractionDigits: dp });
}

/**
 * One formatter for every surface. `null`, `undefined` and NaN all render
 * as the missing dash rather than as `NaN` or an empty cell, because an empty
 * cell in a numeric column reads as zero to a scanning eye.
 */
export function formatValue(value: unknown, meta: ColumnMeta): string {
  if (value === null || value === undefined) return MISSING;
  if (meta.unit === 'date') return typeof value === 'string' ? value : MISSING;
  if (typeof value === 'string') return value;
  if (typeof value !== 'number' || Number.isNaN(value)) return MISSING;

  switch (meta.unit) {
    case 'ccy':
      return meta.dp === undefined || meta.dp === 0
        ? catalogFormat(value, 'currency_usd')
        : `${value < 0 ? '-$' : '$'}${fixed(Math.abs(value), meta.dp)}`;
    case 'mm':
      return meta.dp === undefined || meta.dp === 1
        ? catalogFormat(value, 'currency_usd_mm')
        : `${value < 0 ? '-$' : '$'}${fixed(Math.abs(value) / 1e6, meta.dp)}M`;
    case 'pct':
      return catalogFormat(value, `percent_${meta.dp ?? 2}dp`);
    case 'bps':
      return `${fixed(value, meta.dp ?? 1)} bps`;
    case 'years':
      return `${fixed(value, meta.dp ?? 2)}y`;
    default:
      return fixed(value, meta.dp ?? 0);
  }
}

/** Measures sit right-aligned in tabular figures; dimensions read left. */
export const alignOf = (meta: ColumnMeta): 'left' | 'right' =>
  meta.kind === 'measure' ? 'right' : 'left';
