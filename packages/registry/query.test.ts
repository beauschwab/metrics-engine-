/**
 * The query gateway, against a server that actually speaks Flight SQL.
 *
 * There is no Dremio here and no way to start one, so the alternative was to
 * mock the client and prove nothing. `query/flight_sql_stub.py` implements the
 * protocol instead — handshake, prepared statement, `GetFlightInfo`, `DoGet`,
 * Arrow IPC over gRPC — backed by DuckDB, so the SQL it answers is real SQL.
 *
 * What that proves: the transport, the bearer token, the Arrow decode, the row
 * cap, the truncation flag, and that a refused statement never reaches the
 * network. What it does not prove: Dremio's catalogue naming, its dialect
 * quirks, its access controls, or the wording of its auth errors. Those need a
 * real instance, and that limit is stated here rather than implied by a green
 * test.
 */

import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  QueryFailed, QueryRefused, dremioFromEnv, query, samplingAllowed,
  stratifiedSample, type DremioConfig,
} from './query';

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

const dir = mkdtempSync(join(tmpdir(), 'keel-flight-'));
let stub: ChildProcess | null = null;
let config: DremioConfig;

/**
 * A book with a deliberately lopsided distribution.
 *
 * `WHOLESALE` has hundreds of rows and `PUBLIC_SECTOR` has two. That skew is the
 * point: it is what makes the difference between a uniform sample and a
 * stratified one observable rather than theoretical.
 */
const SEED = `
CREATE SCHEMA alm;
CREATE TABLE alm.positions AS
SELECT
  DATE '2026-06-30' AS as_of_date,
  CASE WHEN i < 400 THEN 'WHOLESALE'
       WHEN i < 460 THEN 'RETAIL'
       WHEN i < 466 THEN 'SMALL_BUSINESS'
       ELSE 'PUBLIC_SECTOR' END AS segment,
  CASE WHEN i % 4 = 0 THEN 'BANK_UK' ELSE 'BANK_US' END AS entity_id,
  (i * 1000.0)::DOUBLE AS balance_usd
FROM generate_series(0, 467) AS t(i);
`;

beforeAll(async () => {
  if (!READY) return;
  const seedFile = join(dir, 'seed.sql');
  writeFileSync(seedFile, SEED);

  // Resolved against this module, not the working directory — the same way
  // `query.ts` reaches `dremio.py`. A cwd-relative path here said
  // `server/query/...` and survived the move to `packages/registry` only
  // because nothing local runs it: this suite skips itself without
  // pyarrow.flight, so it is green everywhere except CI, which installs
  // requirements.txt precisely so it runs.
  stub = spawn('python3', [new URL('query/flight_sql_stub.py', import.meta.url).pathname, '0', seedFile], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  // Port 0, and the stub prints what it got. A fixed port collides with whatever
  // a previous crashed run left listening — a mistake already made once in this
  // repo, and it produced a test reading someone else's database.
  const port = await new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('stub did not report a port')), 30_000);
    stub!.stdout!.once('data', (chunk: Buffer) => {
      clearTimeout(timer);
      resolve(chunk.toString().trim());
    });
    stub!.once('error', reject);
  });

  config = {
    uri: `grpc://127.0.0.1:${port}`,
    token: 'test-pat',
    rowCap: 1000,
    timeoutSeconds: 30,
    insecure: false,
    sampling: 'off',
    sampleAllowlist: [],
  };
}, 60_000);

