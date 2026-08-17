/**
 * The committee pack: the plan is asserted deeply (it *is* the deck's
 * content — every number in it came from the QueryService), and the rendered
 * binary is smoke-tested as a real PPTX (a ZIP container of the expected
 * size, carrying the expected part names).
 */

import { beforeAll, describe, expect, it } from 'vitest';
import type { DashboardSpec } from 'chartroom-spec';
import { buildDeckPlan, renderDeck, type ChartSlide, type KpiSlide, type TableSlide } from '../src/deck';
import { fetchRegistryState } from '../src/keel';
import { QueryService } from '../src/query';

let queries: QueryService;

beforeAll(async () => {
  const state = await fetchRegistryState();
  queries = new QueryService({ state });
});

const SPEC: DashboardSpec = {
  chartroom: '0.1',
  dashboard: {
    id: 'packed', title: 'Liquidity Committee Pack', pattern: { none: { justification: 'a deck test dashboard' } },
    audience: 'treasury-committee', cadence: 'eod', status: 'draft',
  },
  context: {},
  layout: { grid: { cols: 12, row_height: 96 } },
  widgets: [
    {
      id: 'headline', type: 'kpi-tile@1', pos: { x: 0, y: 0, w: 3, h: 2 },
      bind: { metric: 'keel://liquidity_pit.lcr_pct@1' },
    },
    {
      id: 'trend', type: 'timeseries@1', pos: { x: 3, y: 0, w: 9, h: 4 },
      bind: { metric: 'keel://liquidity_pit.lcr_pct@1', dims: ['as_of_date'], window: { trailing: '30d' } },
    },
    {
      id: 'by-entity', type: 'bar@1', pos: { x: 0, y: 4, w: 6, h: 4 },
      bind: { metric: 'keel://liquidity_pit.hqla_total@1', dims: ['entity_id'] },
    },
    {
      id: 'pivot', type: 'perspective-grid@1', pos: { x: 6, y: 4, w: 6, h: 4 },
      bind: { metric: 'keel://liquidity_pit.hqla_total@1', dims: ['entity_id'], max_cells: 50_000 },
    },
  ],
  interactions: [],
};

describe('the deck plan', () => {
  it('carries the provenance and one slide per widget, numbers formatted as the widgets format them', async () => {
    const plan = await buildDeckPlan(SPEC, { version: 3, specHash: 'abc123def456' }, queries);

    expect(plan.title).toMatchObject({
      heading: 'Liquidity Committee Pack', status: 'draft',
      audience: 'treasury-committee', version: 3, specHash: 'abc123def456',
    });
    expect(plan.title.asOf).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(plan.slides.map((s) => s.type)).toEqual(['kpi', 'line', 'bar', 'table']);

    const kpi = plan.slides[0] as KpiSlide;
    expect(kpi.value).toMatch(/%$/); // percent_1dp, through the widgets' own formatter

    const line = plan.slides[1] as ChartSlide;
    expect(line.labels.length).toBeGreaterThan(10); // the 30d window
    expect(line.series[0].values.every(Number.isFinite)).toBe(true);

    const bar = plan.slides[2] as ChartSlide;
    expect(bar.labels).toContain('BANK_US');

    const table = plan.slides[3] as TableSlide;
    expect(table.headers).toEqual(['entity_id', 'value', 'prior']);
    expect(table.rows.length).toBe(4);
    expect(table.rows[0][1]).toMatch(/^\$/); // currency_usd formatting
  });

  it('a failing widget becomes a skipped slide, not a failed deck', async () => {
    const broken = structuredClone(SPEC);
    broken.widgets[0].bind.metric = 'keel://liquidity_pit.no_such@1';
    const plan = await buildDeckPlan(broken, { version: 1, specHash: 'x' }, queries);
    expect(plan.slides[0]).toMatchObject({ type: 'skipped', widget: 'headline' });
    expect(plan.slides.slice(1).every((s) => s.type !== 'skipped')).toBe(true);
  });
});

describe('the rendered binary', () => {
  it('is a real PPTX — ZIP magic, presentation parts, one slide per plan entry', async () => {
    const plan = await buildDeckPlan(SPEC, { version: 3, specHash: 'abc123def456' }, queries);
    const buf = await renderDeck(plan);

    expect(buf.length).toBeGreaterThan(10_000);
    expect(buf.subarray(0, 2).toString('latin1')).toBe('PK');

    // ZIP central directory: file names are stored uncompressed, so the
    // slide part names are findable in the raw bytes.
    const raw = buf.toString('latin1');
    expect(raw).toContain('ppt/presentation.xml');
    for (let i = 1; i <= plan.slides.length + 1; i++) {
      expect(raw, `slide${i}`).toContain(`ppt/slides/slide${i}.xml`);
    }
    expect(raw).not.toContain(`ppt/slides/slide${plan.slides.length + 2}.xml`);
  });
});
