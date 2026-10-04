/**
 * The gallery's planning and shaping (ADR-92), without a renderer: a
 * selection becomes a governed binding per kind or the linter's reason, and
 * resolved widget data becomes the rows an Evil chart reads — keyed safely,
 * ordered as BAR-02 says, refusing a negative part.
 */

import { describe, expect, it } from 'vitest';
import { lint, type DashboardSpec, type MetricContract, type WidgetInstance } from 'chartroom-spec';
import type { WidgetData } from 'chartroom-widgets';
import { CATALOG_BY_REF } from 'chartroom-widgets/contracts';
import {
  CHART_KINDS, chartOptions, chartState, planCharts, stackRefusal,
  categoryTable, configFor, flowTable, isRefusal, partsTable, priorTable, timeTable,
  type ChartSelection, type PlanMetric,
} from '../src/index';
import { CHART_COMPONENTS } from '../src/index';

const GRID: WidgetInstance = {
  id: 'outflow-table', type: 'grid@1', pos: { x: 0, y: 7, w: 12, h: 4 },
  bind: { metric: 'keel://lcr/weighted_outflows_30d@1', dims: ['entity_id', 'maturity_bucket'], filters: [{ dim: 'entity_id', op: '!=', value: 'WF-X' }] },
};
const OUTFLOWS: PlanMetric = {
  measure: 'weighted_outflows_30d', format: 'currency_usd', allowed_aggregations: ['sum'],
  dims: [
    { name: 'as_of_date', type: 'time', ordinal: false },
    { name: 'entity_id', type: 'categorical', ordinal: false, values: ['WF-US', 'WF-UK', 'WF-EU', 'WF-AP'] },
    { name: 'maturity_bucket', type: 'categorical', ordinal: true, values: ['O/N', '1W', '1M', '3M', '6M', '1Y'] },
  ],
};
const SELECTION: ChartSelection = {
  dims: [
    { id: 'entity_id', label: 'Entity id', values: ['WF-US', 'WF-UK', 'WF-EU'] },
    { id: 'maturity_bucket', label: 'Maturity bucket', values: ['O/N', '1W'] },
  ],
  measures: [{ id: 'value', label: 'Weighted outflows 30d' }],
};
const plan = (selection = SELECTION, metric: PlanMetric | undefined = OUTFLOWS) =>
  Object.fromEntries(planCharts({ source: GRID, metric, selection, id: 'chart-1', pos: { x: 0, y: 11, w: 6, h: 4 } }).map((c) => [c.spec.kind, c]));

describe('the gallery', () => {
  it('names ten kinds, each a catalog contract the studio can draw, with options that default to one of their values', () => {
    expect(CHART_KINDS).toHaveLength(10);
    for (const k of CHART_KINDS) {
      expect(CATALOG_BY_REF.get(k.type), k.type).toBeDefined();
      expect(CATALOG_BY_REF.get(k.type)!.renderer).toBe('host');
      expect(CHART_COMPONENTS[k.type], k.type).toBeDefined();
      for (const o of k.options) expect(o.values, `${k.kind}.${o.key}`).toContain(o.default);
    }
    expect(Object.keys(CHART_COMPONENTS).sort()).toEqual(CHART_KINDS.map((k) => k.type).sort());
  });

  it('a meaning is a type, never an option: every stacking kind is part-to-whole, nothing else stacks', () => {
    const stacks = CHART_KINDS.filter((k) => k.options.some((o) => o.key === 'stack')).map((k) => k.type);
    expect(stacks.sort()).toEqual(['evil-stacked-area@1', 'evil-stacked-bar@1']);
    for (const t of stacks) expect(CATALOG_BY_REF.get(t)!.family).toBe('part_to_whole');
    expect(CATALOG_BY_REF.get('evil-pie@1')!.family).toBe('part_to_whole');
    expect(CATALOG_BY_REF.get('evil-sankey@1')!.family).toBe('part_to_whole');
  });

  it('reads options back from state, keeping a listed value and defaulting anything else', () => {
    const state = chartState({ variant: 'hatched', layout: 'sideways' });
    expect(chartOptions('evil-bar@1', state)).toMatchObject({ variant: 'hatched', layout: 'vertical', glow: 'off' });
    expect(chartOptions('evil-bar@1', undefined).variant).toBe('default');
    expect(chartOptions('kpi-tile@1', state)).toEqual({});
  });
});

