/**
 * The documented client example, executed.
 *
 * `clients/python/` is the answer to "how do I call the registry for
 * transformation logic at run time" — and documentation that is not executed
 * is aspiration. So this test runs the real thing, whole: a real HTTP server
 * on a real port, a binding saved over the API, a release cut and promoted,
 * and the shipped example script running the deployed plan on a DuckDB whose
 * table is shaped like Murex, not like the canonical source.
 *
 * The final assertion is the product claim across the entire path: the numbers
 * the client files from its differently-named, differently-coded table equal
 * the numbers the authoring surface showed, to the cent. Rules → release →
 * channel → HTTP → adapter → client engine, one identity.
 */

import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { INITIAL_DOCS } from '../src/engine/documents';
import { AS_OF, TABLES, type Row } from '../src/engine/fixtures';
import { inferSchema, seedStatements } from '../src/engine/conformance';
import { parseDoc } from '../src/engine/parse';
import { buildRegistry } from '../src/engine/registry';
import { readReport } from '../src/engine/compile';
import { runReport } from '../src/engine/report';

const SOURCE = 'alm.fct_2052a_positions';

function pythonHas(mod: string): boolean {
  try {
    execFileSync('python3', ['-c', `import ${mod}`], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

const READY = pythonHas('duckdb');

const freePort = (): Promise<number> =>
  new Promise((resolve, reject) => {
    const srv = createServer();
    srv.listen(0, () => {
      const address = srv.address();
      srv.close(() => (typeof address === 'object' && address
        ? resolve(address.port)
        : reject(new Error('no port'))));
    });
  });

/**
 * The binding under test — the same one the runtime suite uses, and the
 * columns/vocabulary the client table below is generated to match.
 */
const MUREX_BINDING = `version: 1
kind: source_binding
name: murex_eu
binds: ${SOURCE}
table: murex.v_liq_positions

columns:
  - canonical: as_of_date
    column: COB_DATE
  - canonical: balance_usd
    column: BAL_AMT_USD
  - canonical: maturity_date
    column: MAT_DATE
  - canonical: segment
    column: CUST_SEG
    map: {RTL: RETAIL, SBB: SMALL_BUSINESS, WSL: WHOLESALE}
  - canonical: direction
    column: FLOW_DIR
    map: {I: INFLOW, O: OUTFLOW}
  - canonical: insured_flag
    column: FDIC_INS
  - canonical: is_secured
    column: SECURED_FLG
  - canonical: counterparty_type
    column: CPTY_TYPE
  - canonical: account_type
    column: ACCT_TYPE
  - canonical: collateral_class
    column: COLL_CLASS
  - canonical: currency
    column: CCY
  - canonical: entity_id
    column: LEGAL_ENT
`;

/** canonical column → client column, plus reversed vocabularies. */
const RENAME: Record<string, string> = {
  as_of_date: 'COB_DATE', balance_usd: 'BAL_AMT_USD', maturity_date: 'MAT_DATE',
  segment: 'CUST_SEG', direction: 'FLOW_DIR', insured_flag: 'FDIC_INS',
  is_secured: 'SECURED_FLG', counterparty_type: 'CPTY_TYPE',
  account_type: 'ACCT_TYPE', collateral_class: 'COLL_CLASS',
  currency: 'CCY', entity_id: 'LEGAL_ENT',
};
const REVERSED: Record<string, Record<string, string>> = {
  segment: { RETAIL: 'RTL', SMALL_BUSINESS: 'SBB', WHOLESALE: 'WSL' },
  direction: { INFLOW: 'I', OUTFLOW: 'O' },
};

/**
 * The fixture, as Murex would hold it: client names, client codes. Columns the
 * binding does not map are dropped — a client table does not carry fields it
 * never had, and the adapter must not need them.
 */
function murexRows(): Row[] {
  return TABLES.nominal[SOURCE][AS_OF].map((row) => {
    // Built loose and cast once: `Row` declares the canonical columns as
    // required, and a client table by definition has none of them.
    const out: Record<string, unknown> = {};
    Object.entries(RENAME).forEach(([canonical, client]) => {
      const value = row[canonical];
      const reversed = REVERSED[canonical];
      out[client] = reversed && typeof value === 'string' ? reversed[value] ?? value : value;
    });
    return out as unknown as Row;
  });
}

const dir = mkdtempSync(join(tmpdir(), 'keel-client-'));
let server: ChildProcess | null = null;
let base = '';

async function api(method: string, path: string, body?: unknown) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: { 'content-type': 'application/json' },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  return { status: response.status, body: await response.json() };
}

beforeAll(async () => {
  if (!READY) return;

  const port = await freePort();
  base = `http://127.0.0.1:${port}`;
  server = spawn('npx', ['tsx', 'server/index.ts'], {
    env: {
      ...process.env,
      KEEL_PORT: String(port),
      KEEL_SQLITE_FILE: join(dir, 'registry.db'),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  // Up when the health check answers — the same probe the surface uses.
  const deadline = Date.now() + 60_000;
  for (;;) {
    try {
      const res = await fetch(`${base}/api/health`);
      if (res.ok) break;
    } catch {
      // not yet
    }
    if (Date.now() > deadline) throw new Error('registry did not start');
    await new Promise((r) => setTimeout(r, 250));
  }

  // Everything over the API, the way an integrator would do it: bind the
  // client system, cut a release, promote it.
  const saved = await api('PUT', '/api/artifacts/murex_eu', {
    kind: 'source_binding', body: MUREX_BINDING, message: 'bind the Murex EU book',
  });
  expect(saved.status).toBe(200);
  const release = await api('POST', '/api/releases', { message: 'first deployable' });
  expect(release.status).toBe(201);
  const promoted = await api('PUT', '/api/channels/production', {
    version: (release.body as { version: number }).version, message: 'go live',
  });
  expect(promoted.status).toBe(200);
}, 120_000);

afterAll(() => {
  server?.kill('SIGTERM');
  rmSync(dir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------

describe.skipIf(!READY)('the shipped Python client, end to end', () => {
  it('files the surface’s numbers from a Murex-shaped table', () => {
    // A DuckDB holding only the client's shape — canonical names nowhere.
    //
    // Not `murex.duckdb`: DuckDB attaches a database file under its basename as
    // a catalog, which would collide with the `murex` schema the client table
    // lives in and make every reference ambiguous. Worth knowing when writing
    // the real thing, and nothing to do with the registry.
    const dbPath = join(dir, 'client.duckdb');
    const seed = seedStatements('murex.v_liq_positions', murexRows()).join(';\n');
    const seedPath = join(dir, 'seed.sql');
    writeFileSync(seedPath, seed);
    execFileSync('python3', ['-c', `
import duckdb
c = duckdb.connect(${JSON.stringify(dbPath)})
c.execute(open(${JSON.stringify(seedPath)}).read())
`], { stdio: 'inherit' });

    // The documented example, exactly as documented.
    const out = execFileSync('python3', [
      'clients/python/run_2052a_duckdb.py',
      '--base', base,
      '--channel', 'production',
      '--report', 'fr2052a_submission',
      '--binding', 'murex_eu',
      '--db', dbPath,
    ], { encoding: 'utf8', cwd: process.cwd() });

    const filed = JSON.parse(out) as {
      release: number;
      rows: Array<Record<string, unknown>>;
    };
    expect(filed.release).toBe(1);

    // The same report, evaluated by the authoring surface on the canonical
    // fixture. Equality here spans rules → release → HTTP → adapter → DuckDB.
    const docs = INITIAL_DOCS as unknown as Record<string, string>;
    const spec = readReport(parseDoc(docs.fr2052a_submission));
    const expected = runReport(
      spec, parseDoc(docs.fr2052a_outflows), buildRegistry(docs), 'nominal', AS_OF,
    );

    expect(filed.rows).toHaveLength(expected.rows.length);
    expect(expected.rows.length).toBeGreaterThan(20);

    const key = (r: Record<string, unknown>) =>
      spec.grouping.map((g) => String(r[g] ?? '')).join('|');
    const byKey = new Map(filed.rows.map((r) => [key(r), r]));

    expected.rows.forEach((row) => {
      const there = byKey.get(row.key.join('|'));
      expect(there, `client is missing ${row.key.join(' · ')}`).toBeTruthy();
      expected.measures.forEach((measure) => {
        expect(
          Math.abs(Number(there![measure]) - row.values[measure]),
          `${row.key.join(' · ')} ${measure}`,
        ).toBeLessThanOrEqual(0.001);
      });
    });
  }, 120_000);

  it('tells the client, in its own words, when a binding is unfaithful', async () => {
    // Break the vocabulary and ask again: the refusal arrives as a readable
    // message naming the value no client code can produce — before anything
    // runs in the client's engine.
    const broken = MUREX_BINDING.replace(
      'map: {RTL: RETAIL, SBB: SMALL_BUSINESS, WSL: WHOLESALE}',
      'map: {RTL: RETAIL, WSL: WHOLESALE}',
    );
    await api('PUT', '/api/artifacts/murex_eu', {
      kind: 'source_binding', body: broken, message: 'drop SBB by mistake',
    });
    const release = await api('POST', '/api/releases', { message: 'oops' });
    await api('PUT', '/api/channels/staging', {
      version: (release.body as { version: number }).version, message: 'stage it',
    });

    const res = await fetch(
      `${base}/api/runtime/staging/plan/fr2052a_submission?binding=murex_eu`,
    );
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toMatch(/SMALL_BUSINESS/);

    // And production is untouched — staging's mistake stayed in staging.
    const prod = await fetch(`${base}/api/runtime/production/plan/fr2052a_submission?binding=murex_eu`);
    expect(prod.status).toBe(200);
  });
});

describe('the client-shaped fixture', () => {
  it('genuinely has no canonical names in it', () => {
    // If the transform leaked a canonical column, the equality above would be
    // testing less than it claims.
    const schema = inferSchema(murexRows());
    const names = schema.map((c) => c.name);
    expect(names).toContain('BAL_AMT_USD');
    expect(names).not.toContain('balance_usd');
    expect(names).not.toContain('segment');
    const segments = new Set(murexRows().map((r) => r.CUST_SEG));
    expect([...segments].sort()).toEqual(['RTL', 'SBB', 'WSL']);
  });
});
