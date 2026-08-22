/**
 * The exception strip's value-level rows (ADR-55).
 *
 * The claim under test: the strip's breach rows come from the registry's own
 * variance monitors, run by the same engine the authoring surface uses — so a
 * threshold shown in the strip is a threshold a steward can open, cited and
 * effective-dated, never a number typed into the studio.
 */

import { describe, expect, it } from 'vitest';
import { parseDoc } from 'keel-engine/parse';
import { readMonitor, runMonitor } from 'keel-engine/variance';
import { readReport } from 'keel-engine/compile';
import { buildRegistry } from 'keel-engine/registry';
import { AS_OF, DATES } from 'keel-engine/fixtures';
import { openSqlite, migrate, type Db } from 'keel-registry/db';
import { fetchRegistryState } from '../src/keel';
import { monitorExceptions } from '../src/monitor';
import { CatalogCache, ContractCache, handle, type ApiDeps } from '../src/api';
import { chartroomDialect } from '../src/dialect';
import { QueryService } from '../src/query';
import { ChartroomRepository } from '../src/repository';

const state = await fetchRegistryState();

describe('monitor exceptions', () => {
  it('agrees with the engine run it claims to be', () => {
    // Recompute by hand from the same documents; the endpoint may not have an
    // opinion of its own.
    const docs = Object.fromEntries(state.docs.map((d) => [d.name, d.body]));
    const graphs = Object.values(docs).map((d) => parseDoc(d));
    const monitorGraph = graphs.find((g) => g.kind === 'variance_monitor')!;
    const monitor = readMonitor(monitorGraph);
    const report = readReport(graphs.find((g) => g.docName === monitor.report)!);
    const view = graphs.find((g) => g.kind === 'metrics_view' && g.docName === report.view)!;
    const direct = runMonitor(monitor, report, view, buildRegistry(docs), 'nominal', DATES)
      .breaches.filter((b) => b.date === AS_OF);

    const rows = monitorExceptions(state, null);
    expect(rows).toHaveLength(direct.length);
    expect(rows.length).toBeGreaterThan(0);
    rows.forEach((r, i) => {
      expect(r.threshold).toBe(direct[i].evaluation.threshold.id);
      expect(r.severity).toBe(direct[i].evaluation.threshold.severity);
      expect(r.date).toBe(AS_OF);
    });
  });

  it('answers for the date asked, and falls back to the latest close', () => {
    // A date with recorded breaches earlier in the window.
    const withSome = DATES.find((d) => monitorExceptions(state, d).length > 0)!;
    expect(withSome).toBeTruthy();
    monitorExceptions(state, withSome).forEach((r) => expect(r.date).toBe(withSome));
    // An unknown date resolves to the latest close rather than a stack trace —
    // the same posture the query layer takes for a stale bookmark.
    const fallback = monitorExceptions(state, '1999-01-01');
    expect(fallback.map((r) => r.date)).toEqual(
      monitorExceptions(state, null).map((r) => r.date),
    );
  });

  it('a monitor whose report is missing contributes nothing rather than a 500', () => {
    const docs = state.docs.filter((d) => d.name !== 'fr2052a_submission');
    const rows = monitorExceptions({ ...state, docs }, null);
    expect(rows).toEqual([]);
  });

  it('every message names the threshold and the limit it was judged against', () => {
    for (const r of monitorExceptions(state, null)) {
      expect(r.message).toContain(r.threshold);
      expect(r.message).toContain('limit');
      expect(Number.isFinite(r.limit)).toBe(true);
    }
  });
});

describe('GET /api/exceptions', () => {
  it('serves the monitor rows over the API', async () => {
    const db: Db = await openSqlite(':memory:', chartroomDialect('sqlite'));
    await migrate(db);
    const repo = new ChartroomRepository(db);
    const deps: ApiDeps = {
      repo,
      contracts: new ContractCache(60_000),
      queries: new QueryService({ state }),
      catalog: new CatalogCache(repo),
    };
    const res = await handle({ method: 'GET', path: '/api/exceptions' }, deps);
    expect(res.status).toBe(200);
    const body = res.body as { exceptions: Array<{ threshold: string }> };
    expect(body.exceptions.length).toBeGreaterThan(0);
    expect(body.exceptions[0].threshold).toBeTruthy();
    await db.close();
  });
});
