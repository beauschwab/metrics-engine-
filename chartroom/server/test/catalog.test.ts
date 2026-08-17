/**
 * Phase 10: the catalogs as versioned data, and the escape hatch that writes
 * into them (ADR-46/47).
 *
 * The assertions that carry weight are the ones about *governance*, not
 * plumbing: a widget contract citing a rule the linter cannot emit is a
 * blocker; approving publishes an append-only version; an approved contract
 * with no renderer is a real catalog entry that says it cannot be drawn; and
 * a decision is still refused to an agent identity.
 */

import { beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest';
import { migrate, openSqlite, type Db } from '../../../server/db';
import { CatalogCache, ContractCache, handle, type ApiDeps, type ApiRequest } from '../src/api';
import { chartroomDialect } from '../src/dialect';
import { fetchRegistryState } from '../src/keel';
import { QueryService } from '../src/query';
import { ChartroomRepository } from '../src/repository';
import { seedCatalog } from '../src/seed';

let db: Db;
let deps: ApiDeps;

const req = (
  method: string, path: string, body?: unknown, identity = 'steward-sam',
): ApiRequest => ({ method, path, query: {}, body, identity, principal: identity });

const send = (r: ApiRequest) => handle(r, deps);

beforeAll(async () => {
  db = await openSqlite(':memory:', chartroomDialect('sqlite'));
  await migrate(db);
  const state = await fetchRegistryState();
  const repo = new ChartroomRepository(db);
  await seedCatalog(repo);
  deps = {
    repo,
    contracts: new ContractCache(60_000),
    queries: new QueryService({ state }),
    // No TTL cache in tests: an approval must be visible to the very next
    // request, or the assertions would be timing the cache rather than the code.
    catalog: new CatalogCache(repo, 0),
  };
});

afterAll(async () => db.close());

const WIDGET = (over: Record<string, unknown> = {}) => JSON.stringify({
  widget: 'sankey', version: 1, family: 'part_to_whole',
  accepts: { categorical_dims: { min: 1, max: 2 }, supports: ['filters'] },
  guide_rules: ['PIE-01'],
  description: 'Flows between two dimensions, sized by an additive measure.',
  ...over,
});

const PATTERN = (over: Record<string, unknown> = {}) => JSON.stringify({
  pattern: 'funding-mix', version: 1, title: 'Funding Mix',
  serves: 'Where the funding comes from and how that composition is shifting over time.',
  when_not: 'If the question is whether a limit is breached, use limit-utilization-board.',
  audience_default: 'treasury-committee',
  slots: [
    {
      name: 'mix', families: ['part_to_whole'], count: { min: 1, max: 1 }, required: true,
      intent: 'The composition itself, as bands over the reporting window.',
    },
    {
      name: 'headline', families: ['kpi'], count: { min: 1, max: 2 }, required: false,
      intent: 'The total being decomposed, judged against its prior.',
    },
  ],
  wireframe: '[ stacked-area ]\n[ KPI ][ KPI ]',
  ...over,
});

describe('the catalogs are data (E10.1)', () => {
  it('seeds every shipped widget and pattern, and serving reads the table', async () => {
    const widgets = await send(req('GET', '/api/widgets'));
    expect(widgets.status).toBe(200);
    const names = (widgets.body as { widgets: Array<{ widget: string }> }).widgets
      .map((w) => w.widget);
    expect(names).toContain('kpi-tile');
    expect(names).toContain('waterfall');
    expect(names.length).toBe(12);

    const patterns = await send(req('GET', '/api/patterns'));
    expect((patterns.body as { patterns: unknown[] }).patterns.length).toBe(6);
  });

  it('seeding twice adds nothing — a reviewed contract is never rewritten', async () => {
    const again = await deps.repo.seedCatalog([
      { kind: 'widget', name: 'kpi-tile', version: 1, body: { tampered: true } },
    ]);
    expect(again).toEqual([]);
    const entry = await deps.repo.catalogEntry('widget', 'kpi-tile', 1);
    expect((entry!.body as { tampered?: boolean }).tampered).toBeUndefined();
  });

  it('exposes provenance — what came from code and what from a proposal', async () => {
    const r = await send(req('GET', '/api/catalog/widget'));
    const entries = (r.body as { entries: Array<{ source: string; renderable: boolean }> }).entries;
    expect(entries.every((e) => e.source === 'code')).toBe(true);
    expect(entries.every((e) => e.renderable)).toBe(true);
  });
});

describe('widget proposals (E10.2)', () => {
  beforeEach(async () => {
    await db.run('DELETE FROM chartroom_proposal');
  });

  it('refuses a contract citing a rule the linter cannot emit', async () => {
    const r = await send(req('POST', '/api/proposals', {
      id: 'p-bad-rule', artifact_type: 'widget',
      contract: WIDGET({ guide_rules: ['PIE-01', 'FOO-99'] }),
      rationale: 'a flow diagram for funding composition, reviewed by design',
    }));
    expect(r.status).toBe(201);
    const blockers = (r.body as { blockers: string[] }).blockers;
    expect(blockers.some((b) => b.includes('FOO-99'))).toBe(true);
    // And it cannot be submitted while that stands.
    const s = await send(req('POST', '/api/proposals/p-bad-rule/submit', {}));
    expect(s.status).toBe(422);
  });

  it('refuses a version that already exists — the catalog is append-only', async () => {
    const r = await send(req('POST', '/api/proposals', {
      id: 'p-taken', artifact_type: 'widget',
      contract: WIDGET({ widget: 'bar', version: 1 }),
      rationale: 'trying to redefine bar@1 in place, which must not be possible',
    }));
    expect((r.body as { blockers: string[] }).blockers.some((b) => b.includes('append-only')))
      .toBe(true);
  });

  it('approves a clean contract into a new catalog version, flagged unrenderable', async () => {
    const created = await send(req('POST', '/api/proposals', {
      id: 'p-sankey', artifact_type: 'widget', contract: WIDGET(),
      rationale: 'funding flows between source and tenor, for the committee pack',
    }, 'agent:mcp-1'));
    expect((created.body as { blockers: string[] }).blockers).toEqual([]);

    await send(req('POST', '/api/proposals/p-sankey/submit', {}, 'agent:mcp-1'));

    // An agent cannot decide — the design steward is a human (ADR-24).
    const refused = await send(req('POST', '/api/proposals/p-sankey/decide', {
      decision: 'approve', comment: 'looks fine to me',
    }, 'agent:mcp-1'));
    expect(refused.status).toBe(403);
    expect(String((refused.body as { error: string }).error)).toContain('design steward');

    const decided = await send(req('POST', '/api/proposals/p-sankey/decide', {
      decision: 'approve', comment: 'reviewed against the guide; ships contract-first',
    }));
    expect(decided.status).toBe(200);

    const entry = await deps.repo.catalogEntry('widget', 'sankey', 1);
    expect(entry).toBeTruthy();
    expect(entry!.source).toBe('p-sankey');
    // Contract-first: approved as a catalog entry, honestly marked undrawable.
    expect(entry!.renderable).toBe(false);

    const listed = await send(req('GET', '/api/widgets'));
    expect((listed.body as { unrenderable: string[] }).unrenderable).toContain('sankey@1');
  });

  it('the approved widget is a real widget to the linter', async () => {
    // REF-01 blocks an unknown type ref; after approval, sankey@1 resolves.
    const spec = {
      chartroom: '0.1',
      dashboard: {
        id: 'flow-board', title: 'Flow board',
        pattern: { none: { justification: 'exercising a newly approved widget contract' } },
        audience: 'alm-analyst', cadence: 'eod', status: 'draft',
      },
      context: {},
      layout: { grid: { cols: 12, row_height: 96 } },
      widgets: [{
        id: 'flows', type: 'sankey@1', pos: { x: 0, y: 0, w: 6, h: 4 },
        bind: { metric: 'keel://liquidity_pit.hqla_total@1', dims: ['entity_id'] },
      }],
      interactions: [],
    };
    const r = await send(req('POST', '/api/lint', { spec }));
    expect(r.status).toBe(200);
    const findings = (r.body as { report: { findings: Array<{ rule: string }> } }).report.findings;
    expect(findings.filter((f) => f.rule === 'REF-01')).toEqual([]);
  });
});

describe('pattern proposals (E10.2)', () => {
  it('refuses a pattern where nothing is required', async () => {
    const loose = JSON.parse(PATTERN()) as { slots: Array<{ required: boolean }> };
    loose.slots.forEach((s) => { s.required = false; });
    const r = await send(req('POST', '/api/proposals', {
      id: 'p-loose', artifact_type: 'pattern', contract: JSON.stringify(loose),
      rationale: 'a pattern that constrains nothing, which should not be acceptable',
    }));
    expect((r.body as { blockers: string[] }).blockers.some((b) => b.includes('constrains nothing')))
      .toBe(true);
  });

  it('approves a well-formed archetype into the catalog', async () => {
    await send(req('POST', '/api/proposals', {
      id: 'p-mix', artifact_type: 'pattern', contract: PATTERN(),
      rationale: 'the funding-composition question recurs and has no archetype yet',
    }));
    await send(req('POST', '/api/proposals/p-mix/submit', {}));
    const decided = await send(req('POST', '/api/proposals/p-mix/decide', {
      decision: 'approve', comment: 'reviewed; slots match the shipped families',
    }));
    expect(decided.status).toBe(200);

    const served = await send(req('GET', '/api/patterns'));
    const names = (served.body as { patterns: Array<{ pattern: string }> }).patterns
      .map((p) => p.pattern);
    expect(names).toContain('funding-mix');

    // A pattern is a layout, not a renderer — nothing to implement, so it is
    // renderable on arrival, unlike a contract-first widget.
    const entry = await deps.repo.catalogEntry('pattern', 'funding-mix', 1);
    expect(entry!.renderable).toBe(true);
  });
});
