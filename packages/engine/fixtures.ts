/**
 * Seeded, deterministic test data — the browser-side stand-in for DuckDB-WASM.
 *
 * 60 days x 4 entities x 40 instruments per source model, generated from a
 * linear congruential PRNG so every reload produces byte-identical numbers.
 * After generation each column is scaled by a single calibration factor so the
 * headline figures land on the values the spec quotes: `hqla_total` at
 * $284,120,000 and therefore `lcr_pct` at 118.4%.
 */

import type { FixtureName } from './vocab';

export const DATES: string[] = (() => {
  const out: string[] = [];
  const end = Date.UTC(2026, 5, 30);
  for (let i = 59; i >= 0; i--) out.push(new Date(end - i * 86400000).toISOString().slice(0, 10));
  return out;
})();

export const LAST = DATES.length - 1;
export const AS_OF = DATES[LAST];

const ENTITIES = ['BANK_US', 'BANK_UK', 'BANK_SG', 'BANK_DE'];
const SCENARIOS = ['base', 'up200', 'dn100'];
const BUCKETS = ['0-1M', '1-3M', '3-12M', '1-5Y', '5Y+'];

export interface Row {
  as_of_date: string;
  entity_id: string;
  scenario_code: string;
  bucket_code: string;
  is_encumbered: boolean;
  [column: string]: string | number | boolean;
}

export type Table = Record<string, Row[]>;

function seeded(s: number): () => number {
  let x = s;
  return () => {
    x = (x * 1103515245 + 12345) % 2147483648;
    return x / 2147483648;
  };
}

function buildTable(source: string, fx: FixtureName): Table {
  const r = seeded(source === 'alm.fct_liquidity_position' ? 7 : 19);
  const byDate: Table = {};
  // `edge` deliberately runs thin: single-row entities, zeros and nulls are
  // the point of that fixture, not volume.
  const inst = fx === 'edge' ? 4 : 40;

  DATES.forEach((d, di) => {
    const rows: Row[] = [];
    const drift = 1 + 0.0011 * di + 0.021 * Math.sin(di / 4.3) + 0.009 * Math.cos(di / 1.7);
    const shock = fx === 'stress' ? 0.744 : 1;

    ENTITIES.forEach((e, ei) => {
      for (let k = 0; k < inst; k++) {
        const n = r();
        const base = (0.4 + n) * (1 + ei * 0.18) * drift;
        const row: Row = {
          as_of_date: d,
          entity_id: e,
          scenario_code: SCENARIOS[k % SCENARIOS.length],
          bucket_code: BUCKETS[k % BUCKETS.length],
          is_encumbered: k % 5 === 0,
        };
        if (source === 'alm.fct_liquidity_position') {
          row.hqla_eligible_amount = fx === 'edge' && k === 1 ? 0 : base * 1.0e6 * shock;
          row.outflow_amount_30d = base * 1.16e6 * (fx === 'stress' ? 1.29 : 1);
          row.inflow_amount_capped_30d = fx === 'edge' && k === 2 ? 0 : base * 0.27e6 * shock;
        } else {
          row.pv_asset_amount = base * 4.5e6 * shock;
          row.pv_liability_amount = base * 3.9e6 * (fx === 'stress' ? 1.031 : 1);
          row.tsy_desk_pnl = (n - 0.5) * 4.2e5;
        }
        rows.push(row);
      }
    });
    byDate[d] = rows;
  });
  return byDate;
}

// ---------------------------------------------------------------------------
// FR 2052a position data
// ---------------------------------------------------------------------------

const SEGMENTS = ['RETAIL', 'SMALL_BUSINESS', 'WHOLESALE'] as const;
const ACCOUNT_TYPES = ['TRANSACTIONAL', 'SAVINGS', 'TIME', 'OPERATIONAL', 'NON_OPERATIONAL'] as const;
const COUNTERPARTIES = ['RETAIL', 'SMB', 'NONFIN_CORP', 'FINANCIAL', 'SOVEREIGN'] as const;
const COLLATERAL = ['L1', 'L2A', 'L2B', 'NON_HQLA', 'UNSECURED'] as const;

