/**
 * The whole path, end to end: registry → compiler → Flight SQL → rows.
 *
 * This is the test that makes the Dremio connection worth having. It seeds the
 * Flight SQL server with the same position fixture the browser uses, asks the API
 * for the report over the wire, and checks the filed table matches what the
 * in-browser evaluator produced from the same rows — to the cent, because both
 * sides round.
 *
 * That equality is the product claim in one assertion: *the number you verified
 * in the surface is the number the warehouse computes.* Until now that was proved
 * against DuckDB in-process; here it goes through the compiler, the read-only
 * guard, the row cap, gRPC, Arrow IPC, and back.
 *
 * The stub is not Dremio — its catalogue naming, dialect quirks and access
 * controls are untested. The plan, the transport and the reconciliation are not.
 */

import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { handle } from './api';
import { migrate, openSqlite, type Db } from './db';
import { SQLITE } from './dialect';
import { Repository } from './repository';
import { shippedDocuments } from './index';
import type { DremioConfig } from './query';
import { readReport } from 'keel-engine/compile';
import { INITIAL_DOCS } from 'keel-engine/documents';
import { AS_OF, TABLES } from 'keel-engine/fixtures';
import { inferSchema, seedStatements } from 'keel-engine/conformance';
import { parseDoc } from 'keel-engine/parse';
import { buildRegistry } from 'keel-engine/registry';
import { runReport } from 'keel-engine/report';

const SOURCE = 'alm.fct_2052a_positions';

function pythonHas(mod: string): boolean {
  try {
    execFileSync('python3', ['-c', `import ${mod}`], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

const READY =
  pythonHas('pyarrow.flight') && pythonHas('adbc_driver_flightsql') && pythonHas('duckdb');

const dir = mkdtempSync(join(tmpdir(), 'keel-live-'));
let stub: ChildProcess | null = null;
let db: Db;
let repo: Repository;
let dremio: DremioConfig;

beforeAll(async () => {
  if (!READY) return;

  // The warehouse holds exactly the fixture the browser evaluates, so any
  // divergence is the compiler or the transport rather than the data.
  const rows = TABLES.nominal[SOURCE][AS_OF];
  writeFileSync(join(dir, 'seed.sql'), `${seedStatements(SOURCE, rows).join(';\n')};`);

  stub = spawn('python3', ['server/query/flight_sql_stub.py', '0', join(dir, 'seed.sql')], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const port = await new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('stub did not start')), 60_000);
    stub!.stdout!.once('data', (c: Buffer) => {
      clearTimeout(timer);
      resolve(c.toString().trim());
    });
    stub!.once('error', reject);
  });

  dremio = {
    uri: `grpc://127.0.0.1:${port}`,
    token: 'test-pat',
    rowCap: 5000,
    timeoutSeconds: 60,
    insecure: false,
    sampling: 'off',
    sampleAllowlist: [],
  };

  db = await openSqlite(join(dir, 'registry.db'), SQLITE);
  await migrate(db);
  repo = new Repository(db);
  await repo.seed(shippedDocuments());
}, 180_000);

afterAll(async () => {
  stub?.kill('SIGTERM');
  await db?.close();
  rmSync(dir, { recursive: true, force: true });
});

const post = (path: string, body: unknown = {}) =>
  handle(repo, { method: 'POST', path, body }, { dremio });

const get = (path: string) => handle(repo, { method: 'GET', path }, { dremio });

// ---------------------------------------------------------------------------