describe('planning a selection', () => {
  it('binds the grid’s metric, its filters and the selected values — a governed binding, not a snapshot', () => {
    const bar = plan()['evil-bar']!;
    expect(bar.ok).toBe(true);
    if (!bar.ok) return;
    expect(bar.instance).toMatchObject({
      id: 'chart-1', type: 'evil-bar@1', pos: { x: 0, y: 11, w: 6, h: 4 },
      bind: {
        metric: GRID.bind.metric,
        dims: ['entity_id', 'maturity_bucket'],
        sort: 'value',
        filters: [
          { dim: 'entity_id', op: '!=', value: 'WF-X' },
          { dim: 'entity_id', op: 'in', value: ['WF-US', 'WF-UK', 'WF-EU'] },
          { dim: 'maturity_bucket', op: 'in', value: ['O/N', '1W'] },
        ],
      },
      state: { chart: { variant: 'default', layout: 'vertical' } },
    });
    expect(bar.instance.title).toBe('weighted_outflows_30d by Entity id and Maturity bucket');
  });

  it('a selection naming every value of a dimension narrows nothing on it', () => {
    const all = { ...SELECTION, dims: [{ ...SELECTION.dims[0]!, values: ['WF-US', 'WF-UK', 'WF-EU', 'WF-AP'] }] };
    const bar = plan(all)['evil-bar']!;
    expect(bar.ok && bar.instance.bind.filters).toEqual([{ dim: 'entity_id', op: '!=', value: 'WF-X' }]);
  });

  it('sorts an ordinal dimension by itself (BAR-02) and draws lines over the window with the time dim first (TS-01)', () => {
    const tenor = { ...SELECTION, dims: [SELECTION.dims[1]!] };
    const p = plan(tenor);
    expect(p['evil-bar']!.ok && p['evil-bar']!.instance.bind.sort).toBe('dim');
    const line = p['evil-line']!;
    expect(line.ok && line.instance.bind).toMatchObject({ dims: ['as_of_date', 'maturity_bucket'], window: { trailing: '30d' } });
  });

  it('leads a stack’s dims with its parts, so PIE-01 counts what it judges — the side few enough to read', () => {
    // Entities across, maturities stacked would be six parts: the planner stacks the four entities across the maturities.
    const stack = plan()['evil-stacked-bar']!;
    expect(stack.ok && stack.instance.bind.dims).toEqual(['entity_id', 'maturity_bucket']);
    // The axis is the maturity ladder, so the bars keep its order.
    expect(stack.ok && stack.instance.bind.sort).toBe('dim');
    expect(stack.ok && stack.instance.title).toBe('weighted_outflows_30d by Maturity bucket and Entity id');
    // And a flow runs from the side PIE-01 can read, whichever column came first.
    const flow = plan({ ...SELECTION, dims: [SELECTION.dims[1]!, SELECTION.dims[0]!] })['evil-sankey']!;
    expect(flow.ok && flow.instance.bind.dims).toEqual(['entity_id', 'maturity_bucket']);
  });

  it('refuses what the linter would block, with its reason', () => {
    // A ratio does not sum: no stack, pie or flow of it (AREA-01).
    const ratio = plan(SELECTION, { ...OUTFLOWS, measure: 'lcr_pct', allowed_aggregations: [] });
    for (const k of ['evil-stacked-bar', 'evil-stacked-area', 'evil-pie', 'evil-sankey']) {
      const c = ratio[k]!;
      expect(c.ok, k).toBe(false);
      if (!c.ok) expect(c.reason).toMatch(/AREA-01/);
    }
    expect(ratio['evil-bar']!.ok).toBe(true);
    // Six maturity buckets are more parts than a part-to-whole reads (PIE-01), whatever the selection holds.
    const ladder = plan({ ...SELECTION, dims: [SELECTION.dims[1]!] })['evil-pie']!;
    expect(ladder.ok || ladder.reason).toMatch(/Maturity bucket has 6 values.*PIE-01/);
    const wide = { ...OUTFLOWS, dims: OUTFLOWS.dims.map((d) => (d.name === 'entity_id' ? { ...d, values: ['a', 'b', 'c', 'd', 'e', 'f'] } : d)) };
    const both = plan(SELECTION, wide)['evil-stacked-bar']!;
    expect(both.ok || both.reason).toMatch(/PIE-01/);
    expect(stackRefusal({ ...OUTFLOWS, measure: 'net_change' })).toMatch(/negative/);
  });

  it('says why a kind does not fit the selection’s shape', () => {
    const one = plan({ ...SELECTION, dims: [{ id: 'entity_id', label: 'Entity id', values: ['WF-US', 'WF-UK'] }] });
    expect(one['evil-sankey']!.ok || one['evil-sankey']!.reason).toMatch(/two dimension columns/);
    expect(one['evil-stacked-bar']!.ok || one['evil-stacked-bar']!.reason).toMatch(/second dimension/);
    expect(one['evil-radar']!.ok || one['evil-radar']!.reason).toMatch(/three spokes/);
    const noTime = plan(SELECTION, { ...OUTFLOWS, dims: OUTFLOWS.dims.filter((d) => d.type !== 'time') });
    expect(noTime['evil-line']!.ok || noTime['evil-line']!.reason).toMatch(/no time dimension/);
  });

  it('charts only the metric’s own value; a calculated column stays in the grid', () => {
    const computed = plan({ ...SELECTION, measures: [{ id: 'c_share', label: 'Share', computed: true }] });
    expect(Object.values(computed).every((c) => !c.ok)).toBe(true);
    expect(!computed['evil-bar']!.ok && computed['evil-bar']!.reason).toMatch(/calculated in this grid’s view/);
    const both = plan({ ...SELECTION, measures: [...SELECTION.measures, { id: 'c_share', label: 'Share', computed: true }] });
    expect(both['evil-pie']!.ok && both['evil-pie']!.note).toMatch(/Share stays in the grid/);
    const unregistered = planCharts({ source: GRID, metric: undefined, selection: SELECTION, id: 'c', pos: { x: 0, y: 0, w: 6, h: 4 } });
    expect(unregistered.every((c) => !c.ok && /not in the registry/.test(c.reason))).toBe(true);
  });
});