/**
 * Positions as a source system hands them over: no product ID, no maturity
 * bucket, no rate. Those are exactly what the classification and parameter
 * layers derive — which is the point of the fixture.
 *
 * **A portfolio, not a fresh random draw per day.** The first version of this
 * re-rolled every attribute on every date, which meant a rollup key's membership
 * was random from one morning to the next: 52 keys produced 310 appearances and
 * 310 disappearances over 60 days, and a day-over-day series was a sequence of
 * unrelated numbers. Thresholds fitted to that measure nothing. So attributes are
 * drawn once per instrument and held; only the balance moves, as a random walk
 * around a level.
 *
 * Maturity is an absolute date, so `days_to_maturity` genuinely shrinks as the
 * as-of date advances and positions roll into the 30-day window over the series
 * — which is where a lot of real day-over-day movement in an LCR number comes
 * from. An instrument is on the book between its issue and its maturity, so
 * appearances and disappearances happen, but as events rather than as noise.
 *
 * `edge` deliberately includes a PUBLIC_SECTOR segment that no shipped rule
 * matches, so unmapped-record detection has something real to find. `nominal`
 * carries one deliberate one-day spike, so a dispersion-based threshold has an
 * unambiguous outlier to catch.
 */
const DAY = 86400000;
const SERIES_START = Date.parse(`${DATES[0]}T00:00:00Z`);

/**
 * Everything about a position except the date it is observed on and its size.
 *
 * Spelled out rather than `Omit<Row, …>`: `Row` carries a string index signature,
 * and `Omit` over that keeps the signature while dropping every named field, so
 * spreading the result satisfies nothing and the compiler complains about the
 * wrong thing.
 */
interface Attributes {
  entity_id: string;
  scenario_code: string;
  bucket_code: string;
  is_encumbered: boolean;
  [column: string]: string | number | boolean;
}

interface Instrument {
  entity: string;
  attrs: Attributes;
  /** Index into DATES from which the position is on the book. */
  from: number;
  /** Index after which it has matured off the book, or DATES.length. */
  to: number;
  level: number;
  /** Per-instrument walk, so the balance moves without the population moving. */
  walk: () => number;
  /** The date index that carries a deliberate one-day spike, if any. */
  spikeAt: number;
}

function build2052a(fx: FixtureName): Table {
  const r = seeded(31);
  const pick = <T,>(list: readonly T[], draw: number) => list[Math.floor(draw * list.length)];
  const perEntity = fx === 'edge' ? 24 : 60;
  const shock = fx === 'stress' ? 1.34 : 1;

  // ---- the book, drawn once -------------------------------------------------
  const instruments: Instrument[] = [];
  ENTITIES.forEach((entity, ei) => {
    for (let k = 0; k < perEntity; k++) {
      // Each attribute gets its own draw. Deriving several of them from one
      // counter correlates them — with `segment` and `insured_flag` on the same
      // modulus, no row can be both retail and insured, and the rule that reads
      // for exactly that combination silently matches nothing.
      const nSeg = r();
      const nAcct = r();
      const nCpty = r();
      const nIns = r();
      const nSec = r();
      const nColl = r();
      const nDir = r();
      const nMat = r();
      const nAmt = r();
      const nLife = r();

      const secured = nSec > 0.74;
      const inflow = nDir > 0.74;
      const segment = fx === 'edge' && k % 11 === 0 ? 'PUBLIC_SECTOR' : pick(SEGMENTS, nSeg);

      // Most of the book is on-boarded before the series starts and matures
      // after it ends; a minority does either inside the window, which is what
      // gives appearances and disappearances something real to be.
      const openPosition = nMat > 0.88;
      // Spread over roughly three times the series, so a thirty-day window
      // always holds a meaningful slice of the book and positions roll into it
      // continuously rather than all at once.
      const maturesAt = openPosition
        ? DATES.length
        : Math.floor(-8 + nMat * (DATES.length + 150));
      const issuedAt = nLife > 0.92 ? Math.floor(nLife * 40) % (DATES.length - 5) : -1;

      const maturity = openPosition
        ? ''
        : new Date(SERIES_START + maturesAt * DAY).toISOString().slice(0, 10);

      instruments.push({
        entity,
        from: Math.max(0, issuedAt),
        to: Math.min(DATES.length, Math.max(0, maturesAt)),
        level: (0.5 + nAmt) * (1 + ei * 0.15) * 1.0e6 * (inflow ? 0.6 : shock),
        walk: seeded(101 + instruments.length * 7),
        // One instrument on the nominal set gets a single large day, so a
        // dispersion threshold has an outlier that is unarguably an outlier.
        spikeAt: fx === 'nominal' && instruments.length === 37 ? 45 : -1,
        attrs: {
          entity_id: entity,
          scenario_code: 'base',
          bucket_code: '',
          is_encumbered: nSec < 0.11,
          currency: nAmt > 0.78 ? 'EUR' : 'USD',
          segment,
          counterparty_type: pick(COUNTERPARTIES, nCpty),
          account_type: pick(ACCOUNT_TYPES, nAcct),
          insured_flag: nIns > 0.34,
          affiliate_flag: nIns > 0.95,
          collateral_class: secured ? pick(COLLATERAL.slice(0, 4), nColl) : 'UNSECURED',
          is_secured: secured,
          direction: inflow ? 'INFLOW' : 'OUTFLOW',
          encumbered_flag: nSec < 0.11,
          maturity_date: maturity,
        } as Attributes,
      });
    }
  });

  // ---- the book, observed daily --------------------------------------------
  const byDate: Table = {};
  const balances = instruments.map((i) => i.level);

  DATES.forEach((d, di) => {
    const drift = 1 + 0.0009 * di + 0.018 * Math.sin(di / 5.1);
    const rows: Row[] = [];

    instruments.forEach((inst, idx) => {
      // The walk advances whether or not the position is on the book, so a
      // balance does not depend on which other instruments happen to be live.
      balances[idx] *= 1 + (inst.walk() - 0.5) * 0.06;
      if (di < inst.from || di >= inst.to) return;

      const spike = di === inst.spikeAt ? 6.5 : 1;
      rows.push({
        ...inst.attrs,
        as_of_date: d,
        balance_usd: balances[idx] * drift * spike,
      });
    });

    byDate[d] = rows;
  });

  return byDate;
}

