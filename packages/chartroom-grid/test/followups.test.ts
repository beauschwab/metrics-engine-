/**
 * The post-merge review of the grid (ADR-82 to ADR-87): each finding pinned
 * where a unit test can reach it — a generic schema over SQL, filter values
 * by column kind, saved views per schema, basis points scaled once, a set
 * filter's list under the other filters, and the agent's query over groups
 * the engine made.
 */

import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { queryView } from '../src/agent/tools';
import { compileSql, SQLITE } from '../src/data/compileSql';
import { inMemorySource } from '../src/data/inMemorySource';
import { metricGroupRows, metricGroupsSchema, metricScale } from '../src/data/metricGroups';
import { generatePositions } from '../src/data/mock';
import { sqlSource, type SqlExecutor } from '../src/data/sqlSource';
import { headlessTable } from '../src/agent/headless';
import { chartFromRange } from '../src/grid/chart';
import { schemaFromColumns, type GridSchema } from '../src/grid/schema';
import { parseView, safeParseView } from '../src/grid/viewState';
import { memoryViewStore, storageViewStore, type KeyValueStorage } from '../src/views/store';
import { sqliteExecutor } from './sqliteExecutor';

/** LCR groups: a schema with no `tradeId` and no `asOf`. */
const GROUPS: GridSchema = schemaFromColumns([
  { id: 'key', meta: { label: 'Key', kind: 'dimension', width: 120 } },
  { id: 'entity_id', meta: { label: 'Entity', kind: 'dimension', groupable: true, width: 90 } },
  { id: 'value', meta: { label: 'Outflow', kind: 'measure', unit: 'ccy', agg: 'sum', width: 110 } },
], 'key');

function groupsExecutor(): SqlExecutor {
  const db = new DatabaseSync(':memory:');
  db.exec('CREATE TABLE lcr_groups ("key" TEXT, "entity_id" TEXT, "value" REAL)');
  const insert = db.prepare('INSERT INTO lcr_groups VALUES (?, ?, ?)');
  for (const [k, e, v] of [['c', 'WF-US', 3], ['a', 'WF-US', 1], ['b', 'WF-EMEA', 2]] as const) insert.run(k, e, v);
  return { async run(sql, params) { return db.prepare(sql).all(...(params as Array<string | number>)) as Array<Record<string, unknown>>; } };
}

describe('a generic schema over SQL', () => {
  it('breaks ties by the schema\'s row id, not the treasury book\'s', () => {
    const c = compileSql(parseView({ version: 6 }, GROUPS), { table: 'lcr_groups' }, SQLITE, GROUPS);
    expect(c.sql).toMatch(/ORDER BY "key" ASC$/);
    expect(c.sql).not.toContain('tradeId');
  });

  it('describes a table with no as-of column, and answers in row-id order', async () => {
    const source = sqlSource({ executor: groupsExecutor(), table: 'lcr_groups', dialect: SQLITE, schema: GROUPS });
    const about = await source.describe();
    expect(about.asOf).toBeNull();
    expect(about.rowCount).toBe(3);
    const r = await source.query(parseView({ version: 6 }, GROUPS));
    expect(r.rows.map((x) => x.key)).toEqual(['a', 'b', 'c']);
  });
});

describe('a filter\'s value follows its column\'s kind', () => {
  it('accepts a list of strings on a dimension and a finite range on a measure', () => {
    expect(safeParseView({ version: 6, columnFilters: [{ id: 'desk', value: ['Rates'] }, { id: 'notional', value: [0, null] }] }).ok).toBe(true);
    expect(safeParseView({ version: 6, columnFilters: [{ id: 'desk', value: [] }] }).ok).toBe(true);
  });

  it('refuses a scalar, a string on a measure, a number on a dimension, NaN, and a range of three', () => {
    for (const [value, id, why] of [
      [1e9, 'notional', /range filter/],
      [['1bn', null], 'notional', /range filter/],
      [[Number.NaN, null], 'notional', /range filter/],
      [[1, 2, 3], 'notional', /range filter/],
      ['Rates', 'desk', /set filter/],
      [[1], 'desk', /set filter/],
    ] as const) {
      const r = safeParseView({ version: 6, columnFilters: [{ id, value }] });
      expect(r.ok, JSON.stringify(value)).toBe(false);
      if (!r.ok) expect(r.issues.join('\n')).toMatch(why);
    }
  });
});

describe('saved views belong to a schema', () => {
  const fakeStorage = (): KeyValueStorage => { const m = new Map<string, string>(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v) }; };

  it('lists a view under the schema it was saved for, and keeps it through another grid\'s writes', async () => {
    const storage = fakeStorage();
    const store = storageViewStore(storage);
    await store.save('By entity', parseView({ version: 6, grouping: ['entity_id'] }, GROUPS));
    expect((await store.list(GROUPS)).map((v) => v.name)).toEqual(['By entity']);
    // The treasury grid cannot parse it, so it does not list it...
    expect(await store.list()).toEqual([]);
    // ...and its own save and delete do not lose it.
    const mine = await store.save('By desk', parseView({ version: 6, grouping: ['desk'] }));
    await store.remove(mine.id);
    expect((await store.list(GROUPS)).map((v) => v.name)).toEqual(['By entity']);
    const memory = memoryViewStore();
    await memory.save('By entity', parseView({ version: 6, grouping: ['entity_id'] }, GROUPS));
    expect((await memory.list(GROUPS)).length).toBe(1);
    expect((await memory.list()).length).toBe(0);
  });
});