describe('shaping widget data for Evil Charts', () => {
  const data: WidgetData = {
    unit: 'USD', format: 'currency_usd', asOf: '2026-09-30',
    rows: [
      { key: { entity_id: 'WF-US', maturity_bucket: 'O/N' }, value: 10, prior: 9 },
      { key: { entity_id: 'WF-US', maturity_bucket: '1W' }, value: 5, prior: 5 },
      { key: { entity_id: 'WF-UK', maturity_bucket: 'O/N' }, value: 30, prior: 28 },
      { key: { entity_id: 'WF-UK', maturity_bucket: '1W' }, value: 1, prior: 2 },
    ],
  };
  const inst = (type: string, dims: string[], sort?: 'value' | 'dim'): WidgetInstance =>
    ({ id: 'c', type, pos: { x: 0, y: 0, w: 6, h: 4 }, bind: { metric: GRID.bind.metric, dims, ...(sort ? { sort } : {}) } });

  it('keys series safely, labels them with their values, and colours them with the series tokens', () => {
    const t = categoryTable(inst('evil-bar@1', ['entity_id', 'maturity_bucket']), data);
    expect(t.series).toEqual([{ key: 's0', label: 'O/N' }, { key: 's1', label: '1W' }]);
    // Biggest total first (BAR-02): WF-UK 31 before WF-US 15.
    expect(t.rows).toEqual([{ category: 'WF-UK', s0: 30, s1: 1 }, { category: 'WF-US', s0: 10, s1: 5 }]);
    expect(configFor(t.series)).toEqual({ s0: { label: 'O/N', colors: { light: ['var(--cr-s0)'] } }, s1: { label: '1W', colors: { light: ['var(--cr-s1)'] } } });
    // Sorted by the dimension, the served order stands.
    expect(categoryTable(inst('evil-bar@1', ['entity_id'], 'dim'), data).rows.map((r) => r.category)).toEqual(['WF-US', 'WF-UK']);
  });

  it('pairs today with the prior close, and turns parts into keyed slices', () => {
    expect(priorTable(inst('evil-composed@1', ['entity_id']), { ...data, rows: data.rows!.slice(0, 1) }))
      .toEqual([{ category: 'WF-US', value: 10, prior: 9 }]);
    const parts = partsTable(inst('evil-pie@1', ['entity_id']), data, 'pie');
    expect(parts).toEqual({
      rows: [{ name: 's0', label: 'WF-UK', value: 31 }, { name: 's1', label: 'WF-US', value: 15 }],
      series: [{ key: 's0', label: 'WF-UK' }, { key: 's1', label: 'WF-US' }],
    });
  });

  it('refuses a negative part rather than drawing it', () => {
    const neg = { ...data, rows: [...data.rows!, { key: { entity_id: 'WF-EU', maturity_bucket: 'O/N' }, value: -4, prior: 0 }] };
    const parts = partsTable(inst('evil-pie@1', ['entity_id']), neg, 'pie');
    expect(isRefusal(parts) && parts.refused).toMatch(/WF-EU is negative/);
    const flow = flowTable(inst('evil-sankey@1', ['entity_id', 'maturity_bucket']), neg);
    expect(isRefusal(flow) && flow.refused).toMatch(/WF-EU → O\/N is negative/);
  });

  it('builds a flow with a node per value on each side and a link per pair, leaving out what carries nothing', () => {
    const zero = { key: { entity_id: 'WF-EU', maturity_bucket: '1M' }, value: 0, prior: 0 };
    const flow = flowTable(inst('evil-sankey@1', ['entity_id', 'maturity_bucket']), { ...data, rows: [...data.rows!, zero] });
    expect(isRefusal(flow)).toBe(false);
    if (isRefusal(flow)) return;
    expect(flow.nodes).toEqual([{ name: 'a0' }, { name: 'a1' }, { name: 'b0' }, { name: 'b1' }]);
    expect(flow.links).toEqual([
      { source: 0, target: 2, value: 10 }, { source: 0, target: 3, value: 5 },
      { source: 1, target: 2, value: 30 }, { source: 1, target: 3, value: 1 },
    ]);
  });

  it('lays lines out by date, a missing day a gap rather than a zero', () => {
    const t = timeTable(inst('evil-line@1', ['as_of_date', 'entity_id']), {
      unit: 'USD', format: 'currency_usd', asOf: '2026-09-30',
      series: [
        { key: { entity_id: 'WF-US' }, points: [{ date: '2026-09-29', value: 1 }, { date: '2026-09-30', value: 2 }] },
        { key: { entity_id: 'WF-UK' }, points: [{ date: '2026-09-30', value: 3 }] },
      ],
    });
    expect(t.series).toEqual([{ key: 's0', label: 'WF-US' }, { key: 's1', label: 'WF-UK' }]);
    expect(t.rows).toEqual([{ date: '2026-09-29', s0: 1, s1: null }, { date: '2026-09-30', s0: 2, s1: 3 }]);
  });
});

