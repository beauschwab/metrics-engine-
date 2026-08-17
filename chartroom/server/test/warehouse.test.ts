/**
 * The warehouse seam, TS half: the manifest carries everything the Python
 * executor needs (unrounded measure SQL, ordered derived chain, typed
 * fixture tables), and the WarehouseExecutor maps wire outcomes into the
 * QueryService's refusal vocabulary. The numbers themselves are the parity
 * harness's job (pytest, ADR-39).
 */

import { createServer, type Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { WarehouseExecutor } from '../src/executor';
import { fetchRegistryState } from '../src/keel';
import { QueryRefused, QueryUnresolved } from '../src/query';
import { buildManifest, type WarehouseManifest } from '../src/warehouse';

let manifest: WarehouseManifest;
let state: Awaited<ReturnType<typeof fetchRegistryState>>;

beforeAll(async () => {
  state = await fetchRegistryState();
  manifest = buildManifest(state);
});

describe('the manifest', () => {
  it('ships typed fixture tables with every date flattened in', () => {
    const t = manifest.tables.find((x) => x.name === 'alm.fct_liquidity_position')!;
    expect(t.columns.find((c) => c.name === 'as_of_date')!.type).toBe('date');
    expect(t.columns.find((c) => c.name === 'is_encumbered')!.type).toBe('boolean');
    expect(t.rows.length).toBeGreaterThan(manifest.dates.length); // many rows per date
  });

  it('orders measures simple-first then the derived chain, unrounded', () => {
    const doc = manifest.docs.find((d) => d.name === 'liquidity_pit')!;
    const kinds = doc.measures.map((m) => m.kind);
    expect(kinds.indexOf('derived')).toBeGreaterThan(0);
    expect(kinds.slice(kinds.indexOf('derived'))).not.toContain('simple');
    // The BI-facing ROUND wrapper is stripped — the Evaluator never rounds,
    // and the fixture path is the oracle the warehouse must match.
    for (const m of doc.measures.filter((x) => x.kind === 'simple')) {
      expect(m.sql, m.name).not.toMatch(/^ROUND\(/);
    }
    const lcr = doc.measures.find((m) => m.name === 'lcr_pct')!;
    expect(lcr.kind).toBe('derived');
    expect(lcr.format).toBe('percent_1dp');
  });

  it('ships the row stage so derivation-referencing measures compile', () => {
    const doc = manifest.docs.find((d) => d.row_stage.some((c) => c.name === 'days_to_maturity'))!;
    expect(doc, 'some doc should derive days_to_maturity').toBeTruthy();
    for (const c of doc.row_stage) expect(c.sql.length, c.name).toBeGreaterThan(0);
    // Dependency order: the rate lookup reads product_id, so it must follow it.
    const names = doc.row_stage.map((c) => c.name);
    if (names.includes('product_id') && names.includes('outflow_rate')) {
      expect(names.indexOf('outflow_rate')).toBeGreaterThan(names.indexOf('product_id'));
    }
  });

  it('names what the warehouse cannot serve instead of dropping it silently', () => {
    for (const doc of manifest.docs) {
      for (const u of doc.unsupported) {
        expect(u.reason.length, `${doc.name}.${u.name}`).toBeGreaterThan(5);
      }
    }
  });

  it('the workspace hash moves when a revision moves', () => {
    const bumped = {
      ...state,
      docs: state.docs.map((d, i) => (i === 0 ? { ...d, revision: d.revision + 1 } : d)),
    };
    expect(buildManifest(bumped).workspace).not.toBe(manifest.workspace);
  });
});

// ---------------------------------------------------------------------------

const PORT = 8300 + (process.pid % 90);
let fakeAgent: Server;
let lastBody: Record<string, unknown> = {};

beforeAll(async () => {
  fakeAgent = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      lastBody = JSON.parse(Buffer.concat(chunks).toString()) as Record<string, unknown>;
      if ((lastBody.measure as string) === 'refuse_me') {
        res.writeHead(422, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: 'too many groups' }));
        return;
      }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({
        kind: 'scalar', unit: 'percent', format: 'percent_1dp',
        value: 123.4, prior: 120.1, asOf: '2026-06-30',
        cost: { rowsScanned: 10, groups: 1, cache: 'miss' },
      }));
    });
  });
  await new Promise<void>((resolve) => fakeAgent.listen(PORT, resolve));
  process.env.CHARTROOM_AGENT_URL = `http://127.0.0.1:${PORT}`;
});

afterAll(async () => {
  await new Promise((resolve) => fakeAgent.close(resolve));
  delete process.env.CHARTROOM_AGENT_URL;
});

describe('the WarehouseExecutor', () => {
  const rev = () => state.docs.find((d) => d.name === 'liquidity_pit')!.revision;
  const exec = () => new WarehouseExecutor('duckdb', () => state);

  it('resolves params to literal filters before the wire — one resolution path', async () => {
    const r = await exec().run({
      metric: `keel://liquidity_pit.lcr_pct@${rev()}`,
      filters: [{ dim: 'entity_id', op: '=', param: 'entity' }],
      params: { entity: 'BANK_US' },
    });
    expect(r.kind).toBe('scalar');
    expect(lastBody.filters).toEqual([{ dim: 'entity_id', op: '=', value: 'BANK_US' }]);
    expect(lastBody.backend).toBe('duckdb');
  });

  it('refuses a stale pin with the re-pin guidance, before any wire call', async () => {
    await expect(exec().run({ metric: `keel://liquidity_pit.lcr_pct@${rev() + 5}` }))
      .rejects.toThrow(QueryUnresolved);
    await expect(exec().run({ metric: `keel://liquidity_pit.lcr_pct@${rev() + 5}` }))
      .rejects.toThrow(/re-pin/);
  });

  it('maps a 422 into QueryRefused with the backend message', async () => {
    await expect(exec().run({ metric: `keel://liquidity_pit.refuse_me@${rev()}` }))
      .rejects.toThrow(/too many groups/);
  });

  it('an unreachable backend names the fix', async () => {
    process.env.CHARTROOM_AGENT_URL = 'http://127.0.0.1:9';
    try {
      await expect(exec().run({ metric: `keel://liquidity_pit.lcr_pct@${rev()}` }))
        .rejects.toThrow(QueryRefused);
      await expect(exec().run({ metric: `keel://liquidity_pit.lcr_pct@${rev()}` }))
        .rejects.toThrow(/CHARTROOM_BACKEND=fixtures/);
    } finally {
      process.env.CHARTROOM_AGENT_URL = `http://127.0.0.1:${PORT}`;
    }
  });
});
