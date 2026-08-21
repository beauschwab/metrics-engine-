/**
 * Does the warehouse raise the same alerts as the browser?
 *
 * A variance monitor is the first thing in this registry whose answer depends on
 * more than one day, and window semantics are where two implementations of the
 * same intent quietly diverge. Every one of these is a real way to get it wrong
 * while reading correctly:
 *
 *   - `ROWS BETWEEN 30 PRECEDING AND CURRENT ROW` instead of `AND 1 PRECEDING`,
 *     so a spike widens the band it is tested against.
 *   - `STDDEV_POP` instead of `STDDEV_SAMP`, off by √(n/(n−1)).
 *   - σ over the *levels* rather than over the changes, which on a trending
 *     series is large enough that nothing ever fires.
 *   - a σ computed from three observations, treated as a threshold.
 *
 * None of those is visible in a plan review. All of them are visible the moment
 * DuckDB and the evaluator are asked for the same breach list.
 *
 * The filed table is seeded from the report itself, day by day, so what is being
 * monitored here is genuinely what would have been filed.
 */

import { DuckDBInstance, type DuckDBConnection } from '@duckdb/node-api';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { readReport } from './compile';
import { compileMonitor } from './compile-variance';
import { INITIAL_DOCS } from './documents';
import { DATES } from './fixtures';
import { parseDoc } from './parse';
import { buildRegistry, type Registry } from './registry';
import { runReport } from './report';
import { readMonitor, runMonitor, type MonitorSpec } from './variance';

const SINK = 'reg.fr2052a_daily';

/**
 * The separator inside a composite lookup key.
 *
 * Written as an escape, never as a raw byte: a literal control character in a
 * source file makes every tool treat it as binary — `grep` refuses to search it —
 * and leaves something invisible in the code.
 */
const SEP = '\u001f';
const joinKey = (parts: string[]) => parts.join(SEP);
const readable = (k: string) => k.split(SEP).join(' · ');

let connection: DuckDBConnection;
let registry: Registry;
let monitor: MonitorSpec;

const view = parseDoc(INITIAL_DOCS.fr2052a_outflows);
const report = readReport(parseDoc(INITIAL_DOCS.fr2052a_submission));

const num = (v: unknown): number => {
  if (v === null || v === undefined) return NaN;
  if (typeof v === 'number') return v;
  if (typeof v === 'bigint') return Number(v);
  const n = Number(String(v));
  return Number.isNaN(n) ? NaN : n;
};

async function run(sql: string): Promise<Array<Record<string, unknown>>> {
  const reader = await connection.runAndReadAll(sql);
  return reader.getRowObjects() as Array<Record<string, unknown>>;
}

beforeAll(async () => {
  const instance = await DuckDBInstance.create(':memory:');
  connection = await instance.connect();
  registry = buildRegistry(INITIAL_DOCS as unknown as Record<string, string>);
  monitor = readMonitor(parseDoc(INITIAL_DOCS.fr2052a_variance));

  await connection.run('CREATE SCHEMA IF NOT EXISTS reg');
  await connection.run(
    `CREATE OR REPLACE TABLE ${SINK} (
      product_id VARCHAR, maturity_bucket VARCHAR, currency VARCHAR,
      entity_id VARCHAR, as_of_date DATE,
      gross_outflow_balance DOUBLE, weighted_outflows_30d DOUBLE
    )`,
  );

  // Seed the sink the way the pipeline would: run the report once per day and
  // file the rows. Monitoring anything else would be monitoring a number that
  // was never submitted.
  for (const date of DATES) {
    const filed = runReport(report, view, registry, 'nominal', date);
    if (!filed.rows.length) continue;
    const values = filed.rows
      .map((r) => {
        const cell = (i: number) => `'${String(r.key[i] ?? '').replace(/'/g, "''")}'`;
        const g = report.grouping;
        const at = (name: string) => {
          const i = g.indexOf(name);
          return i >= 0 ? cell(i) : "''";
        };
        const money = (m: string) =>
          Number.isFinite(r.values[m]) ? String(r.values[m]) : 'NULL';
        return `(${at('product_id')}, ${at('maturity_bucket')}, ${at('currency')}, ` +
          `${at('entity_id')}, DATE '${date}', ` +
          `${money('gross_outflow_balance')}, ${money('weighted_outflows_30d')})`;
      })
      .join(',\n');
    await connection.run(`INSERT INTO ${SINK} VALUES\n${values}`);
  }
}, 180_000);

