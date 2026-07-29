/**
 * Vocabulary the registry knows about: pill taxonomy, closed-choice fields,
 * the source-model column lists, and the plain-English help text that goes
 * beside every option in the completion menu.
 *
 * Terminology here is deliberately non-jargon in anything user-facing
 * ("recognized", not "resolved"; "test data", not "fixture") — the YAML field
 * names and KEEL codes stay as they are because they are the file format's
 * contract with the linter.
 */

export type PillKind = 'measure' | 'dimension' | 'func' | 'column';

export type PillState =
  | 'resolved'
  | 'unresolved'
  | 'circular'
  | 'deprecated'
  | 'restricted'
  | 'stale'
  | 'focused';

export type FixtureName = 'nominal' | 'edge' | 'stress';

export type Severity = 'error' | 'warn' | 'info';

/** The one place a hue is allowed to mean something. Everything else is greyscale. */
export const HUE = {
  measure: '#45B6F0',
  dimension: '#34C77B',
  func: '#8B7CF0',
  column: '#ADB5BF',
  unresolved: '#E5484D',
  warn: '#E08C2E',
  signal: '#F2B300',
} as const;

export const FUNCS: Record<string, true> = {
  sum: true, avg: true, greatest: true, least: true, nullif: true, coalesce: true,
  abs: true, ema: true, last: true, first: true, max: true, min: true,
};

/** Operators a given backend cannot compile. Drives KEEL021. */
export const UNSUPPORTED: Record<string, string> = { ema: 'Dremio' };

export const ENUMS: Record<string, string[]> = {
  type: ['simple', 'derived', 'windowed'],
  format: ['currency_usd', 'currency_usd_mm', 'percent_1dp', 'percent_2dp', 'number', 'bps'],
  agg: ['sum', 'avg', 'last', 'first', 'max', 'min', 'count', 'weighted_avg'],
  sr_11_7_tier: ['1', '2', '3'],
  grain_type: ['stock', 'flow', 'ratio'],
  grain: ['stock', 'flow', 'ratio'],
  validation_status: ['draft', 'in_review', 'validated', 'deprecated'],
  'window.op': ['delta', 'pct_change', 'stddev', 'variance', 'avg', 'sum', 'min', 'max'],
  'window.over': ['1d', '7d', '30d', '90d'],
  'window.frame': ['time', 'rows'],
};

/**
 * Aggregates fold rows. A `derived` measure composes other measures, so an
 * aggregate appearing inside one means the author is reaching past the
 * measure layer into the source table — KEEL022.
 */
export const AGGREGATES: Record<string, true> = {
  sum: true, avg: true, count: true, first: true, last: true, weighted_avg: true,
};

/** Everything the metric algebra accepts as an operator. Anything else is KEEL020. */
export const ALGEBRA_OPS: Record<string, true> = {
  '+': true, '-': true, '*': true, '/': true, '(': true, ')': true, ',': true,
  '=': true, '!=': true, '<>': true, '>': true, '<': true, '>=': true, '<=': true,
};

/** Spans that permit more than one as-of date to be folded together. */
export function spanPermitsMultipleDates(span: string): boolean {
  const t = (span || '').trim().toUpperCase();
  if (!t) return true;
  const m = /^P(?:(\d+)D|(\d+)W|(\d+)M|(\d+)Y)$/.exec(t);
  if (!m) return true;
  if (m[1]) return parseInt(m[1], 10) > 1;
  return true;
}

export const ENUM_HELP: Record<string, string> = {
  simple: 'reads one column', derived: 'combines other measures', windowed: 'looks across dates',
  stock: 'a balance at a point in time', flow: 'accumulates over a period', ratio: 'a proportion',
  currency_usd: 'dollars', currency_usd_mm: 'dollars, in millions', percent_1dp: 'percent, 1 decimal',
  percent_2dp: 'percent, 2 decimals', number: 'plain number', bps: 'basis points',
  sum: 'adds every row', avg: 'averages rows', last: 'latest row', first: 'earliest row',
  max: 'largest row', min: 'smallest row', count: 'counts rows',
  weighted_avg: 'averages rows, weighted by a column',
  '1': 'top oversight', '2': 'reviewed', '3': 'exploratory',
  draft: 'still being written', in_review: 'waiting on review',
  validated: 'signed off — edits need a ticket', deprecated: 'being retired',
  time: 'a span of time — well defined under ticking',
  rows: 'a count of rows — ill defined under ticking',
};

export const ENUM_LABEL: Record<string, string> = {
  type: 'kind of measure',
  format: 'how the number is displayed',
  agg: 'how rows are combined',
  sr_11_7_tier: 'oversight level',
  grain_type: 'what the numbers represent',
  'window.op': 'time calculation',
  'window.over': 'how far back to look',
  'window.frame': 'how the window is measured',
  validation_status: 'where this sits in review',
  grain: 'what this measure represents',
  targets: 'databases this must run on',
};

export const WINDOW_HELP: Record<string, string> = {
  delta: 'change since the earlier day',
  pct_change: 'percent change since the earlier day',
  stddev: 'volatility across the window',
  variance: 'squared volatility across the window',
  avg: 'average across the window',
  sum: 'total across the window',
  min: 'lowest in the window',
  max: 'highest in the window',
};

export const FIXTURES: Record<FixtureName, string> = {
  nominal: 'Typical data',
  edge: 'Tricky data',
  stress: 'Stressed data',
};

export const STATE_LABEL: Record<PillState, string> = {
  resolved: 'recognized',
  unresolved: 'unknown name',
  circular: 'loops back on itself',
  deprecated: 'being retired',
  restricted: 'hidden from you',
  stale: 'recalculating',
  focused: 'selected',
};