afterAll(() => {
  stub?.kill('SIGTERM');
  rmSync(dir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------

describe.skipIf(!READY)('reading over Flight SQL', () => {
  it('returns rows and their types', async () => {
    const result = await query(config, 'SELECT segment, COUNT(*) AS n FROM alm.positions GROUP BY 1 ORDER BY 1');
    expect(result.rows.map((r) => r.segment)).toEqual([
      'PUBLIC_SECTOR', 'RETAIL', 'SMALL_BUSINESS', 'WHOLESALE',
    ]);
    expect(result.columns.map((c) => c.name)).toEqual(['segment', 'n']);
    expect(result.elapsedMs).toBeGreaterThan(0);
  });

  it('carries the statement it actually sent', async () => {
    // A result nobody can reproduce is not evidence. The capped statement goes
    // back with the rows.
    const result = await query(config, 'SELECT 1 AS x');
    expect(result.sql).toContain('SELECT 1 AS x');
    expect(result.sql).toContain('LIMIT');
  });

  it('caps rows and says when it did', async () => {
    const result = await query(config, 'SELECT * FROM alm.positions', { rowCap: 10 });
    expect(result.rows).toHaveLength(10);
    expect(result.truncated).toBe(true);
  });

  it('does not claim truncation when the answer was complete', async () => {
    const result = await query(config, 'SELECT * FROM alm.positions LIMIT 5', { rowCap: 10 });
    expect(result.rows).toHaveLength(5);
    expect(result.truncated).toBe(false);
  });

  it('never lets a caller raise the configured ceiling', async () => {
    const tight = { ...config, rowCap: 3 };
    const result = await query(tight, 'SELECT * FROM alm.positions', { rowCap: 10_000 });
    expect(result.rows).toHaveLength(3);
    expect(result.truncated).toBe(true);
  });

  it('surfaces the warehouse’s own error rather than replacing it', async () => {
    // "The query failed" is not something an author can act on.
    await expect(query(config, 'SELECT * FROM alm.nonesuch'))
      .rejects.toThrow(QueryFailed);
    await expect(query(config, 'SELECT * FROM alm.nonesuch'))
      .rejects.toThrow(/nonesuch/i);
  });
});

describe('refusing before connecting', () => {
  const unreachable: DremioConfig = {
    uri: 'grpc://127.0.0.1:1',
    token: '',
    rowCap: 10,
    timeoutSeconds: 5,
    insecure: false,
    sampling: 'off',
    sampleAllowlist: [],
  };

  it('refuses a write without touching the network', async () => {
    // The URI points at a closed port. A `QueryRefused` rather than a connection
    // error is the proof that nothing was dialled — which is what makes the
    // guard a boundary rather than a suggestion.
    await expect(query(unreachable, 'DROP TABLE customers')).rejects.toThrow(QueryRefused);
    await expect(query(unreachable, 'SELECT 1; DELETE FROM t')).rejects.toThrow(QueryRefused);
  });

  it('explains what it refused', async () => {
    await expect(query(unreachable, 'DROP TABLE customers')).rejects.toThrow(/DROP/);
  });
});

describe('stratified sampling', () => {
  it('keeps a bucket a uniform sample would miss', async () => {
    if (!READY) return;

    // 468 rows, of which two are PUBLIC_SECTOR. Take the head and the rare
    // segment is simply absent — and an author checking whether their rules
    // cover it would see a clean coverage report and a gap in production.
    const uniform = await query(config, 'SELECT * FROM alm.positions', { rowCap: 40 });
    const uniformSegments = new Set(uniform.rows.map((r) => r.segment));
    expect(uniformSegments.has('PUBLIC_SECTOR')).toBe(false);

    const sampled = await query(
      config,
      stratifiedSample('alm.positions', ['segment'], 10, 'as_of_date', '2026-06-30'),
      { rowCap: 200 },
    );
    const sampledSegments = new Set(sampled.rows.map((r) => r.segment));
    expect(sampledSegments).toEqual(
      new Set(['WHOLESALE', 'RETAIL', 'SMALL_BUSINESS', 'PUBLIC_SECTOR']),
    );
  });

  it('takes at most the stated number from each stratum', async () => {
    if (!READY) return;
    const sampled = await query(
      config,
      stratifiedSample('alm.positions', ['segment', 'entity_id'], 3, 'as_of_date', '2026-06-30'),
      { rowCap: 200 },
    );
    const per: Record<string, number> = {};
    sampled.rows.forEach((r) => {
      const k = `${r.segment}/${r.entity_id}`;
      per[k] = (per[k] || 0) + 1;
    });
    expect(Object.values(per).every((n) => n <= 3)).toBe(true);
    expect(Object.keys(per).length).toBeGreaterThan(4);
  });

  it('produces a statement the read-only guard accepts', async () => {
    const sql = stratifiedSample('alm.positions', ['segment'], 5, 'as_of_date', '2026-06-30');
    // It is generated, but it still goes through the same door as anything else.
    await expect(query({ ...config, uri: 'grpc://127.0.0.1:1' }, sql))
      .rejects.not.toThrow(QueryRefused);
  });
});

describe('sampling policy', () => {
  const base: DremioConfig = {
    uri: 'grpc://x', token: '', rowCap: 10, timeoutSeconds: 5, insecure: false,
    sampling: 'off', sampleAllowlist: [],
  };

  it('is off unless switched on deliberately', () => {
    // Row-level position data leaving the server is a policy decision, so the
    // default is the conservative one and enabling it is a visible act.
    const v = samplingAllowed(base, 'fr2052a_outflows');
    expect(v.ok).toBe(false);
    expect(v.reason).toContain('KEEL_DREMIO_SAMPLING');
  });

  it('still refuses a view nobody allowlisted', () => {
    const v = samplingAllowed({ ...base, sampling: 'allowlist', sampleAllowlist: ['other'] }, 'fr2052a_outflows');
    expect(v.ok).toBe(false);
    expect(v.reason).toContain('fr2052a_outflows');
  });

  it('allows a view that was named', () => {
    expect(samplingAllowed(
      { ...base, sampling: 'allowlist', sampleAllowlist: ['fr2052a_outflows'] },
      'fr2052a_outflows',
    ).ok).toBe(true);
  });
});

describe('configuration', () => {
  it('is absent until a URI is given', () => {
    expect(dremioFromEnv({})).toBeNull();
  });

  it('defaults to the conservative settings', () => {
    const c = dremioFromEnv({ KEEL_DREMIO_URI: 'grpc+tls://dremio:32010' })!;
    expect(c.sampling).toBe('off');
    expect(c.insecure).toBe(false);
    expect(c.rowCap).toBe(5000);
    expect(c.timeoutSeconds).toBe(30);
  });

  it('reads the allowlist as a list', () => {
    const c = dremioFromEnv({
      KEEL_DREMIO_URI: 'grpc://x',
      KEEL_DREMIO_SAMPLING: 'allowlist',
      KEEL_DREMIO_SAMPLE_VIEWS: ' a , b ,, c ',
    })!;
    expect(c.sampleAllowlist).toEqual(['a', 'b', 'c']);
  });
});
