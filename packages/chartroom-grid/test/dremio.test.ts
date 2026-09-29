/**
 * The Dremio executor against a stub transport (ADR-70): submit, poll,
 * page; refuse parameters; surface a failed job by name.
 */

import { describe, expect, it } from 'vitest';
import { compileSql, DREMIO } from '../src/data/compileSql';
import { createDremioExecutor, dremioSource } from '../src/data/dremioSource';
import { parseView } from '../src/grid/viewState';

function stubDremio(pages: Array<Array<Record<string, unknown>>>, opts: { failWith?: string; runningPolls?: number } = {}) {
  const calls: Array<{ method: string; path: string; body?: unknown; auth?: string }> = [];
  let polls = 0;
  const total = pages.reduce((n, p) => n + p.length, 0);
  const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status, headers: { 'content-type': 'application/json' } });
  const fetchStub: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    const auth = (init?.headers as Record<string, string> | undefined)?.Authorization;
    calls.push({ method: init?.method ?? 'GET', path: url.pathname + url.search, body: init?.body ? JSON.parse(String(init.body)) : undefined, auth });
    if (url.pathname === '/api/v3/sql') return json({ id: 'job-1' });
    if (url.pathname === '/api/v3/job/job-1') {
      if (opts.failWith) return json({ jobState: 'FAILED', errorMessage: opts.failWith });
      polls++;
      return json(polls <= (opts.runningPolls ?? 1) ? { jobState: 'RUNNING' } : { jobState: 'COMPLETED', rowCount: total });
    }
    if (url.pathname === '/api/v3/job/job-1/results') {
      const offset = Number(url.searchParams.get('offset'));
      const limit = Number(url.searchParams.get('limit'));
      const flat = pages.flat();
      return json({ rowCount: total, rows: flat.slice(offset, offset + limit) });
    }
    return json({ error: 'not found' }, 404);
  };
  return { fetch: fetchStub, calls };
}

describe('the Dremio executor', () => {
  it('submits the statement with the token, polls until complete, and pages the results', async () => {
    const rows = Array.from({ length: 7 }, (_, i) => ({ desk: `D${i}`, __count: i }));
    const stub = stubDremio([rows.slice(0, 3), rows.slice(3, 6), rows.slice(6)], { runningPolls: 2 });
    const ex = createDremioExecutor({ baseUrl: 'https://dremio.test/', token: 'pat-1', fetch: stub.fetch, pollMs: 1, pageSize: 3 });
    const out = await ex.run('SELECT 1', []);
    expect(out).toEqual(rows);
    expect(stub.calls[0]).toMatchObject({ method: 'POST', path: '/api/v3/sql', body: { sql: 'SELECT 1' }, auth: 'Bearer pat-1' });
    expect(stub.calls.filter((c) => c.path === '/api/v3/job/job-1').length).toBe(3);
    expect(stub.calls.filter((c) => c.path.startsWith('/api/v3/job/job-1/results')).map((c) => c.path)).toEqual([
      '/api/v3/job/job-1/results?offset=0&limit=3',
      '/api/v3/job/job-1/results?offset=3&limit=3',
      '/api/v3/job/job-1/results?offset=6&limit=3',
    ]);
  });

  it('refuses parameters and names a failed job', async () => {
    const stub = stubDremio([[]], { failWith: 'syntax error near FROM' });
    const ex = createDremioExecutor({ baseUrl: 'https://dremio.test', token: 't', fetch: stub.fetch, pollMs: 1 });
    await expect(ex.run('SELECT ?', ['x'])).rejects.toThrow(/no parameters/);
    await expect(ex.run('SELECT nope', [])).rejects.toThrow(/job-1 failed: syntax error near FROM/);
  });

  it('as a source, sends the compiled Dremio dialect with literals inlined', async () => {
    const stub = stubDremio([[{ __count: 3, asOf: '2026-09-28' }]]);
    const source = dremioSource({ baseUrl: 'https://dremio.test', token: 't', fetch: stub.fetch, pollMs: 1, table: 'treasury.positions' });
    const about = await source.describe();
    expect(about).toMatchObject({ name: 'Dremio', rowCount: 3, asOf: '2026-09-28' });
    expect(stub.calls[0]!.body).toEqual({ sql: 'SELECT COUNT(*) AS "__count", MAX("asOf") AS "asOf" FROM "treasury"."positions"' });
    const view = parseView({ version: 1, columnFilters: [{ id: 'desk', value: ["Cr'edit"] }], grouping: ['currency'] });
    const expected = compileSql(view, { table: 'treasury.positions' }, DREMIO);
    expect(expected.params).toEqual([]);
    stub.calls.length = 0;
    await source.query(view);
    expect(stub.calls[0]!.body).toEqual({ sql: expected.sql });
    expect(expected.sql).toContain(`"desk" IN ('Cr''edit')`);
  });
});
