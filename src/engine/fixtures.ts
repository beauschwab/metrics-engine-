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
 * `edge` deliberately includes a PUBLIC_SECTOR segment that no shipped rule
 * matches, so unmapped-record detection has something real to find.
 */
function build2052a(fx: FixtureName): Table {
  const r = seeded(31);
  const byDate: Table = {};
  const pick = <T,>(list: readonly T[], draw: number) => list[Math.floor(draw * list.length)];

  DATES.forEach((d, di) => {
    const rows: Row[] = [];
    const drift = 1 + 0.0009 * di + 0.018 * Math.sin(di / 5.1);
    const shock = fx === 'stress' ? 1.34 : 1;

    ENTITIES.forEach((entity, ei) => {
      for (let k = 0; k < (fx === 'edge' ? 24 : 48); k++) {
        // Each attribute gets its own draw. Deriving several of them from one
        // counter correlates them — with `segment` and `insured_flag` on the
        // same modulus, no row can be both retail and insured, and the rule
        // that reads for exactly that combination silently matches nothing.
        const nSeg = r();
        const nAcct = r();
        const nCpty = r();
        const nIns = r();
        const nSec = r();
        const nColl = r();
        const nDir = r();
        const nMat = r();
        const nAmt = r();

        const secured = nSec > 0.82;
        const inflow = nDir > 0.74;

        // Only the tricky data set carries a segment the rule set has never
        // been told about — which is what makes the coverage gap findable.
        const segment = fx === 'edge' && k % 11 === 0 ? 'PUBLIC_SECTOR' : pick(SEGMENTS, nSeg);

        const openPosition = nMat > 0.88;
        const daysToMaturity = Math.floor(nMat * 420);
        const maturity = openPosition
          ? ''
          : new Date(Date.UTC(2026, 5, 30) + daysToMaturity * 86400000).toISOString().slice(0, 10);

        rows.push({
          as_of_date: d,
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
          balance_usd: (0.5 + nAmt) * (1 + ei * 0.15) * drift * 1.0e6 * (inflow ? 0.6 : shock),
        });
      }
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