export const KIND_LABEL: Record<PillKind, string> = {
  measure: 'measure',
  dimension: 'grouping',
  func: 'function',
  column: 'source column',
};

export const DIMS: Record<string, true> = {
  entity: true, scenario: true, currency: true, bucket: true, legal_entity: true,
};

/** Measures the current author has no `field_access` for. */
export const RESTRICTED: Record<string, true> = { tsy_desk_pnl: true };

/** YAML keys whose scalars are scanned for registry references. */
export const PILL_KEYS: Record<string, true> = {
  requires: true, expression: true, where: true, field: true, weight: true,
  partition_by: true, order_by: true, agg: true,
  'window.order_by': true, 'window.partition_by': true,
};

/** Keys with a closed set of legal values — clicking one always opens the picker. */
export const CHOICE_KEYS: Record<string, true> = {
  type: true, format: true, agg: true, sr_11_7_tier: true,
  'window.op': true, 'window.over': true, 'window.frame': true,
  validation_status: true, grain: true, targets: true,
  field: true, weight: true, where: true, requires: true,
  partition_by: true, order_by: true,
  'window.partition_by': true, 'window.order_by': true,
};

export const LITERALS: Record<string, true> = { true: true, false: true, null: true, P1D: true };

/**
 * Expression syntax. These read as identifiers but name nothing in the
 * registry, so they never become pills and never raise a resolution
 * diagnostic — `case when … end` is grammar, not a reference.
 */
export const KEYWORDS: Record<string, true> = {
  case: true, when: true, then: true, else: true, end: true,
  and: true, or: true, not: true, is: true, in: true,
};

/**
 * Whether an identifier in an expression is a reference the registry should
 * try to resolve — as opposed to a function, a literal, or expression grammar.
 */
export function isReferenceName(n: string): boolean {
  return !(n in FUNCS) && !(n in LITERALS) && !(n.toLowerCase() in KEYWORDS) && !/^\d/.test(n);
}

/**
 * Maturity ladders. FR 2052a reports every position in a maturity bucket, and
 * the bucket is a row-level derivation from maturity date against the as-of
 * date — not something the source system carries.
 */
export const MATURITY_LADDERS: Record<string, Array<{ name: string; maxDays: number }>> = {
  fr2052a_maturity: [
    { name: 'overnight', maxDays: 1 },
    { name: 'd2_7', maxDays: 7 },
    { name: 'd8_14', maxDays: 14 },
    { name: 'd15_30', maxDays: 30 },
    { name: 'd31_90', maxDays: 90 },
    { name: 'd91_180', maxDays: 180 },
    { name: 'd181_365', maxDays: 365 },
    { name: 'gt365', maxDays: Infinity },
  ],
};

/** Bucket name for a position with no stated maturity. */
export const OPEN_BUCKET = 'open';

/**
 * Closed value domains a classification may emit into. Declaring the domain is
 * what lets the linter catch a product ID that is not on the form.
 */
export const DOMAINS: Record<string, string[]> = {
  fr2052a_product_ids: [
    'O.D.1', 'O.D.2', 'O.D.3', 'O.D.5', 'O.D.6',
    'O.W.1', 'O.W.2', 'O.W.3',
    'O.S.1', 'O.S.2',
    'I.U.1', 'I.S.1', 'I.O.1',
  ],
};

/** Row-level derivation operators — Tier E. All stateless, all portable. */
export const DERIVATION_OPS: Record<string, string> = {
  classify: 'assign a value from an ordered rule set',
  date_bucket: 'place a date on a maturity ladder',
  days_between: 'whole days from one date to another',
  param_lookup: 'read a governed assumption by key',
  expr: 'arithmetic over row columns',
};

export const COLUMNS: Record<string, string[]> = {
  'alm.fct_2052a_positions': [
    'as_of_date', 'entity_id', 'currency', 'segment', 'counterparty_type',
    'account_type', 'insured_flag', 'affiliate_flag', 'collateral_class',
    'is_secured', 'direction', 'encumbered_flag', 'balance_usd', 'maturity_date',
  ],
  'alm.fct_liquidity_position': [
    'hqla_eligible_amount', 'is_encumbered', 'outflow_amount_30d',
    'inflow_amount_capped_30d', 'as_of_date', 'entity_id', 'scenario_code',
  ],
  'alm.fct_repricing_gap': [
    'pv_asset_amount', 'pv_liability_amount', 'tsy_desk_pnl',
    'as_of_date', 'bucket_code', 'scenario_code',
  ],
};

/** Measures defined in another view — referenced but not editable here. */
export interface ExternalMeasure {
  label: string;
  deprecated?: boolean;
  v: Record<FixtureName, number>;
  format: string;
}

export const EXTERNAL: Record<string, ExternalMeasure> = {
  nii_12m_legacy: {
    label: 'Net Interest Income 12m (legacy)',
    deprecated: true,
    v: { nominal: 48210000, edge: 1240, stress: 41880000 },
    format: 'currency_usd',
  },
};

/** Governance metadata the definition card reads. */
export const META: Record<string, { owner: string; cite: string; grain: string }> = {
  hqla_total: { owner: 'ALM Analytics', cite: '12 CFR 249.20-22', grain: 'stock · as_of_date' },
  lcr_pct: { owner: 'ALM Analytics', cite: '12 CFR 249.20', grain: 'stock · as_of_date' },
  eve_delta_up200: { owner: 'IRRBB', cite: 'SR 96-13', grain: 'stock · as_of_date' },
};

export const BACKENDS = ['duckdb', 'snowflake', 'databricks', 'bigquery', 'dremio'] as const;
