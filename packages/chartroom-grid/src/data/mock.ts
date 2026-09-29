/**
 * A seeded treasury position book.
 *
 * Deterministic on its seed so a test can name a row and a screenshot can be
 * compared across runs; the cardinalities are the point — a handful of desks,
 * ten currencies, eight tenor buckets, hundreds of counterparties — because a
 * grouping tree is only interesting when its levels fan out at different
 * rates. Measures are related the way a book's are: DV01 scales with notional
 * and tenor, CS01 exists only where there is credit, MTM is a small fraction
 * of notional in either direction.
 *
 * Non-ticking. Phase 1 asks this for 50,000 rows; Phase 0 asks for a few
 * hundred. The generator is the same either way.
 */

export interface Position {
  tradeId: string;
  asOf: string;
  desk: string;
  legalEntity: string;
  currency: string;
  product: string;
  tenorBucket: string;
  counterparty: string;
  book: string;
  notional: number;
  mtm: number;
  dv01: number;
  cs01: number;
  yield: number;
  wal: number;
}

export const DESKS = ['Rates', 'Credit', 'FX', 'Funding', 'Mortgages'] as const;
export const ENTITIES = ['WF-US', 'WF-EMEA', 'WF-APAC', 'WF-CA'] as const;
export const CURRENCIES = ['USD', 'EUR', 'GBP', 'JPY', 'CHF', 'CAD', 'AUD', 'HKD', 'SGD', 'MXN'] as const;
export const PRODUCTS = ['Bond', 'IRS', 'CDS', 'Repo', 'FX Fwd', 'Deposit'] as const;
export const TENORS = ['O/N', '1W', '1M', '3M', '6M', '1Y', '5Y', '10Y+'] as const;
/** Bucket midpoints in years, for WAL and the duration DV01 scales with. */
const TENOR_YEARS: Record<(typeof TENORS)[number], number> = {
  'O/N': 0.003, '1W': 0.02, '1M': 0.08, '3M': 0.25, '6M': 0.5, '1Y': 1, '5Y': 5, '10Y+': 15,
};
const CREDIT = new Set<string>(['Bond', 'CDS']);

/** mulberry32 — small, fast, and good enough for a book that never ticks. */
export function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const pick = <T,>(rnd: () => number, xs: readonly T[]): T => xs[Math.floor(rnd() * xs.length)];

export function generatePositions(count: number, seed = 20260929): Position[] {
  const rnd = seeded(seed);
  const counterparties = Array.from({ length: 320 }, (_, i) => `CP-${String(i + 1).padStart(4, '0')}`);
  const books = Array.from({ length: 24 }, (_, i) => `BK-${String(i + 1).padStart(2, '0')}`);
  const out: Position[] = new Array(count);
  for (let i = 0; i < count; i++) {
    const product = pick(rnd, PRODUCTS);
    const tenorBucket = pick(rnd, TENORS);
    const years = TENOR_YEARS[tenorBucket];
    // Log-uniform between $1M and $5B — a book has many small tickets and a
    // few that dominate every total, which is what makes subtotals worth
    // checking.
    const notional = Math.round(Math.exp(Math.log(1e6) + rnd() * Math.log(5e3)));
    const duration = years * (0.85 + 0.3 * rnd());
    const dv01 = Math.round(notional * duration * 1e-4);
    const cs01 = CREDIT.has(product) ? Math.round(dv01 * (0.6 + 0.8 * rnd())) : 0;
    const mtm = Math.round(notional * (rnd() - 0.5) * 0.04);
    out[i] = {
      tradeId: `T${String(i + 1).padStart(6, '0')}`,
      asOf: '2026-09-28',
      desk: pick(rnd, DESKS),
      legalEntity: pick(rnd, ENTITIES),
      currency: pick(rnd, CURRENCIES),
      product,
      tenorBucket,
      counterparty: pick(rnd, counterparties),
      book: pick(rnd, books),
      notional,
      mtm,
      dv01,
      cs01,
      yield: Math.round((0.5 + rnd() * 6.5) * 100) / 100,
      wal: Math.round(years * (0.9 + 0.2 * rnd()) * 100) / 100,
    };
  }
  return out;
}
