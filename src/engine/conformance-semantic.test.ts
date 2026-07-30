/**
 * The published view and the surface must agree.
 *
 * This is the point of emitting a semantic artifact at all. The argument for it
 * was never "BI tools like views" — it was that the last hop of a governed
 * number is currently a human retyping `100.0 * HQLA / net outflows` into a
 * dashboard, after which the two definitions drift and *nothing compares them*.
 *
 * An emitter nobody executes would recreate exactly that problem one layer
 * further in: a generated view that is subtly wrong is worse than a hand-written
 * one, because it carries the authority of having been generated. So the view is
 * created in a real DuckDB over the same fixture the browser evaluates, and the
 * LCR it returns is reconciled against the LCR on screen.
 *
 * That equality is the whole claim: **the number in the dashboard is the number
 * you signed off.**
 */

import { DuckDBInstance, type DuckDBConnection } from '@duckdb/node-api';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { seedStatements } from './conformance';
import { INITIAL_DOCS } from './documents';
import { Evaluator } from './evaluate';
import { AS_OF, TABLES } from './fixtures';
import { parseDoc, type Graph } from './parse';
import { buildRegistry } from './registry';
import { emitDbtModel, emitViewDdl, expressionToSql } from './semantic';

const LIQUIDITY = 'alm.fct_liquidity_position';

let connection: DuckDBConnection;
let view: Graph;
let evaluator: Evaluator;

async function run(sql: string): Promise<Array<Record<string, unknown>>> {
  const reader = await connection.runAndReadAll(sql);
  return reader.getRowObjects() as Array<Record<string, unknown>>;
}

const num = (v: unknown): number => {
  if (v === null || v === undefined) return NaN;
  if (typeof v === 'number') return v;
  if (typeof v === 'bigint') return Number(v);
  const n = Number(String(v));
  return Number.isNaN(n) ? NaN : n;
};

beforeAll(async () => {
  const instance = await DuckDBInstance.create(':memory:');
  connection = await instance.connect();

  view = parseDoc(INITIAL_DOCS.liquidity_pit);
  const registry = buildRegistry(INITIAL_DOCS as unknown as Record<string, string>);
  evaluator = new Evaluator(view, 'nominal', registry);

  // `analytics` has to exist before a view can be created in it — the emitted
  // DDL names a schema and does not create one, because creating schemas is a
  // deployment decision rather than a definition.
  await connection.run('CREATE SCHEMA IF NOT EXISTS analytics');
  const rows = TABLES.nominal[LIQUIDITY][AS_OF];
  for (const stmt of seedStatements(LIQUIDITY, rows)) await connection.run(stmt);
}, 120_000);

afterAll(() => {
  connection?.closeSync();
});

// ---------------------------------------------------------------------------

describe('the published view', () => {
  it('is valid SQL on a real engine', async () => {
    // The first thing a generated artifact has to be. An emitter that produces
    // something only a reader believes is an emitter that ships broken views.
    const plan = emitViewDdl(view);
    await connection.run(plan.text);
    const rows = await run('SELECT * FROM analytics.liquidity_pit');
    expect(rows).toHaveLength(1);
  });

  it('returns the LCR the surface shows, to the cent', async () => {
    // The claim. `lcr_pct` is defined once, under a tier and a citation, and the
    // dashboard reads the same arithmetic rather than a retyped copy of it.
    await connection.run(emitViewDdl(view).text);
    const [row] = await run('SELECT * FROM analytics.liquidity_pit');

    const plan = emitViewDdl(view);
    expect(plan.published.length).toBeGreaterThan(8);

    plan.published.forEach((name) => {
      const here = evaluator.value(name);
      expect(Number.isFinite(here.v), `${name} did not evaluate in the browser`).toBe(true);
      expect(Math.abs(num(row[name]) - here.v), `${name}`).toBeLessThanOrEqual(0.01);
    });
  });

  it('carries the filter that is part of a measure, not just its field', async () => {
    // `hqla_total` is a sum *where the position is unencumbered*. A published
    // view that dropped the filter would be a bigger, friendlier, wrong number.
    await connection.run(emitViewDdl(view).text);
    const [row] = await run('SELECT hqla_total FROM analytics.liquidity_pit');
    const [all] = await run(`SELECT ROUND(SUM(hqla_eligible_amount), 2) AS t FROM ${LIQUIDITY}`);
    expect(num(row.hqla_total)).toBeLessThan(num(all.t));
    expect(num(row.hqla_total)).toBeCloseTo(evaluator.value('hqla_total').v, 2);
  });

  it('rounds money the way the filed table does', async () => {
    // A published view that rounds differently from the pipeline is drift with
    // extra steps — it would reconcile on most days and break on the ones
    // anybody looks at.
    expect(emitViewDdl(view).text).toContain('ROUND(COALESCE(SUM(');
  });

  it('stages derived measures so each can see the one before it', async () => {
    // `lcr_buffer` needs `lcr_pct` needs `net_cash_outflows_30d`. Emitted in
    // document order this is SQL that references an alias declared beside it,
    // which every engine rejects.
    await connection.run(emitViewDdl(view).text);
    const [row] = await run('SELECT lcr_pct, lcr_buffer FROM analytics.liquidity_pit');
    expect(num(row.lcr_buffer)).toBeCloseTo(num(row.lcr_pct) * 1.0473, 2);
  });
});

