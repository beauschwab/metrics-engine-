/**
 * Conformance: the compiled plan and the evaluator must agree.
 *
 * This is the test the rest of the compiler suite cannot be. Everywhere else we
 * assert that the emitted plan *looks* right — the arms are in order, the rates
 * are inlined, the stages are separate. Here we seed a real DuckDB with the
 * same fixture the browser evaluates, run the plan the compiler produced, and
 * check that the numbers match to the cent.
 *
 * DuckDB is the reference target: it is embeddable, it is the engine the spec
 * names as the conformance reference, and it is strict enough about SQL that a
 * plan which runs here is unlikely to be accidentally DuckDB-shaped.
 *
 * When one of these fails, the plan is wrong and the browser is right — or the
 * other way round. Either way a submission would have been filed with a number
 * nobody could reproduce, which is the failure this whole layer exists to make
 * impossible.
 */

import { DuckDBInstance, type DuckDBConnection } from '@duckdb/node-api';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { compileReport, readReport, type ReportSpec } from './compile';
import {
  compareTables, executableQuery, explain, inferSchema, keyOf, seedStatements,
  toleranceFor, withinTolerance, type TableRow, type Tolerance,
} from './conformance';
import { INITIAL_DOCS } from './documents';
import { AS_OF, TABLES, type Row } from './fixtures';
import { parseDoc, type Graph } from './parse';
import { compilePredicate } from './predicate';
import { buildRegistry, resolveClassification, type Registry } from './registry';
import { runReport } from './report';
import { deriveRows } from './rows';
import { OPEN_BUCKET } from './vocab';

const SOURCE = 'alm.fct_2052a_positions';
const LIQUIDITY = 'alm.fct_liquidity_position';

let connection: DuckDBConnection;
let registry: Registry;
let view: Graph;

/** Every column the harness needs, as DuckDB returns them. */
type DbRow = Record<string, unknown>;

async function run(sql: string): Promise<DbRow[]> {
  const reader = await connection.runAndReadAll(sql);
  return reader.getRowObjects() as DbRow[];
}

/** DuckDB returns DECIMAL/BIGINT as objects; a report measure is always a number. */
function num(v: unknown): number {
  if (v === null || v === undefined) return NaN;
  if (typeof v === 'number') return v;
  if (typeof v === 'bigint') return Number(v);
  const n = Number(String(v));
  return Number.isNaN(n) ? NaN : n;
}

beforeAll(async () => {
  const instance = await DuckDBInstance.create(':memory:');
  connection = await instance.connect();
  registry = buildRegistry(INITIAL_DOCS as unknown as Record<string, string>);
  view = parseDoc(INITIAL_DOCS.fr2052a_outflows);

  // Only the as-of slice. The compiled plan filters to it anyway, and loading
  // sixty days of positions would make the seed dominate the run time.
  for (const src of [SOURCE, LIQUIDITY]) {
    const rows = TABLES.nominal[src][AS_OF];
    for (const stmt of seedStatements(src, rows)) await connection.run(stmt);
  }
}, 120_000);

afterAll(() => {
  connection?.closeSync();
});

// ---------------------------------------------------------------------------
// The fixture arrives intact
// ---------------------------------------------------------------------------

describe('seeding', () => {
  it('loads every fixture row', async () => {
    const [{ n }] = await run(`SELECT count(*) AS n FROM ${SOURCE}`) as Array<{ n: unknown }>;
    expect(num(n)).toBe(TABLES.nominal[SOURCE][AS_OF].length);
  });

  it('types an open position as a null maturity, not an empty string', async () => {
    const rows = TABLES.nominal[SOURCE][AS_OF];
    const open = rows.filter((r) => !r.maturity_date).length;
    const [{ n }] = await run(
      `SELECT count(*) AS n FROM ${SOURCE} WHERE maturity_date IS NULL`,
    ) as Array<{ n: unknown }>;
    expect(open).toBeGreaterThan(0);
    expect(num(n)).toBe(open);
  });

  it('infers a date column only when it holds real dates', () => {
    const schema = inferSchema(TABLES.nominal[SOURCE][AS_OF]);
    const type = (name: string) => schema.find((c) => c.name === name)?.type;
    expect(type('as_of_date')).toBe('DATE');
    expect(type('maturity_date')).toBe('DATE');
    expect(type('balance_usd')).toBe('DOUBLE');
    expect(type('insured_flag')).toBe('BOOLEAN');
    expect(type('segment')).toBe('VARCHAR');
    // Empty on this fixture — vacuously date-shaped, and must not be a DATE.
    expect(type('bucket_code')).toBe('VARCHAR');
  });
});

