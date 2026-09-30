/**
 * Phase 5's proof (ADR-70): the compiled SQL names only the meta's columns
 * and carries every value as a parameter; run through a real engine it
 * answers exactly what the in-memory path answers — filtered and sorted
 * leaves, and subtotals at every grouping level equal to brute force and
 * to the client's own aggregation.
 */

import { describe, expect, it } from 'vitest';
import { weightedAverage } from '../src/grid/aggregations';
import { parseSearch, rowMatchesSearch } from '../src/grid/search';
import { defaultView, parseView } from '../src/grid/viewState';
import { compileSql, DREMIO, DUCKDB, SQLITE } from '../src/data/compileSql';
import { inMemorySource } from '../src/data/inMemorySource';
import { generatePositions, type Position } from '../src/data/mock';
import { dateText, groupNodeId, isGroupNode, sqlSource } from '../src/data/sqlSource';
import { queryView } from '../src/agent/tools';
import { sqliteExecutor } from './sqliteExecutor';

const BOOK = generatePositions(3000);
const executor = sqliteExecutor(BOOK);
const sql = sqlSource({ executor, table: 'positions', dialect: SQLITE, name: 'sqlite book' });
const memory = inMemorySource(BOOK, 'memory book');

describe('compileSql', () => {
  it('compiles a leaf query with every value as a parameter', () => {
    const view = parseView({
      version: 1,
      columnFilters: [{ id: 'product', value: ['Bond', "O'Neil"] }, { id: 'notional', value: [1e9, null] }],
      globalFilter: 'cp-01',
      sorting: [{ id: 'mtm', desc: true }],
    });
    const c = compileSql(view, { table: 'positions', limit: 10, offset: 5 });
    expect(c.shape).toBe('leaf');
    expect(c.sql).toBe(
      'SELECT "desk", "legalEntity", "book", "currency", "product", "tenorBucket", "counterparty", "tradeId", "asOf", "notional", "mtm", "dv01", "cs01", "yield", "wal" FROM "positions"'
      + ' WHERE "product" IN (?, ?) AND "notional" >= ?'
      + ' AND (' + ['desk', 'legalEntity', 'book', 'currency', 'product', 'tenorBucket', 'counterparty', 'tradeId', 'asOf', 'notional', 'mtm', 'dv01', 'cs01', 'yield', 'wal']
        .map((id) => `CAST("${id}" AS VARCHAR) ILIKE ?`).join(' OR ') + ')'
      + ' ORDER BY "mtm" DESC, "tradeId" ASC LIMIT 10 OFFSET 5',
    );
    // The quick filter binds once per column it is matched against.
    expect(c.params.slice(0, 3)).toEqual(['Bond', "O'Neil", 1e9]);
    expect(c.params.slice(3)).toEqual(Array(15).fill('%cp-01%'));
    expect(c.sql).not.toContain("O'Neil");
  });

  it('compiles the quick filter\'s tokens: a word across columns, a term on its column, an unknown term to no row (ADR-73)', () => {
    const c = compileSql(parseView({ version: 2, globalFilter: 'Credit ccy:EUR desk=Rates desk!=FX notional>1bn yield<=3.5' }), { table: 'positions' });
    const word = '(' + ['desk', 'legalEntity', 'book', 'currency', 'product', 'tenorBucket', 'counterparty', 'tradeId', 'asOf', 'notional', 'mtm', 'dv01', 'cs01', 'yield', 'wal']
      .map((id) => `CAST("${id}" AS VARCHAR) ILIKE ?`).join(' OR ') + ')';
    expect(c.sql).toContain(` WHERE ${word} AND CAST("currency" AS VARCHAR) ILIKE ? AND CAST("desk" AS VARCHAR) ILIKE ? AND NOT CAST("desk" AS VARCHAR) ILIKE ? AND "notional" > ? AND "yield" <= ?`);
    expect(c.params.slice(15)).toEqual(['%EUR%', 'Rates', 'FX', 1e9, 3.5]);
    const none = compileSql(parseView({ version: 2, globalFilter: 'notional>abc' }), { table: 'positions' });
    expect(none.sql).toContain(' WHERE 1 = 0');
    const empty = compileSql(parseView({ version: 2, columnFilters: [{ id: 'product', value: [] }] }), { table: 'positions' });
    expect(empty.sql).toContain(' WHERE 1 = 0');
  });

  it('compiles the next grouping level with wavg decomposed, scoped by the group path', () => {
    const view = parseView({ version: 1, grouping: ['desk', 'currency'], sorting: [{ id: 'notional', desc: true }] });
    const top = compileSql(view, { table: 'book.positions' });
    expect(top.shape).toBe('group');
    expect(top.groupColumn).toBe('desk');
    expect(top.sql).toContain('FROM "book"."positions"');
    expect(top.sql).toContain('GROUP BY "desk"');
    expect(top.sql).toContain('COUNT(*) AS "__count"');
    expect(top.sql).toContain('SUM("notional") AS "notional"');
    expect(top.sql).toContain('SUM("yield" * "notional") / NULLIF(SUM("notional"), 0) AS "yield"');
    expect(top.sql).toContain('SUM("yield" * "notional") AS "__yield_xw"');
    expect(top.sql).toMatch(/ORDER BY "notional" DESC, "desk" ASC$/);
    const second = compileSql(view, { table: 'positions', groupPath: ['Credit'] });
    expect(second.groupColumn).toBe('currency');
    expect(second.sql).toContain('WHERE "desk" = ?');
    expect(second.params).toEqual(['Credit']);
    const leaves = compileSql(view, { table: 'positions', groupPath: ['Credit', 'EUR'] });
    expect(leaves.shape).toBe('leaf');
    expect(leaves.params).toEqual(['Credit', 'EUR']);
  });

  it('aggregates by the view’s choice: AVG, COUNT(DISTINCT), MEDIAN where the engine has it', () => {
    const view = parseView({ version: 2, grouping: ['desk'], columnAggs: { yield: 'mean', dv01: 'uniqueCount', notional: 'median' } });
    const d = compileSql(view, { table: 'positions' }, DUCKDB);
    expect(d.sql).toContain('AVG("yield") AS "yield"');
    expect(d.sql).toContain('COUNT(DISTINCT "dv01") AS "dv01"');
    expect(d.sql).toContain('MEDIAN("notional") AS "notional"');
    expect(() => compileSql(view, { table: 'positions' }, SQLITE)).toThrow(/sqlite has no median/);
  });

  it('refuses an unknown column, a bad table and a path deeper than the grouping', () => {
    const view = defaultView();
    expect(() => compileSql({ ...view, sorting: [{ id: 'pnl', desc: false }] }, { table: 'positions' })).toThrow(/unknown column/);
    expect(() => compileSql(view, { table: 'positions; DROP TABLE x' })).toThrow(/bad table/);
    expect(() => compileSql(view, { table: 'positions', groupPath: ['x'] })).toThrow(/groupPath/);
  });

  it('inlines escaped literals for Dremio and keeps parameters for DuckDB', () => {
    const view = parseView({ version: 1, columnFilters: [{ id: 'counterparty', value: ["CP-0'1"] }], globalFilter: 'x' });
    const d = compileSql(view, { table: 'positions' }, DREMIO);
    expect(d.params).toEqual([]);
    expect(d.sql).toContain(`"counterparty" IN ('CP-0''1')`);
    expect(d.sql).toContain(`LOWER(CAST("desk" AS VARCHAR)) LIKE LOWER('%x%')`);
    const k = compileSql(view, { table: 'positions' }, DUCKDB);
    expect(k.params[0]).toBe("CP-0'1");
    expect(k.params.slice(1)).toEqual(Array(15).fill('%x%'));
  });
});