describe('what it refuses', () => {
  it('names a windowed measure rather than dropping it', async () => {
    // A measure silently missing from a published view is a number that quietly
    // stops existing on somebody's dashboard.
    const plan = emitViewDdl(view);
    const refused = plan.issues.map((i) => i.measure);
    expect(refused).toContain('lcr_dod_change');
    expect(refused).toContain('lcr_vol_30d');
    refused.forEach((m) => expect(plan.published).not.toContain(m));
    plan.issues.forEach((i) => expect(i.reason).toBeTruthy());
  });

  it('refuses a function with no portable SQL rather than approximating it', () => {
    // `ema()` is `x * 0.981` in the browser — fine for a sparkline, and not a
    // definition anybody should publish. Emitting *something* here would be a
    // dashboard that is confidently wrong.
    const bad = expressionToSql('ema(hqla_total)');
    expect(bad.sql).toBe('');
    expect(bad.reason).toMatch(/approximation/);
  });

  it('rewrites scalar max/min rather than emitting a SQL aggregate', () => {
    // `max(a, b)` is scalar in this language and an aggregate in SQL. Passing it
    // through would be a syntax error on some engines and a silent aggregate on
    // others, which is worse.
    expect(expressionToSql('max(a, b)').sql).toBe('GREATEST(a, b)');
    expect(expressionToSql('min(a, b)').sql).toBe('LEAST(a, b)');
  });

  it('passes through what SQL already understands', () => {
    expect(expressionToSql('greatest(a - b, 0)').sql).toBe('greatest(a - b, 0)');
    expect(expressionToSql('100.0 * a / nullif(b, 0)').sql).toBe('100.0 * a / nullif(b, 0)');
    expect(expressionToSql('case when a < 1 then 1 else 0 end').reason).toBeUndefined();
  });

  it('refuses an unknown function by name', () => {
    expect(expressionToSql('wibble(a)').reason).toMatch(/wibble/);
  });
});

describe('the dbt model', () => {
  it('splits simple measures from derived metrics, which is dbt’s own split', () => {
    const plan = emitDbtModel(view);
    expect(plan.text).toContain('semantic_models:');
    expect(plan.text).toContain('metrics:');
    expect(plan.text).toMatch(/- name: lcr_pct\n {4}type: derived/);
    expect(plan.text).toMatch(/- name: hqla_total\n {4}type: simple/);
  });

  it('carries a measure’s filter into its expression', () => {
    // Same failure as the view: a measure published without its `where` is a
    // different measure wearing the same name.
    expect(emitDbtModel(view).text).toContain('CASE WHEN is_encumbered = FALSE THEN');
  });

  it('declares what each derived metric depends on', () => {
    expect(emitDbtModel(view).text).toMatch(/expr: "100\.0 \* hqla_total[^"]*"\n {6}metrics:\n {8}- name: hqla_total/);
  });

  it('refuses the same measures the view does', () => {
    expect(emitDbtModel(view).issues.map((i) => i.measure)).toContain('lcr_vol_30d');
  });
});

describe('the artifact says not to edit it', () => {
  it('warns in both targets, because that is how a fork starts', () => {
    // Somebody will open the generated file and fix a label. The definition it
    // came from keeps changing, this does not, and nothing compares them.
    expect(emitViewDdl(view).text).toMatch(/Regenerate instead/);
    expect(emitDbtModel(view).text).toMatch(/Regenerate rather than edit/);
  });
});