// ---------------------------------------------------------------------------
// Predicates
// ---------------------------------------------------------------------------

describe('predicate conformance', () => {
  it('matches the same rows in DuckDB as in the evaluator, rule by rule', async () => {
    const c = resolveClassification(registry, 'fr2052a_product_id', AS_OF);
    expect(c).toBeTruthy();
    const rows = TABLES.nominal[SOURCE][AS_OF];

    for (const rule of c!.rules) {
      const pred = compilePredicate(rule.when);
      expect(pred.err, `${rule.id}: ${pred.err}`).toBeFalsy();

      const here = rows.filter((r) => pred.fn(r)).length;
      const [{ n }] = await run(
        `SELECT count(*) AS n FROM ${SOURCE} WHERE ${rule.when}`,
      ) as Array<{ n: unknown }>;

      // A rule matching nothing would make the comparison pass for the wrong
      // reason, so the fixture has to actually exercise it.
      expect(here, `${rule.id} matches no fixture rows`).toBeGreaterThan(0);
      expect(num(n), `${rule.id}`).toBe(here);
    }
  });

  it('agrees on measure filters that read derived columns', async () => {
    // `days_to_maturity <= 30` is the filter every outflow measure carries, and
    // it depends on the null-maturity-is-zero-days decision on both sides.
    const rows = deriveRows(view, registry, TABLES.nominal[SOURCE][AS_OF], AS_OF, {}).rows;
    const here = rows.filter((r) => r.direction === 'OUTFLOW' && Number(r.days_to_maturity) <= 30).length;

    const [{ n }] = await run(
      `SELECT count(*) AS n FROM (
         SELECT COALESCE(DATE_DIFF('day', as_of_date, maturity_date), 0) AS days_to_maturity, direction
         FROM ${SOURCE} WHERE as_of_date = DATE '${AS_OF}'
       ) WHERE direction = 'OUTFLOW' AND days_to_maturity <= 30`,
    ) as Array<{ n: unknown }>;

    expect(here).toBeGreaterThan(0);
    expect(num(n)).toBe(here);
  });
});

// ---------------------------------------------------------------------------
// Derivations
// ---------------------------------------------------------------------------

/** Run just the derivation stages of a compiled plan, without the aggregation. */
function derivationQuery(spec: ReportSpec, columns: string[]): string {
  const plan = executableQuery(compileReport(spec, view, registry, 'sql'));
  // Everything up to the final SELECT is the CTE chain; swap the aggregation
  // for a row-level projection so each derived column can be checked directly.
  const last = plan.lastIndexOf('\nSELECT\n');
  const from = /FROM (d\d+)\n/.exec(plan.slice(last));
  if (last < 0 || !from) {
    throw new Error(`cannot find the aggregation in the compiled plan:\n${plan.slice(-400)}`);
  }
  return `${plan.slice(0, last)}\nSELECT ${columns.join(', ')} FROM ${from[1]}`;
}

describe('derivation conformance', () => {
  const spec = readReport(parseDoc(INITIAL_DOCS.fr2052a_submission));

  it('classifies every record identically', async () => {
    const rows = deriveRows(view, registry, TABLES.nominal[SOURCE][AS_OF], AS_OF, {}).rows;

    // Compare distributions rather than row identity: the fixture has no
    // primary key, so "the same records got the same product ID" is only
    // answerable as a count per value.
    const here: Record<string, number> = {};
    rows.forEach((r) => {
      const k = String(r.product_id ?? '') || '(unmapped)';
      here[k] = (here[k] || 0) + 1;
    });

    const there = await run(
      derivationQuery(spec, ['product_id', 'count(*) AS n']) + ' GROUP BY 1',
    );
    const engine: Record<string, number> = {};
    there.forEach((r) => {
      engine[(r.product_id as string) || '(unmapped)'] = num(r.n);
    });

    expect(Object.keys(here).length).toBeGreaterThan(5);
    expect(engine).toEqual(here);
  });

  it('buckets maturities identically, including open positions', async () => {
    const rows = deriveRows(view, registry, TABLES.nominal[SOURCE][AS_OF], AS_OF, {}).rows;
    const here: Record<string, number> = {};
    rows.forEach((r) => {
      const k = String(r.maturity_bucket ?? '');
      here[k] = (here[k] || 0) + 1;
    });

    const there = await run(
      derivationQuery(spec, ['maturity_bucket', 'count(*) AS n']) + ' GROUP BY 1',
    );
    const engine: Record<string, number> = {};
    there.forEach((r) => {
      engine[(r.maturity_bucket as string) || ''] = num(r.n);
    });

    expect(here[OPEN_BUCKET]).toBeGreaterThan(0);
    expect(engine).toEqual(here);
  });

  it('looks up the same rate for the same product ID', async () => {
    const rows = deriveRows(view, registry, TABLES.nominal[SOURCE][AS_OF], AS_OF, {}).rows;
    const here: Record<string, number> = {};
    rows.forEach((r) => {
      const rate = Number(r.outflow_rate);
      if (Number.isFinite(rate)) here[String(r.product_id)] = rate;
    });

    const there = await run(
      derivationQuery(spec, ['product_id', 'any_value(outflow_rate) AS rate']) +
        ' WHERE outflow_rate IS NOT NULL GROUP BY 1',
    );

    expect(Object.keys(here).length).toBeGreaterThan(5);
    there.forEach((r) => {
      const id = r.product_id as string;
      expect(withinTolerance(here[id], num(r.rate), 'ratio'), `${id}`).toBe(true);
    });
    expect(there.length).toBe(Object.keys(here).length);
  });
});