describe('a date column comes back as the ISO day whatever the engine returned', () => {
  it('normalises epoch milliseconds, Dates and text', async () => {
    const epoch = Date.UTC(2026, 8, 28);
    const stub = {
      async run(sql: string) {
        return sql.startsWith('SELECT COUNT(*)')
          ? [{ __count: 2n, asOf: epoch }]
          : [
              { ...BOOK[0]!, asOf: epoch },
              { ...BOOK[1]!, asOf: new Date(epoch) },
            ];
      },
    };
    const src = sqlSource({ executor: stub, table: 'positions', dialect: DUCKDB });
    expect((await src.describe()).asOf).toBe('2026-09-28');
    expect((await src.describe()).rowCount).toBe(2);
    const rows = (await src.query(defaultView())).rows;
    expect(rows.map((r) => r.asOf)).toEqual(['2026-09-28', '2026-09-28']);
    expect(dateText('2026-09-28')).toBe('2026-09-28');
  });
});

describe('the SQL source answers as the in-memory path does', () => {
  it('sorts and filters by a calculated column through the engine as the client does (ADR-79)', async () => {
    const share = { id: 'c:mtm_share', label: 'MTM share', op: 'ratio' as const, of: ['mtm', 'notional'] };
    const view = parseView({
      version: 4, computedColumns: [share], sorting: [{ id: 'c:mtm_share', desc: true }, { id: 'tradeId', desc: false }],
      columnFilters: [{ id: 'c:mtm_share', value: [0, null] }],
    });
    const c = compileSql(view, { table: 'positions' });
    expect(c.sql).toContain('WHERE (("mtm") / NULLIF("notional", 0)) * 100 >= ?');
    expect(c.sql).toContain('ORDER BY (("mtm") / NULLIF("notional", 0)) * 100 DESC, "tradeId" ASC');
    const fromSql = await sql.query(view);
    const client = BOOK.filter((b) => b.mtm / b.notional >= 0).sort((a, b) => (b.mtm / b.notional) - (a.mtm / a.notional) || a.tradeId.localeCompare(b.tradeId)).map((b) => b.tradeId);
    expect(fromSql.rows.map((r) => r.tradeId)).toEqual(client);

    // A grouping level sorts by the ratio of sums, and the node's operands give the client the same figure.
    const grouped = parseView({ version: 4, computedColumns: [share], grouping: ['desk'], sorting: [{ id: 'c:mtm_share', desc: true }] });
    const g = compileSql(grouped, { table: 'positions' });
    expect(g.sql).toContain('ORDER BY ((SUM("mtm")) / NULLIF(SUM("notional"), 0)) * 100 DESC, "desk" ASC');
    const top = await sql.query(grouped);
    const shares = top.rows.map((n) => (Number(n.mtm) / Number(n.notional)) * 100);
    for (let i = 1; i < shares.length; i++) expect(shares[i]!).toBeLessThanOrEqual(shares[i - 1]!);
  });

  it('serves only the chosen buckets when the view names them (ADR-86)', async () => {
    const view = parseView({ version: 6, grouping: ['desk'], pivot: { column: 'currency', values: ['notional'], buckets: ['EUR', 'JPY'] } });
    const level = await sql.query(view);
    const keys = Object.keys(level.rows[0]!).filter((k) => k.startsWith('p:'));
    expect(keys).toEqual(['p:notional:EUR', 'p:notional:JPY']);
    const desk = String(level.rows[0]!.desk);
    const expected = BOOK.filter((b) => b.desk === desk && b.currency === 'JPY').reduce((a, b) => a + b.notional, 0);
    expect(level.rows[0]!['p:notional:JPY']).toBeCloseTo(expected, 3);
    const totals = await sql.query(view, { totals: true });
    expect(Object.keys(totals.totals!).filter((k) => k.startsWith('p:'))).toEqual(['p:notional:EUR', 'p:notional:JPY']);
  });

  it('serves a pivoted grouping level as bucketed aggregates the client reads back (ADR-80)', async () => {
    const view = parseView({ version: 5, grouping: ['desk'], pivot: { column: 'currency', values: ['notional', 'yield'] }, sorting: [{ id: 'p:notional:EUR', desc: true }] });
    const values = await sql.distinct!('currency');
    expect(values).toEqual([...new Set(BOOK.map((b) => b.currency))].sort());
    const c = compileSql(view, { table: 'positions', pivotValues: ['EUR'] });
    expect(c.sql).toContain('SUM(CASE WHEN "currency" = ? THEN "notional" END) AS "p:notional:EUR"');
    expect(c.sql).toContain('SUM("yield" * CASE WHEN "currency" = ? THEN "notional" END) / NULLIF(SUM(CASE WHEN "currency" = ? THEN "notional" END), 0) AS "p:yield:EUR"');
    expect(c.sql).toMatch(/ORDER BY SUM\(CASE WHEN "currency" = \? THEN "notional" END\) DESC, "desk" ASC$/);
    const top = await sql.query(view);
    const client = await queryView(memory, view, { limit: 100, display: false });
    for (const node of top.rows) {
      if (!isGroupNode(node)) throw new Error('not a group');
      const mine = BOOK.filter((b) => b.desk === node.__group.value && b.currency === 'EUR');
      const n = node as unknown as Record<string, unknown>;
      expect(n['p:notional:EUR']).toBeCloseTo(mine.reduce((a, b) => a + b.notional, 0), 3);
      const w = mine.reduce((a, b) => a + b.notional, 0);
      expect(n['p:yield:EUR']).toBeCloseTo(mine.reduce((a, b) => a + b.yield * b.notional, 0) / w, 9);
      const same = client.rows.find((r) => r.group?.value === node.__group.value)!;
      expect(same.values['p:notional:EUR']).toBeCloseTo(n['p:notional:EUR'] as number, 3);
    }
    const shown = top.rows.map((r) => (r as unknown as Record<string, number>)['p:notional:EUR']!);
    for (let i = 1; i < shown.length; i++) expect(shown[i]!).toBeLessThanOrEqual(shown[i - 1]!);
  });

  it('keeps the same rows for a token query as the client does', async () => {
    for (const globalFilter of ['desk:Credit ccy:EUR notional>1bn', 'Bond desk=Rates yield>=3', 'entity!=WF-US mtm<0', 'notional>abc']) {
      const view = parseView({ version: 2, globalFilter, sorting: [{ id: 'tradeId', desc: false }] });
      const fromSql = await sql.query(view);
      const client = BOOK.filter((b) => rowMatchesSearch(parseSearch(globalFilter), (id) => b[id as keyof Position])).map((b) => b.tradeId).sort();
      expect(fromSql.rows.map((r) => r.tradeId).sort(), globalFilter).toEqual(client);
      const viaMemory = await queryView(memory, view, { limit: 1000, display: false });
      expect(viaMemory.total, globalFilter).toBe(client.length);
    }
    const none = await sql.query(parseView({ version: 2, columnFilters: [{ id: 'product', value: [] }] }));
    expect(none.rows).toEqual([]);
  });

  it('describes the book from the table', async () => {
    const about = await sql.describe();
    expect(about.rowCount).toBe(3000);
    expect(about.asOf).toBe('2026-09-28');
    expect(about.serves).toEqual({ filter: true, sort: true, group: true, groupPath: true, window: true });
  });

  it('filters and sorts leaves identically, and says it did', async () => {
    const view = parseView({
      version: 1,
      columnFilters: [{ id: 'product', value: ['Bond', 'CDS'] }, { id: 'notional', value: [5e8, 4e9] }],
      globalFilter: 'WF-US',
      sorting: [{ id: 'yield', desc: true }, { id: 'tradeId', desc: false }],
    });
    const fromSql = await sql.query(view);
    expect(fromSql.applied).toEqual({ filter: true, sort: true, group: false });
    const viaMemory = await queryView(memory, view, { limit: 1000, display: false });
    expect(fromSql.rows.length).toBe(viaMemory.total);
    expect(fromSql.rows.map((r) => r.tradeId)).toEqual(viaMemory.rows.map((r) => r.id));
    expect(fromSql.rows[0]).toEqual(BOOK.find((b) => b.tradeId === fromSql.rows[0]!.tradeId));
  });

  it('groups a level at a time, each subtotal equal to brute force and to the client', async () => {
    const view = parseView({ version: 1, grouping: ['desk', 'currency'], columnFilters: [{ id: 'product', value: ['Bond', 'IRS', 'Repo'] }] });
    const kept = BOOK.filter((b) => ['Bond', 'IRS', 'Repo'].includes(b.product));
    const top = await sql.query(view);
    expect(top.applied.group).toBe(true);
    expect(top.rows.every(isGroupNode)).toBe(true);
    expect(top.rows.length).toBe(new Set(kept.map((b) => b.desk)).size);
    const client = await queryView(memory, view, { limit: 1000, display: false });
    for (const node of top.rows) {
      if (!isGroupNode(node)) throw new Error('not a group');
      const mine = kept.filter((b) => b.desk === node.__group.value);
      expect(node.__group.count).toBe(mine.length);
      expect(node.__group.path).toEqual([node.__group.value]);
      expect(node.tradeId).toBe(groupNodeId([node.__group.value]));
      expect(node.notional).toBeCloseTo(mine.reduce((a, b) => a + b.notional, 0), 3);
      expect(node.yield).toBeCloseTo(weightedAverage(mine.map((b) => b.yield), mine.map((b) => b.notional))!, 9);
      const same = client.rows.find((r) => r.group?.value === node.__group.value)!;
      expect(node.yield).toBeCloseTo(same.values.yield as number, 9);
      expect(node.counterparty).toBe('');
    }
    const second = await sql.query(view, { groupPath: ['Credit'] });
    for (const node of second.rows) {
      if (!isGroupNode(node)) throw new Error('not a group');
      expect(node.__group).toMatchObject({ column: 'currency', depth: 1, path: ['Credit', node.__group.value] });
      const mine = kept.filter((b) => b.desk === 'Credit' && b.currency === node.__group.value);
      expect(node.dv01).toBeCloseTo(mine.reduce((a, b) => a + b.dv01, 0), 3);
    }
    const leaves = await sql.query(view, { groupPath: ['Credit', 'EUR'] });
    expect(leaves.applied.group).toBe(false);

    // The view's aggregation choice reaches the engine: a mean yield per desk.
    const chosen = parseView({ ...view, columnAggs: { yield: 'mean' } });
    const means = await sql.query(chosen);
    for (const node of means.rows) {
      if (!isGroupNode(node)) throw new Error('not a group');
      const mine = kept.filter((b) => b.desk === node.__group.value);
      expect(node.yield).toBeCloseTo(mine.reduce((a, b) => a + b.yield, 0) / mine.length, 9);
    }
    expect(leaves.rows.map((r) => r.tradeId).sort()).toEqual(kept.filter((b) => b.desk === 'Credit' && b.currency === 'EUR').map((b) => b.tradeId).sort());
  });
});