/** Column, the as-of total it must hit on `nominal`, and the filter that total is taken under. */
const CALIB: Record<string, Array<[string, number, ((row: Row) => boolean) | null]>> = {
  'alm.fct_liquidity_position': [
    ['hqla_eligible_amount', 284120000, (row) => row.is_encumbered === false],
    ['outflow_amount_30d', 312400000, null],
    ['inflow_amount_capped_30d', 72500000, null],
  ],
  'alm.fct_repricing_gap': [
    ['pv_asset_amount', 1284300000, null],
    ['pv_liability_amount', 1102700000, null],
  ],
};

export const TABLES: Record<FixtureName, Record<string, Table>> = (() => {
  // Calibrate against `nominal`, then apply the same factors to every fixture so
  // `edge` and `stress` stay comparable rather than each re-normalising to itself.
  const factors: Record<string, Record<string, number>> = {};
  Object.keys(CALIB).forEach((src) => {
    const t = buildTable(src, 'nominal');
    factors[src] = {};
    CALIB[src].forEach(([col, target, pred]) => {
      let s = 0;
      t[AS_OF].forEach((row) => {
        if (!pred || pred(row)) s += row[col] as number;
      });
      factors[src][col] = s ? target / s : 0;
    });
  });

  const out = {} as Record<FixtureName, Record<string, Table>>;
  (['nominal', 'edge', 'stress'] as FixtureName[]).forEach((fx) => {
    out[fx] = {};
    Object.keys(CALIB).forEach((src) => {
      const t = buildTable(src, fx);
      const f = factors[src];
      DATES.forEach((d) => {
        t[d].forEach((row) => {
          Object.keys(f).forEach((col) => {
            row[col] = (row[col] as number) * f[col];
          });
        });
      });
      out[fx][src] = t;
    });
    // Position data is not calibrated to a headline figure — the numbers that
    // matter here are the classified totals, which the rules decide.
    out[fx]['alm.fct_2052a_positions'] = build2052a(fx);
  });
  return out;
})();

/**
 * Values actually present in the data for a column — what `where:` completion
 * offers, so a predicate that matches nothing is hard to write by accident.
 */
export function distinctValues(fx: FixtureName, src: string, col: string): string[] {
  const seen: Record<string, true> = {};
  const out: string[] = [];
  ((TABLES[fx][src] || {})[AS_OF] || []).forEach((r) => {
    const v = r[col];
    if (v === undefined) return;
    if (typeof v === 'number') return;
    const k = typeof v === 'string' ? `'${v}'` : String(v);
    if (!seen[k] && out.length < 8) {
      seen[k] = true;
      out.push(k);
    }
  });
  return out;
}
