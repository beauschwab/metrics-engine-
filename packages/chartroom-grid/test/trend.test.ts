/**
 * Trends in the grid (ADR-89): a reader's choice in the view, refused where
 * the schema declares no history (or, for a band, no limit); a wider column
 * when drawn; the column's own readings in the words; and a harness history
 * that always lands on the cell's number.
 */

import { describe, expect, it } from 'vitest';
import { allowedFormatKeys, buildColumns, effectiveMeta } from '../src/grid/columns';
import { pivotMeta } from '../src/grid/pivot';
import { TREND_SIZE, trendOf, trendReadings } from '../src/grid/trend';
import { defaultView, safeParseView, VIEW_VERSION } from '../src/grid/viewState';
import { setView } from '../src/agent/tools';
import { businessDays, generatePositions, positionHistory, DV01_LIMIT } from '../src/data/mock';
import { metricGroupsSchema } from '../src/data/metricGroups';
import { TREASURY_SCHEMA } from '../src/data/treasury';

const view = (columnFormats: Record<string, unknown>) => ({ version: VIEW_VERSION, columnFormats });

describe('a trend is a format a column with a history can take', () => {
  it('is offered only where the schema declares a history', () => {
    expect(allowedFormatKeys('mtm')).toContain('trend');
    expect(allowedFormatKeys('dv01')).toContain('trend');
    expect(allowedFormatKeys('yield')).not.toContain('trend');
    expect(allowedFormatKeys('desk')).toEqual([]);
  });

  it('parses where it is offered and is refused, with the reason, where it is not', () => {
    expect(safeParseView(view({ mtm: { trend: 'line' } })).ok).toBe(true);
    expect(safeParseView(view({ dv01: { trend: 'band' } })).ok).toBe(true);
    const noHistory = safeParseView(view({ yield: { trend: 'line' } }));
    expect(noHistory.ok).toBe(false);
    if (!noHistory.ok) expect(noHistory.issues.join()).toContain('yield has no history to draw');
    // A band without a limit parses as a view (it draws the plain number, and a
    // dashboard whose limit arrives late keeps its arrangement); an agent is refused it.
    expect(safeParseView(view({ mtm: { trend: 'band' } })).ok).toBe(true);
    const agent = setView(defaultView(), { columnFormats: { mtm: { trend: 'band' } } });
    expect(agent.ok).toBe(false);
    if (!agent.ok) expect(agent.issues.join()).toContain('mtm declares no limit to draw a band against');
    expect(safeParseView(view({ mtm: { trend: 'sparkle' } })).ok).toBe(false);
  });

  it('rides the effective meta and widens the column by the sparkline', () => {
    const meta = effectiveMeta('mtm', { mtm: { trend: 'column' } });
    expect(meta.trend).toBe('column');
    expect(trendOf(meta)).toBe('column');
    const plain = buildColumns().find((c) => c.id === 'mtm')!;
    const drawn = buildColumns({}, { mtm: { trend: 'column' } }).find((c) => c.id === 'mtm')!;
    expect(drawn.size! - plain.size!).toBe(TREND_SIZE.width + 10);
  });

  it('draws no band without a limit, and nothing on a pivot bucket', () => {
    expect(trendOf({ ...TREASURY_SCHEMA.columns.mtm, trend: 'band' })).toBeUndefined();
    expect(trendOf({ ...TREASURY_SCHEMA.columns.dv01, trend: 'band' })).toBe('band');
    expect(trendOf({ ...TREASURY_SCHEMA.columns.yield, trend: 'line' })).toBeUndefined();
    expect(pivotMeta({ ...TREASURY_SCHEMA.columns.mtm, trend: 'line' }, 'Rates').trend).toBeUndefined();
  });
});

describe('the trend says numbers as its column does', () => {
  it('reads a value through the meta and a move in the same unit', () => {
    const mm = trendReadings({ label: 'MTM', kind: 'measure', unit: 'mm', dp: 2, negatives: 'parens' });
    expect(mm.value(-1_234_567)).toBe('($1.23M)');
    expect(mm.delta(1_000_000, 1_500_000)).toBe('-$0.50M');
    expect(mm.delta(2_000_000, 1_500_000)).toBe('+$0.50M');
    const pct = trendReadings({ label: 'Yield', kind: 'measure', unit: 'pct', dp: 2 });
    expect(pct.delta(4.5, 4.25)).toBe('+0.25pp');
    const bps = trendReadings({ label: 'Spread', kind: 'measure', unit: 'bps', dp: 1 });
    expect(bps.delta(12, 14.5)).toBe('-2.5 bps');
  });
});

describe('the harness history', () => {
  const [p] = generatePositions(1);

  it('spans business days and ends on the value the cell says', () => {
    const h = positionHistory(p, 'dv01');
    expect(h).toHaveLength(30);
    expect(h.at(-1)).toEqual({ date: p.asOf, value: p.dv01 });
    for (const { date } of h) expect([0, 6]).not.toContain(new Date(`${date}T00:00:00Z`).getUTCDay());
    expect(positionHistory(p, 'dv01')).toEqual(h);
    expect(positionHistory(p, 'mtm')).not.toEqual(h);
  });

  it('counts business days back from a Monday across a weekend', () => {
    expect(businessDays('2026-09-28', 3)).toEqual(['2026-09-24', '2026-09-25', '2026-09-28']);
  });

  it('declares DV01 against the limit the mock book is built around', () => {
    expect(TREASURY_SCHEMA.columns.dv01.limit).toEqual({ value: DV01_LIMIT, side: 'ceiling', label: 'trade DV01 limit' });
  });
});

describe('a metric grid declares a history when the host will supply one', () => {
  const shape = { measure: 'lcr_pct', unit: 'percent', format: 'percent_1dp', dims: [{ name: 'entity_id' }] };

  it('marks the value column only, with the limit the binding governs', () => {
    const plain = metricGroupsSchema(shape, ['entity_id']);
    expect(plain.columns.value.history).toBeUndefined();
    const limit = { value: 100, side: 'floor' as const, label: 'lcr_floor' };
    const s = metricGroupsSchema(shape, ['entity_id'], { history: true, limit });
    expect(s.columns.value.history).toBe(true);
    expect(s.columns.value.limit).toEqual(limit);
    expect(s.columns.prior.history).toBeUndefined();
    expect(s.columns.delta.history).toBeUndefined();
  });
});