describe.skipIf(!READY)('reading the filed table from the warehouse', () => {
  it('says what it is connected to, and whether rows may leave', async () => {
    const res = await get('/api/live/status');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ configured: true, sampling: 'off' });
  });

  it('produces the same filed rows the surface showed', async () => {
    const res = await post('/api/live/report/fr2052a_submission');
    expect(res.status).toBe(200);

    const live = res.body as { rows: Array<Record<string, unknown>>; truncated: boolean };
    expect(live.truncated).toBe(false);

    const spec = readReport(parseDoc(INITIAL_DOCS.fr2052a_submission));
    const view = parseDoc(INITIAL_DOCS.fr2052a_outflows);
    const expected = runReport(
      spec, view, buildRegistry(INITIAL_DOCS as unknown as Record<string, string>), 'nominal', AS_OF,
    );

    const key = (r: Record<string, unknown>) =>
      spec.grouping.map((g) => (r[g] === null || r[g] === undefined ? '' : String(r[g]))).join('|');

    const byKey = new Map(live.rows.map((r) => [key(r), r]));
    expect(live.rows).toHaveLength(expected.rows.length);
    expect(expected.rows.length).toBeGreaterThan(20);

    expected.rows.forEach((row) => {
      const there = byKey.get(row.key.join('|'));
      expect(there, `warehouse is missing ${row.key.join(' · ')}`).toBeTruthy();
      expected.measures.forEach((m) => {
        // Both sides round every filed amount to the cent, so this is an
        // equality — the whole claim of the compiler, over a real wire.
        expect(Math.abs(Number(there![m]) - row.values[m]), `${row.key.join(' · ')} ${m}`)
          .toBeLessThanOrEqual(0.001);
      });
    });
  });

  it('never sends the materialize step to the warehouse', async () => {
    // The registry reads. Writing the submission is the pipeline's job, and a
    // definition surface that could write one is a definition surface that can
    // be wrong in production.
    const res = await post('/api/live/report/fr2052a_submission');
    const sent = (res.body as { sql: string }).sql;
    expect(sent).not.toContain('INSERT');
    expect(sent).not.toContain('dynamic_partition_overwrite');
    expect(sent).toContain('SELECT');
  });

  it('reports coverage against real data, unmapped records included', async () => {
    const res = await post('/api/live/coverage/fr2052a_outflows');
    expect(res.status).toBe(200);

    const body = res.body as {
      column: string; countColumn: string; rows: Array<Record<string, unknown>>;
    };
    expect(body.column).toBe('product_id');
    expect(body.countColumn).toBe('records');

    const ids = body.rows.map((r) => r.product_id);
    expect(ids).toContain('O.D.1');
    expect(ids).toContain('O.W.2');
    // Every emitted value the rule set can produce, from production rows, in one
    // aggregate — no position-level data left the warehouse to compute it.
    expect(body.rows.length).toBeGreaterThan(8);

    // The count is the coverage signal, and it has to be a count of records
    // rather than of anything else: summed over the buckets it must be the
    // whole book. A bucket of forty records that net to zero notional is
    // invisible in the amount column and visible here.
    const total = body.rows.reduce((n, r) => n + Number(r.records), 0);
    expect(total).toBe(TABLES.nominal[SOURCE][AS_OF].length);
    expect(body.rows.every((r) => Number(r.records) > 0)).toBe(true);
  });

  it('404s a report or view that does not exist', async () => {
    expect((await post('/api/live/report/nope')).status).toBe(404);
    expect((await post('/api/live/coverage/nope')).status).toBe(404);
  });
});

describe.skipIf(!READY)('what it refuses', () => {
  it('403s a sample while sampling is off', async () => {
    const res = await post('/api/live/sample/fr2052a_outflows', { asOf: AS_OF });
    expect(res.status).toBe(403);
    expect((res.body as { error: string }).error).toContain('KEEL_DREMIO_SAMPLING');
  });

  it('403s a sample for a view nobody allowlisted', async () => {
    const res = await handle(
      repo,
      { method: 'POST', path: '/api/live/sample/fr2052a_outflows', body: { asOf: AS_OF } },
      { dremio: { ...dremio, sampling: 'allowlist', sampleAllowlist: ['something_else'] } },
    );
    expect(res.status).toBe(403);
  });

  it('serves a stratified sample once a view is allowlisted', async () => {
    const res = await handle(
      repo,
      { method: 'POST', path: '/api/live/sample/fr2052a_outflows', body: { asOf: AS_OF, perStratum: 2 } },
      { dremio: { ...dremio, sampling: 'allowlist', sampleAllowlist: ['fr2052a_outflows'] } },
    );
    expect(res.status).toBe(200);

    const body = res.body as { rows: Array<Record<string, unknown>>; strata: string[] };
    // Stratified on what the rules branch on, so a rare combination survives.
    expect(body.strata.length).toBeGreaterThan(0);
    expect(body.strata).toContain('direction');
    expect(body.rows.length).toBeGreaterThan(0);
    expect(body.rows.length).toBeLessThan(TABLES.nominal[SOURCE][AS_OF].length);
  });

  it('503s every live route when no warehouse is configured', async () => {
    const res = await handle(repo, { method: 'GET', path: '/api/live/status' }, {});
    expect(res.status).toBe(503);
    expect((res.body as { error: string }).error).toContain('KEEL_DREMIO_URI');
  });
});

describe('the schema the warehouse is expected to have', () => {
  it('is inferred from the same fixture the surface evaluates', () => {
    // If these drift, the live read and the browser stop being comparable and
    // the equality above would be testing two different tables.
    const schema = inferSchema(TABLES.nominal[SOURCE][AS_OF]);
    const type = (n: string) => schema.find((c) => c.name === n)?.type;
    expect(type('as_of_date')).toBe('DATE');
    expect(type('maturity_date')).toBe('DATE');
    expect(type('balance_usd')).toBe('DOUBLE');
    expect(type('is_secured')).toBe('BOOLEAN');
  });
});