afterAll(() => {
  connection?.closeSync();
});

// ---------------------------------------------------------------------------

describe('the filed table', () => {
  it('holds every day of the window', async () => {
    const [{ days, rows }] = (await run(
      `SELECT COUNT(DISTINCT as_of_date) AS days, COUNT(*) AS rows FROM ${SINK}`,
    )) as Array<{ days: unknown; rows: unknown }>;
    expect(num(days)).toBe(DATES.length);
    expect(num(rows)).toBeGreaterThan(1000);
  });
});

describe('variance conformance', () => {
  /** The evaluator's breaches, keyed so the two lists can be compared as sets. */
  function expectedBreaches() {
    const result = runMonitor(monitor, report, view, registry, 'nominal');
    const set = new Map<string, number>();
    result.breaches.forEach((b) => {
      set.set(joinKey([...b.key, b.date, b.evaluation.threshold.id]), b.delta);
    });
    return { result, set };
  }

  async function engineBreaches() {
    const sql = compileMonitor(monitor, SINK, monitor.grain, 'sql');
    const rows = await run(sql);
    const set = new Map<string, number>();
    rows.forEach((r) => {
      const key = monitor.grain.map((g) => String(r[g] ?? ''));
      const date = String(r.as_of_date).slice(0, 10);
      monitor.thresholds.forEach((t) => {
        const flag = num(r[`breach_${t.id.replace(/-/g, '_')}`]);
        if (flag === 1) set.set(joinKey([...key, date, t.id]), num(r.dod_change));
      });
    });
    return set;
  }

  it('computes the rolled-up level identically', async () => {
    const result = runMonitor(monitor, report, view, registry, 'nominal');
    const rows = await run(
      `SELECT ${monitor.grain.join(', ')}, as_of_date, ROUND(SUM(weighted_outflows_30d), 2) AS value
       FROM ${SINK} GROUP BY ${monitor.grain.join(', ')}, as_of_date`,
    );

    const there = new Map<string, number>();
    rows.forEach((r) => {
      there.set(
        joinKey([
          ...monitor.grain.map((g) => String(r[g] ?? '')),
          String(r.as_of_date).slice(0, 10),
        ]),
        num(r.value),
      );
    });

    let compared = 0;
    result.series.forEach((s, si) => {
      result.points[si].forEach((p) => {
        if (!s.present[p.index]) return;
        const k = joinKey([...s.key, p.date]);
        expect(there.has(k), `engine missing ${readable(k)}`).toBe(true);
        // Both sides round the roll-up, so this is an equality, not a tolerance.
        expect(Math.abs(there.get(k)! - p.value), readable(k)).toBeLessThanOrEqual(0.001);
        compared++;
      });
    });
    expect(compared).toBeGreaterThan(2000);
  });

  it('raises exactly the same breaches', async () => {
    const { result, set: expected } = expectedBreaches();
    const actual = await engineBreaches();

    expect(expected.size).toBeGreaterThan(20);

    const onlyEvaluator = [...expected.keys()].filter((k) => !actual.has(k));
    const onlyEngine = [...actual.keys()].filter((k) => !expected.has(k));
    const show = (ks: string[]) =>
      ks.slice(0, 6).map(readable).join('\n  ');

    expect(onlyEvaluator, `raised in the browser only:\n  ${show(onlyEvaluator)}`).toEqual([]);
    expect(onlyEngine, `raised in DuckDB only:\n  ${show(onlyEngine)}`).toEqual([]);
    expect(actual.size).toBe(result.breaches.length);
  });

  it('agrees on the size of every move it raised', async () => {
    const { set: expected } = expectedBreaches();
    const actual = await engineBreaches();
    expected.forEach((delta, k) => {
      expect(Math.abs(actual.get(k)! - delta), k)
        .toBeLessThanOrEqual(0.001);
    });
  });

  it('agrees on σ and the observation count behind each dynamic threshold', async () => {
    // The same compiled plan, emitting every point instead of only the breaches
    // — so σ and the observation count are checked on the quiet days too, which
    // is where an off-by-one frame hides.
    const rows = await run(compileMonitor(monitor, SINK, monitor.grain, 'sql', { allRows: true }));

    const result = runMonitor(monitor, report, view, registry, 'nominal');
    const byPoint = new Map<string, { sigma: Record<string, number>; obs: Record<string, number> }>();
    result.series.forEach((s, si) => {
      result.points[si].forEach((p) => {
        byPoint.set(joinKey([...s.key, p.date]), { sigma: p.sigma, obs: p.observations });
      });
    });

    let checked = 0;
    rows.forEach((r) => {
      const k = joinKey([
        ...monitor.grain.map((g) => String(r[g] ?? '')),
        String(r.as_of_date).slice(0, 10),
      ]);
      const mine = byPoint.get(k);
      if (!mine) return;
      (['stddev_30d', 'stddev_60d'] as const).forEach((basis) => {
        const there = num(r[`sigma_${basis}`]);
        const count = num(r[`n_${basis}`]);
        // The count has to match exactly — it decides whether a threshold exists
        // at all, and an off-by-one frame shows up here before it shows up in a
        // breach list.
        expect(count, `${readable(k)} ${basis} n`).toBe(mine.obs[basis]);
        if (!Number.isFinite(there) || !Number.isFinite(mine.sigma[basis])) return;
        // Relative: σ is a square root of a mean of squares, so the last bits
        // legitimately differ between two summation orders.
        expect(Math.abs(there - mine.sigma[basis]) / Math.max(1, Math.abs(there)), `${readable(k)} ${basis} σ`)
          .toBeLessThan(1e-9);
        checked++;
      });
    });
    expect(checked).toBeGreaterThan(1000);
  });

  it('never lets a spike widen its own threshold', () => {
    const keys = monitor.grain.join(', ');
    return run(
      `WITH rollup AS (
         SELECT ${keys}, as_of_date, ROUND(SUM(weighted_outflows_30d), 2) AS value
         FROM ${SINK} GROUP BY ${keys}, as_of_date
       ), changed AS (
         SELECT *, value - LAG(value) OVER (PARTITION BY ${keys} ORDER BY as_of_date) AS d
         FROM rollup
       ), framed AS (
         SELECT ABS(d) AS move,
           STDDEV_SAMP(d) OVER (PARTITION BY ${keys} ORDER BY as_of_date
             ROWS BETWEEN 30 PRECEDING AND 1 PRECEDING) AS excl,
           STDDEV_SAMP(d) OVER (PARTITION BY ${keys} ORDER BY as_of_date
             ROWS BETWEEN 30 PRECEDING AND CURRENT ROW) AS incl
         FROM changed
       )
       SELECT move, excl, incl FROM framed
       WHERE excl IS NOT NULL AND incl IS NOT NULL
       ORDER BY move DESC`,
    ).then((rows) => {
      // At the biggest move in the whole window, the frame that includes today
      // reports a wider band than the frame that stops at yesterday — so a
      // `CURRENT ROW` frame would raise the bar for exactly the day that most
      // needs to clear it. This is why the emitted frame ends at `1 PRECEDING`.
      const worst = rows[0];
      expect(num(worst.incl)).toBeGreaterThan(num(worst.excl));

      // And it is not a quirk of one row. The effect is specific to outliers —
      // on an ordinary day, adding today to thirty prior moves barely shifts σ
      // and can lower it — so the claim is tested where it matters: among the
      // largest moves, almost every one inflates the band that judges it.
      const top = rows.slice(0, 25);
      const inflated = top.filter((r) => num(r.incl) > num(r.excl)).length;
      expect(inflated / top.length).toBeGreaterThan(0.8);
    });
  });
});
