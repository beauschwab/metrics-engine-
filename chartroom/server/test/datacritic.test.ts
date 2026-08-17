/**
 * The data critic: the real QueryService proves a healthy dashboard clean
 * (conservation included — the checks run, they just find nothing), and a
 * stubbed service proves each finding fires with its evidence. Stubs are the
 * honest tool here: the engine is deliberately hard to catch violating
 * conservation, and a critic tested only against a well-behaved engine would
 * have untested teeth.
 */

import { beforeAll, describe, expect, it } from 'vitest';
import type { DashboardSpec } from 'chartroom-spec';
import { dataCritique, legsOf } from '../src/datacritic';
import { fetchRegistryState } from '../src/keel';
import { QueryService, type QueryResult } from '../src/query';

let queries: QueryService;
let ref: (m: string) => string;
let contracts: Map<string, { allowed_aggregations: string[] }>;

beforeAll(async () => {
  const state = await fetchRegistryState();
  const rev = state.docs.find((d) => d.name === 'liquidity_pit')!.revision;
  ref = (m: string) => `keel://liquidity_pit.${m}@${rev}`;
  queries = new QueryService({ state });
  contracts = new Map([
    [ref('hqla_total'), { allowed_aggregations: ['sum'] }],
    [ref('lcr_pct'), { allowed_aggregations: [] }],
    [ref('lcr_stress'), { allowed_aggregations: [] }],
  ]);
});

const SPEC: DashboardSpec = {
  chartroom: '0.1',
  dashboard: {
    id: 'critiqued', title: 'Critiqued', pattern: { none: { justification: 'a test dashboard' } },
    audience: 'alm-analyst', cadence: 'eod', status: 'draft',
  },
  context: {},
  layout: { grid: { cols: 12, row_height: 96 } },
  widgets: [
    {
      id: 'headline', type: 'kpi-tile@1', pos: { x: 0, y: 0, w: 3, h: 2 },
      bind: { metric: 'keel://liquidity_pit.lcr_pct@1', compare: { vs: 'prior_period', style: 'delta' } },
    },
    {
      id: 'by-entity', type: 'bar@1', pos: { x: 3, y: 0, w: 9, h: 4 },
      bind: { metric: 'keel://liquidity_pit.hqla_total@1', dims: ['entity_id'] },
    },
    {
      id: 'trend', type: 'timeseries@1', pos: { x: 0, y: 4, w: 12, h: 4 },
      bind: {
        metric: 'keel://liquidity_pit.lcr_pct@1', dims: ['as_of_date'],
        window: { trailing: '30d' }, bands: ['keel://liquidity_pit.lcr_stress@1'],
      },
    },
  ],
  interactions: [],
};

describe('over the real engine', () => {
  it('a healthy dashboard is clean, with conservation actually exercised', async () => {
    const r = await dataCritique(SPEC, queries, contracts);
    expect(r.findings).toEqual([]);
    expect(r.widgetsChecked).toBe(3);
    // Every widget answered, at one as-of.
    expect(Object.keys(r.asOf).sort()).toEqual(['by-entity', 'headline', 'trend']);
    expect(new Set(Object.values(r.asOf)).size).toBe(1);
  });

  it('resolves every leg the studio would run — compare and bands included', () => {
    const legs = legsOf(SPEC);
    expect(legs.map((l) => l.role).sort()).toEqual(['band', 'main', 'main', 'main']);
  });

  it('an unresolvable binding is a finding, not a crash', async () => {
    const broken = structuredClone(SPEC);
    broken.widgets[0].bind.metric = 'keel://liquidity_pit.no_such@1';
    const r = await dataCritique(broken, queries, contracts);
    const f = r.findings.find((x) => x.code === 'QUERY');
    expect(f?.widget).toBe('headline');
    expect(f?.severity).toBe('BLOCK');
  });
});

// ---------------------------------------------------------------------------
// Stubbed service: each check's teeth.
// ---------------------------------------------------------------------------

const scalar = (value: number, asOf = '2025-06-30'): QueryResult => ({
  kind: 'scalar', unit: 'USD', format: 'currency_usd', value, prior: value,
  asOf, cost: { rowsScanned: 0, groups: 0, cache: 'miss' },
});
const groups = (values: number[], asOf = '2025-06-30'): QueryResult => ({
  kind: 'groups', unit: 'USD', format: 'currency_usd',
  rows: values.map((v, i) => ({ key: { entity_id: `E${i}` }, value: v, prior: v })),
  asOf, cost: { rowsScanned: 0, groups: values.length, cache: 'miss' },
});

const stub = (fn: (req: { metric: string; dims?: string[] }) => QueryResult): QueryService =>
  ({ run: async (req: { metric: string; dims?: string[] }) => fn(req) }) as unknown as QueryService;

const ONE_BAR: DashboardSpec = {
  ...structuredClone(SPEC),
  widgets: [SPEC.widgets[1]], // just the grouped bar over the additive measure
};

describe('with a misbehaving backend', () => {
  it('MASS-01: groups that do not sum to the headline, with both numbers', async () => {
    const s = stub((req) => (req.dims?.length ? groups([60, 30]) : scalar(100)));
    const r = await dataCritique(ONE_BAR, s, contracts);
    const f = r.findings.find((x) => x.code === 'MASS-01');
    expect(f?.severity).toBe('BLOCK');
    expect(f?.evidence).toMatchObject({ groupedSum: 90, headline: 100 });
  });

  it('COHERE-01: two widgets answering on different days', async () => {
    const s = stub((req) => (req.metric.includes('lcr_pct')
      ? scalar(98, '2025-06-30')
      : groups([60, 40], '2025-06-27')));
    const two = structuredClone(SPEC);
    two.widgets = [SPEC.widgets[0], SPEC.widgets[1]];
    const r = await dataCritique(two, s, contracts);
    const f = r.findings.find((x) => x.code === 'COHERE-01');
    expect(f?.severity).toBe('BLOCK');
    expect(Object.keys(f?.evidence ?? {}).sort()).toEqual(['2025-06-27', '2025-06-30']);
  });

  it('FIN-01: a NaN names its cell', async () => {
    const s = stub((req) => (req.dims?.length ? groups([60, NaN]) : scalar(60 + NaN)));
    const r = await dataCritique(ONE_BAR, s, contracts);
    const f = r.findings.find((x) => x.code === 'FIN-01');
    expect(f?.severity).toBe('BLOCK');
    expect((f?.evidence as { cells: string[] }).cells).toContain('E1');
  });

  it('MASS-01 stays quiet for a non-additive measure — per-group ratios are not a partition', async () => {
    const ratioBar = structuredClone(ONE_BAR);
    ratioBar.widgets[0].bind.metric = 'keel://liquidity_pit.lcr_pct@1';
    const s = stub((req) => (req.dims?.length ? groups([98, 104]) : scalar(101)));
    const r = await dataCritique(ratioBar, s, contracts);
    expect(r.findings.filter((x) => x.code === 'MASS-01')).toEqual([]);
  });
});