// ---------------------------------------------------------------------------
// The filed table
// ---------------------------------------------------------------------------

function expectedTable(spec: ReportSpec): { rows: TableRow[]; measures: string[] } {
  const result = runReport(spec, view, registry, 'nominal', AS_OF);
  return { rows: result.rows.map((r) => ({ key: r.key, values: r.values })), measures: result.measures };
}

async function engineTable(spec: ReportSpec, target: Graph = view): Promise<TableRow[]> {
  const sql = executableQuery(compileReport(spec, target, registry, 'sql'));
  const rows = await run(sql);
  return rows.map((r) => ({
    key: spec.grouping.map((g) => (r[g] === null || r[g] === undefined ? '' : String(r[g]))),
    values: Object.fromEntries(
      spec.measures.map((m) => [m, num(r[m])]),
    ),
  }));
}

function tolerances(spec: ReportSpec, target: Graph): Record<string, Tolerance> {
  const out: Record<string, Tolerance> = {};
  spec.measures.forEach((m) => {
    out[m] = toleranceFor((target.byName[m]?.f.format || '').trim());
  });
  return out;
}

describe('report conformance', () => {
  const spec = readReport(parseDoc(INITIAL_DOCS.fr2052a_submission));

  it('produces the same filed rows as the evaluator', async () => {
    const expected = expectedTable(spec);
    const actual = await engineTable(spec);
    const divergences = compareTables(expected.rows, actual, expected.measures, tolerances(spec, view));

    expect(expected.rows.length).toBeGreaterThan(20);
    expect(explain(divergences)).toBe('conformant');
  });

  it('agrees on the totals that get reconciled', async () => {
    const expected = expectedTable(spec);
    const actual = await engineTable(spec);

    expected.measures.forEach((m) => {
      const a = expected.rows.reduce((s, r) => s + (Number.isFinite(r.values[m]) ? r.values[m] : 0), 0);
      const b = actual.reduce((s, r) => s + (Number.isFinite(r.values[m]) ? r.values[m] : 0), 0);
      expect(a).toBeGreaterThan(0);
      // A total is currency and is what an auditor ties out, so it holds to
      // the cent even though it is the sum of two thousand doubles.
      expect(withinTolerance(a, b, 'currency'), `${m}: ${a} vs ${b}`).toBe(true);
    });
  });

  it('files a group for records no rule matched, rather than dropping them', async () => {
    const actual = await engineTable(spec);
    const unmapped = actual.filter((r) => r.key[0] === '');
    const expected = expectedTable(spec).rows.filter((r) => r.key[0] === '');
    expect(unmapped.length).toBe(expected.length);
  });
});

// ---------------------------------------------------------------------------
// A second view, so conformance is not one query's good luck
// ---------------------------------------------------------------------------

