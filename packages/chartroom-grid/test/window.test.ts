/**
 * Row windowing (ADR-85): a source that serves windows answers a leaf view
 * one window at a time with the total it was cut from and the grand totals
 * over everything the view matches; the agent's query maps its own window
 * onto it; a grouped view is still answered a level at a time.
 */

import { describe, expect, it } from 'vitest';
import { queryView } from '../src/agent/tools';
import { weightedAverage } from '../src/grid/aggregations';
import { compileSql, SQLITE } from '../src/data/compileSql';
import { inMemorySource } from '../src/data/inMemorySource';
import { generatePositions } from '../src/data/mock';
import { sqlSource } from '../src/data/sqlSource';
import { parseView } from '../src/grid/viewState';
import { sqliteExecutor } from './sqliteExecutor';

const BOOK = generatePositions(3000);
const sql = sqlSource({ executor: sqliteExecutor(BOOK), table: 'positions', dialect: SQLITE, name: 'sqlite book' });
const memory = inMemorySource(BOOK, 'memory book');
const VIEW = parseView({ version: 5, columnFilters: [{ id: 'product', value: ['Bond', 'IRS'] }], sorting: [{ id: 'notional', desc: true }, { id: 'tradeId', desc: false }] });
const KEPT = BOOK.filter((b) => b.product === 'Bond' || b.product === 'IRS');

describe('compileSql totals', () => {
  it('aggregates everything the view matches, with no grouping and the pivot buckets included', () => {
    const c = compileSql(VIEW, { table: 'positions', totals: true }, SQLITE);
    expect(c.shape).toBe('totals');
    expect(c.sql).toMatch(/^SELECT COUNT\(\*\) AS "__count", SUM\("notional"\) AS "notional", /);
    expect(c.sql).toContain('SUM("yield" * "notional") / NULLIF(SUM("notional"), 0) AS "yield"');
    expect(c.sql).not.toContain('GROUP BY');
    expect(c.sql).toContain(' WHERE "product" IN (?, ?)');
    expect(c.params).toEqual(['Bond', 'IRS']);
    const p = compileSql(parseView({ version: 5, pivot: { column: 'currency', values: ['notional'] } }), { table: 'positions', totals: true, pivotValues: ['EUR'] }, SQLITE);
    expect(p.sql).toContain('AS "p:notional:EUR"');
  });
});

describe('a SQL source serves windows', () => {
  it('says so, and answers a window with its offset, the total and the grand totals', async () => {
    expect((await sql.describe()).serves.window).toBe(true);
    expect((await memory.describe()).serves.window).toBe(false);
    const r = await sql.query(VIEW, { window: { offset: 10, limit: 5 }, totals: true });
    expect(r.applied).toEqual({ filter: true, sort: true, group: false, window: true });
    expect(r.offset).toBe(10);
    expect(r.rows).toHaveLength(5);
    expect(r.total).toBe(KEPT.length);
    const sorted = [...KEPT].sort((a, b) => b.notional - a.notional || a.tradeId.localeCompare(b.tradeId));
    expect(r.rows.map((x) => x.tradeId)).toEqual(sorted.slice(10, 15).map((x) => x.tradeId));
    expect(r.totals!.notional).toBeCloseTo(KEPT.reduce((a, b) => a + b.notional, 0), 3);
    expect(r.totals!.yield).toBeCloseTo(weightedAverage(KEPT.map((p) => p.yield), KEPT.map((p) => p.notional))!, 9);
    expect(r.totals!.__count).toBeUndefined();
    // Without totals the window still knows what it was cut from.
    const w = await sql.query(VIEW, { window: { offset: 0, limit: 2 } });
    expect(w.total).toBe(KEPT.length);
    expect(w.totals).toBeUndefined();
  });

  it('answers a grouped view a level at a time, whatever window was asked for', async () => {
    const r = await sql.query(parseView({ version: 5, grouping: ['desk'] }), { window: { offset: 0, limit: 2 }, totals: true });
    expect(r.applied.window).toBeUndefined();
    expect(r.rows).toHaveLength(5);
    expect(r.totals!.notional).toBeCloseTo(BOOK.reduce((a, b) => a + b.notional, 0), 3);
  });

  it('the agent query maps its offset and limit onto the window and reads the engine\'s totals', async () => {
    const viaSql = await queryView(sql, VIEW, { limit: 7, offset: 20, display: true });
    const viaMemory = await queryView(memory, VIEW, { limit: 7, offset: 20, display: true });
    expect(viaSql.applied.window).toBe(true);
    expect(viaSql.rows.map((r) => r.id)).toEqual(viaMemory.rows.map((r) => r.id));
    expect(viaSql.total).toBe(KEPT.length);
    expect(viaSql.modelRows).toBe(KEPT.length);
    expect(viaSql.truncated).toBe(true);
    expect(viaSql.totals.values.notional).toBeCloseTo(viaMemory.totals.values.notional as number, 3);
    expect(viaSql.totals.display!.notional).toBe(viaMemory.totals.display!.notional);
    const tail = await queryView(sql, VIEW, { limit: 100, offset: KEPT.length - 3 });
    expect(tail.rows).toHaveLength(3);
    expect(tail.truncated).toBe(false);
  });
});