describe('what the planner allows, the linter passes; what it refuses, the linter blocks', () => {
  const metricContract = (over: Partial<MetricContract> = {}): MetricContract => ({
    ref: GRID.bind.metric, doc: 'lcr', measure: 'weighted_outflows_30d', version: 1, status: 'approved',
    grain: 'alm.fct_liquidity_position', unit: 'USD', precision: 0, format: 'currency_usd',
    allowed_aggregations: ['sum'], denominator_of: null, owner: 'alm-desk', lineage_urn: 'alm.fct_liquidity_position',
    dims: OUTFLOWS.dims.map((d) => ({ name: d.name, type: d.type as 'time' | 'categorical', ordinal: d.ordinal, ...(d.values ? { values: d.values } : {}) })),
    ...over,
  });
  const board = (widgets: WidgetInstance[]): DashboardSpec => ({
    chartroom: '0.1',
    dashboard: { id: 'board', title: 'Board', pattern: 'liquidity-monitor@1', audience: 'alm-analyst', cadence: 'eod', status: 'draft' },
    context: {}, layout: { grid: { cols: 12, row_height: 96 } }, widgets, interactions: [],
  });
  const blocks = (contract: MetricContract, instance: WidgetInstance) =>
    lint(board([GRID, instance]), { contracts: new Map([[contract.ref, contract]]), widgets: CATALOG_BY_REF })
      .findings.filter((f) => f.widget === instance.id && f.severity === 'BLOCK').map((f) => f.rule);

  it('every instance the planner offers lints without a block', () => {
    for (const selection of [SELECTION, { ...SELECTION, dims: [SELECTION.dims[0]!] }, { ...SELECTION, dims: [SELECTION.dims[1]!, SELECTION.dims[0]!] }]) {
      for (const c of planCharts({ source: GRID, metric: OUTFLOWS, selection, id: 'chart-1', pos: { x: 0, y: 11, w: 6, h: 4 } })) {
        if (c.ok) expect(blocks(metricContract(), c.instance), c.spec.kind).toEqual([]);
      }
    }
  });

  it('a stack of a ratio the planner refuses is one the linter blocks (AREA-01)', () => {
    const ratio = { ...OUTFLOWS, measure: 'lcr_pct', allowed_aggregations: [] as string[] };
    const offered = planCharts({ source: GRID, metric: OUTFLOWS, selection: SELECTION, id: 'chart-1', pos: { x: 0, y: 11, w: 6, h: 4 } });
    const refused = planCharts({ source: GRID, metric: ratio, selection: SELECTION, id: 'chart-1', pos: { x: 0, y: 11, w: 6, h: 4 } });
    for (const kind of ['evil-stacked-bar', 'evil-pie', 'evil-sankey', 'evil-stacked-area']) {
      expect(refused.find((c) => c.spec.kind === kind)!.ok, kind).toBe(false);
      const instance = offered.find((c) => c.spec.kind === kind)!;
      expect(instance.ok, kind).toBe(true);
      if (instance.ok) expect(blocks(metricContract({ measure: 'lcr_pct', allowed_aggregations: [] }), instance.instance), kind).toContain('AREA-01');
    }
  });
});