describe('conformance across views', () => {
  /**
   * `liquidity_pit` has no report of its own, so we synthesise one. It exercises
   * a path the 2052a report does not: measures with no derivations upstream, and
   * a `where` on a boolean column.
   */
  const spec: ReportSpec = {
    name: 'liquidity_by_entity',
    view: 'liquidity_pit',
    grouping: ['entity_id'],
    measures: ['hqla_total', 'gross_outflows_30d', 'capped_inflows_30d', 'hqla_us_unencumbered'],
    target: '', table: '', partitionBy: [], mode: 'overwrite_partitions',
  };

  it('agrees on a view whose measures carry filters', async () => {
    const pit = parseDoc(INITIAL_DOCS.liquidity_pit);
    const result = runReport(spec, pit, registry, 'nominal', AS_OF);
    const actual = await engineTable(spec, pit);
    const divergences = compareTables(
      result.rows.map((r) => ({ key: r.key, values: r.values })),
      actual,
      result.measures,
      tolerances(spec, pit),
    );
    expect(result.rows.length).toBe(4);
    expect(explain(divergences)).toBe('conformant');
  });

  it('sums an empty group to zero on both sides, not to a blank', async () => {
    // `hqla_us_unencumbered` is scoped to one entity, so three of the four
    // groups have no contributing row at all. Left alone, SQL returns NULL
    // there and the evaluator returns 0 — a filed row that reads blank on one
    // engine and $0 on another. The emitter states the convention instead.
    const pit = parseDoc(INITIAL_DOCS.liquidity_pit);
    const actual = await engineTable(spec, pit);
    const zero = actual.filter((r) => r.values.hqla_us_unencumbered === 0);
    expect(zero.length).toBe(3);
    expect(actual.every((r) => Number.isFinite(r.values.hqla_us_unencumbered))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Comparison machinery
// ---------------------------------------------------------------------------

describe('tolerance policy', () => {
  it('holds currency to the cent', () => {
    expect(withinTolerance(1_000_000.001, 1_000_000.002, 'currency')).toBe(true);
    expect(withinTolerance(1_000_000.00, 1_000_000.02, 'currency')).toBe(false);
  });

  it('compares ratios relatively', () => {
    expect(withinTolerance(118.4, 118.4 + 1e-10, 'ratio')).toBe(true);
    expect(withinTolerance(118.4, 118.5, 'ratio')).toBe(false);
  });

  it('requires counts to be identical', () => {
    expect(withinTolerance(41, 41, 'exact')).toBe(true);
    expect(withinTolerance(41, 41.000001, 'exact')).toBe(false);
  });

  it('treats both sides missing as agreement and one side missing as a failure', () => {
    expect(withinTolerance(NaN, NaN, 'currency')).toBe(true);
    expect(withinTolerance(0, NaN, 'currency')).toBe(false);
  });

  it('reads the tolerance off the declared format', () => {
    expect(toleranceFor('currency_usd')).toBe('currency');
    expect(toleranceFor('percent_1dp')).toBe('ratio');
    expect(toleranceFor('count')).toBe('exact');
  });

  it('folds a null grouping key onto the empty one, and nothing else', () => {
    expect(keyOf([null, 'A'])).toBe(keyOf(['', 'A']));
    expect(keyOf(['', 'A'])).not.toBe(keyOf(['B', 'A']));
  });

  it('reports a group present on only one side', () => {
    const d = compareTables(
      [{ key: ['A'], values: { m: 1 } }],
      [{ key: ['B'], values: { m: 1 } }],
      ['m'],
      { m: 'currency' },
    );
    expect(d.map((x) => x.reason).sort()).toEqual(['missing_in_engine', 'missing_in_evaluator']);
  });
});

describe('plan extraction', () => {
  it('drops the materialize tail, which no reader can execute', () => {
    const spec = readReport(parseDoc(INITIAL_DOCS.fr2052a_submission));
    const plan = compileReport(spec, view, registry, 'sql');
    expect(plan).toContain('INSERT OVERWRITE');
    expect(executableQuery(plan)).not.toContain('INSERT OVERWRITE');
    expect(executableQuery(plan)).toContain('GROUP BY');
  });
});

// ---------------------------------------------------------------------------
// Seeding is derived from the fixture, not hand-maintained
// ---------------------------------------------------------------------------

describe('seed generation', () => {
  it('chunks inserts rather than emitting one enormous VALUES list', () => {
    const rows: Row[] = TABLES.nominal[SOURCE][AS_OF];
    const stmts = seedStatements('t', rows, 10);
    const inserts = stmts.filter((s) => s.startsWith('INSERT'));
    expect(inserts.length).toBe(Math.ceil(rows.length / 10));
  });

  it('creates the schema a dotted source name implies', () => {
    const stmts = seedStatements('alm.positions', [{ as_of_date: AS_OF } as Row]);
    expect(stmts[0]).toBe('CREATE SCHEMA IF NOT EXISTS alm');
  });
});