describe('basis points are scaled once', () => {
  it('stores a `bps` metric in basis points, and hands a chart the catalog\'s percent back', () => {
    expect(metricScale('bps')).toBe(100);
    expect(metricScale('currency_usd')).toBe(1);
    const shape = { measure: 'spread', unit: 'percent', format: 'bps', dims: [{ name: 'entity_id' }] };
    const schema = metricGroupsSchema(shape, ['entity_id']);
    expect(schema.columns.value!.unit).toBe('bps');
    const rows = metricGroupRows([{ key: { entity_id: 'WF-US' }, value: 0.0123, prior: 0.01 }], ['entity_id'], metricScale('bps'));
    expect(rows[0]!.value).toBeCloseTo(1.23, 9);
    expect(rows[0]!.delta).toBeCloseTo(0.23, 9);
    const t = headlessTable(rows, parseView({ version: 6 }, schema), schema);
    t.selectCellRange({ anchorRowId: 'WF-US', anchorColumnId: 'entity_id', focusRowId: 'WF-US', focusColumnId: 'value' });
    const outcome = chartFromRange(t);
    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.request.series[0]!.data.format).toBe('bps');
      expect(outcome.request.series[0]!.data.rows[0]!.value).toBeCloseTo(0.0123, 9);
    }
  });
});

describe('the SQL source answers the questions a served grid asks', () => {
  const BOOK = generatePositions(1500);
  const sql = sqlSource({ executor: sqliteExecutor(BOOK), table: 'positions', dialect: SQLITE });
  const memory = inMemorySource(BOOK, 'memory');

  it('lists a set filter\'s values under the view\'s other filters, never its own', async () => {
    const view = parseView({ version: 6, columnFilters: [{ id: 'product', value: ['CDS'] }, { id: 'desk', value: ['Rates'] }] });
    const desks = await sql.distinct!('desk', view);
    expect(desks).toEqual([...new Set(BOOK.filter((b) => b.product === 'CDS').map((b) => b.desk))].sort());
    expect(desks.length).toBeGreaterThan(1);
    expect(await sql.distinct!('desk')).toEqual([...new Set(BOOK.map((b) => b.desk))].sort());
  });

  it('answers the agent\'s grouped query with the engine\'s groups and totals, not a regrouping of them', async () => {
    const view = parseView({ version: 6, grouping: ['desk'], columnAggs: { yield: 'mean', mtm: 'count' } });
    const viaSql = await queryView(sql, view, { limit: 1000 });
    const viaMemory = await queryView(memory, view, { limit: 1000 });
    expect(viaSql.applied.group).toBe(true);
    const groups = viaSql.rows.filter((r) => r.kind === 'group');
    expect(groups).toHaveLength(5);
    for (const g of groups) {
      const leaves = BOOK.filter((b) => b.desk === g.group!.value);
      expect(g.group!.count).toBe(leaves.length);
      expect(g.values.desk).toBe(g.group!.value);
      expect(g.values.notional as number).toBeCloseTo(leaves.reduce((a, b) => a + b.notional, 0), 3);
    }
    expect(viaSql.total).toBe(BOOK.length);
    // A mean over the book, and a count of positions — not a mean of desk means or a count of desks.
    expect(viaSql.totals.values.yield as number).toBeCloseTo(viaMemory.totals.values.yield as number, 9);
    expect(viaSql.totals.values.mtm).toBe(BOOK.length);
    expect(viaSql.totals.display!.mtm).toBe(viaMemory.totals.display!.mtm);
  });

  it('expands engine-made groups by asking for each node\'s children', async () => {
    const view = parseView({ version: 6, grouping: ['desk', 'currency'] });
    // The answer is longer than a page: read it a page at a time.
    const all = [];
    for (let offset = 0; ; offset += 1000) {
      const page = await queryView(sql, view, { limit: 1000, offset, expandAll: true });
      all.push(...page.rows);
      if (!page.truncated) break;
    }
    const desks = all.filter((x) => x.depth === 0);
    const currencies = all.filter((x) => x.depth === 1);
    const leaves = all.filter((x) => x.kind === 'leaf');
    expect(desks).toHaveLength(5);
    expect(desks.every((d) => d.kind === 'group' && d.group!.column === 'desk')).toBe(true);
    expect(currencies.length).toBeGreaterThan(5);
    expect(currencies.every((c) => c.kind === 'group' && c.group!.column === 'currency')).toBe(true);
    expect(leaves).toHaveLength(BOOK.length);
    expect(leaves.every((l) => l.depth === 2)).toBe(true);
  });
});
