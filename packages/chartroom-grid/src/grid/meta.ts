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
/** How a dollar amount is scaled for reading; the stored value stays dollars (NUM-01). */
export type Scale = 'units' | 'k' | 'm' | 'bn';
export const SCALES: readonly Scale[] = ['units', 'k', 'm', 'bn'];
export const SCALE_LABELS: Record<Scale, string> = { units: 'Dollars', k: 'Thousands', m: 'Millions', bn: 'Billions' };
/** How a negative reads: a leading minus, or accounting parentheses. */
export type Negatives = 'minus' | 'parens';
export const NEGATIVES: readonly Negatives[] = ['minus', 'parens'];
export const NEGATIVE_LABELS: Record<Negatives, string> = { minus: '-1,234', parens: '(1,234)' };
/** Decimal places a reader may choose. */
export const DECIMALS: readonly number[] = [0, 1, 2, 3, 4];

/**
 * A highlight rule (ADR-78): a comparison on the cell's number and the
 * emphasis it earns. Emphasis, never a semantic colour — red, amber and
 * green belong to governed thresholds (COL-03), and a reader's "show me
 * the big ones" is not one.
 */
export type RuleOp = '>' | '>=' | '<' | '<=' | '=' | '!=';
export const RULE_OPS: readonly RuleOp[] = ['>', '>=', '<', '<=', '=', '!='];
export type Emphasis = 'accent' | 'strong' | 'muted';
export const EMPHASES: readonly Emphasis[] = ['accent', 'strong', 'muted'];
export const EMPHASIS_LABELS: Record<Emphasis, string> = { accent: 'Highlight', strong: 'Bold', muted: 'Fade' };
export interface HighlightRule {
  op: RuleOp;
  value: number;
  emphasis: Emphasis;
}
/** At most this many rules per column: a fifth rule is a threshold, and belongs in the registry. */
export const MAX_RULES = 4;

/** The first rule a number satisfies, in the order the reader wrote them. */
export function matchRule(rules: readonly HighlightRule[] | undefined, value: unknown): HighlightRule | undefined {
  if (!rules || typeof value !== 'number' || !Number.isFinite(value)) return undefined;
  for (const r of rules) {
    switch (r.op) {
      case '>': if (value > r.value) return r; break;
      case '>=': if (value >= r.value) return r; break;
      case '<': if (value < r.value) return r; break;
      case '<=': if (value <= r.value) return r; break;
      case '=': if (value === r.value) return r; break;
      case '!=': if (value !== r.value) return r; break;
      default: break;
    }
  }
  return undefined;
}

/**
 * A reader's formatting of one measure (ADR-74): the readings a unit
 * allows, never the unit itself. A percent stays a percent, dollars stay
 * dollars; what changes is decimals, the scale dollars are read at, how a
 * negative is written, and the two colourings.
 */
export interface ColumnFormat {
  dp?: number;
  scale?: Scale;
  negatives?: Negatives;
  negativeRed?: boolean;
  heatmap?: boolean;
  /** Highlight rules, first match wins (ADR-78). */
  rules?: HighlightRule[];
}
export const FORMAT_KEYS: readonly (keyof ColumnFormat)[] = ['dp', 'scale', 'negatives', 'negativeRed', 'heatmap', 'rules'];
export type Agg = 'sum' | 'wavg' | 'mean' | 'median' | 'min' | 'max' | 'count' | 'uniqueCount';
export const AGGS: readonly Agg[] = ['sum', 'wavg', 'mean', 'median', 'min', 'max', 'count', 'uniqueCount'];
export const AGG_LABELS: Record<Agg, string> = {
  sum: 'Sum', wavg: 'Weighted average', mean: 'Mean', median: 'Median', min: 'Min', max: 'Max', count: 'Count', uniqueCount: 'Distinct count',
};

export interface ColumnMeta {
  /** The header label — what a reader calls the column. */
  label: string;
  /** The family the column belongs to, drawn as a band above contiguous headers (ADR-75). */
  band?: string;
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
  /** Dollar units only: the scale the amount is read at (`mm` reads at `m` by default). */
  scale?: Scale;
  /** How a negative is written; a leading minus by default. */
  negatives?: Negatives;
  /** A reader's highlight rules for the view (ADR-78). */
  rules?: HighlightRule[];
  /** A calculated column (ADR-79): a draft the view defines, not a registry measure. */
  computed?: boolean;
  /** A pivot column (ADR-80): a measure read within one value of the pivot dimension. */
  pivot?: boolean;
  /** Dimensions only: may this column be a grouping level? */
  groupable?: boolean;
  /**
   * Dimensions only: the values in their implied order (ADR-84) — a tenor
   * ladder, a maturity bucket, a rating — so the column sorts, filters and
   * pivots in that order rather than lexically. Values not named sort last.
   */
  order?: readonly string[];
  /** Measures only: how the column rolls up under grouping. */
  agg?: Agg;
  /** For `wavg`: the column id to weight by, e.g. `notional`. */
  weightBy?: string;
  /** Background scaled to the column's min/max over the filtered rows. */
  heatmap?: boolean;
  /** Negative values read in the breach colour. */
  negativeRed?: boolean;
  /** Initial column width in px; the reader may resize (Phase 3), the view state remembers. */
  width?: number;
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

  // Accounting negatives wrap the whole reading, sign removed, so "($1.2M)"
  // and "(3.46%)" read the same way a ledger does.
  if (meta.negatives === 'parens' && value < 0) return `(${formatValue(-value, { ...meta, negatives: 'minus' })})`;

  switch (meta.unit) {
    case 'ccy':
    case 'mm': {
      const scale = meta.scale ?? (meta.unit === 'mm' ? 'm' : 'units');
      const dp = meta.dp ?? (scale === 'units' ? 0 : 1);
      // The catalog's own readings where the reading is the catalog's
      // (ADR-29); the same shape, scaled, where the reader chose otherwise.
      if (scale === 'units' && dp === 0) return catalogFormat(value, 'currency_usd');
      if (scale === 'm' && dp === 1) return catalogFormat(value, 'currency_usd_mm');
      const div = scale === 'k' ? 1e3 : scale === 'm' ? 1e6 : scale === 'bn' ? 1e9 : 1;
      const suffix = scale === 'k' ? 'K' : scale === 'm' ? 'M' : scale === 'bn' ? 'B' : '';
      return `${value < 0 ? '-$' : '$'}${fixed(Math.abs(value) / div, dp)}${suffix}`;
    }
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

/** Whether a measure's unit is read at a scale — dollars are, a percent is not. */
export const isScalable = (meta: ColumnMeta): boolean => meta.unit === 'ccy' || meta.unit === 'mm';

/** Measures sit right-aligned in tabular figures; dimensions read left. */
export const alignOf = (meta: ColumnMeta): 'left' | 'right' =>
  meta.kind === 'measure' ? 'right' : 'left';

/**
 * The meta an aggregate reads with. A subtotal, a grand total and a copied
 * or exported aggregate format through the column's own meta — the same
 * decimals, scale, negatives and rules as its leaf cells — with one
 * exception: a count or a distinct count is a number of rows, not an
 * amount in the column's unit, so it reads as a plain integer.
 */
export function aggregateMeta(meta: ColumnMeta, aggregation: unknown): ColumnMeta {
  if (aggregation === 'count' || aggregation === 'uniqueCount') {
    return { ...meta, unit: undefined, dp: 0, scale: undefined, negativeRed: false, rules: undefined };
  }
  return meta;
}
