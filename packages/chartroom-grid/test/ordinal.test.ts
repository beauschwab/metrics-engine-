/**
 * Ordinal dimensions (ADR-84): a string column with an implied order sorts,
 * filters, pivots and compiles by that order, in memory and through SQL,
 * and a value the order does not name lands last rather than nowhere.
 */

import { describe, expect, it } from 'vitest';
import { headlessTable } from '../src/agent/headless';
import { queryView, viewContract } from '../src/agent/tools';
import { compileSql, DREMIO, SQLITE } from '../src/data/compileSql';
import { inMemorySource } from '../src/data/inMemorySource';
import { metricGroupsSchema } from '../src/data/metricGroups';
import { generatePositions, TENORS } from '../src/data/mock';
import { sqlSource } from '../src/data/sqlSource';
import { TREASURY_SCHEMA } from '../src/data/treasury';
import { compareByOrder, orderFromRows, ordinalRank, sortByOrder } from '../src/grid/ordinal';
import { parseView } from '../src/grid/viewState';
import { sqliteExecutor } from './sqliteExecutor';

const BOOK = generatePositions(2000);
const LADDER = [...TENORS];

describe('compareByOrder', () => {
  it('ranks named values by position and unnamed ones after, alphanumerically', () => {
    const cmp = compareByOrder(['O/N', '1M', '1Y', '10Y+']);
    expect(['10Y+', '1Y', '1M', 'O/N'].sort(cmp)).toEqual(['O/N', '1M', '1Y', '10Y+']);
    expect(['2Y', '10Y+', '15Y', 'O/N', '3Y'].sort(cmp)).toEqual(['O/N', '10Y+', '2Y', '3Y', '15Y']);
    expect(ordinalRank(['a', 'b'], 'b')).toBe(1);
    expect(ordinalRank(['a', 'b'], 'zzz')).toBe(2);
    expect(ordinalRank(['a', 'b'], null)).toBe(2);
    expect(sortByOrder(['1Y', 'O/N'])).toEqual(['1Y', 'O/N']);
    expect(sortByOrder(['1Y', 'O/N'], ['O/N', '1Y'])).toEqual(['O/N', '1Y']);
  });

  it('reads a ladder\'s order off the rows it was served in', () => {
    expect(orderFromRows([{ b: 'O/N' }, { b: '2-7D' }, { b: 'O/N' }, { b: null }, { b: '8-30D' }], 'b')).toEqual(['O/N', '2-7D', '8-30D']);
  });
});

describe('the treasury tenor sorts as a ladder', () => {
  it('declares the order on the meta and in the agent contract', () => {
    expect(TREASURY_SCHEMA.columns.tenorBucket!.order).toEqual(LADDER);
    expect(viewContract(TREASURY_SCHEMA).columns.find((c) => c.id === 'tenorBucket')!.order).toEqual(LADDER);
  });

  it('sorts leaves and group rows by the ladder, not lexically, in both directions', () => {
    const asc = headlessTable(BOOK, parseView({ version: 1, sorting: [{ id: 'tenorBucket', desc: false }] }));
    const seen = [...new Set(asc.getRowModel().rows.map((r) => r.getValue<string>('tenorBucket')))];
    expect(seen).toEqual(LADDER);
    const grouped = headlessTable(BOOK, parseView({ version: 1, grouping: ['tenorBucket'], sorting: [{ id: 'tenorBucket', desc: true }] }));
    expect(grouped.getRowModel().rows.map((r) => r.getValue<string>('tenorBucket'))).toEqual([...LADDER].reverse());
  });

  it('lists a pivot\'s buckets in the ladder\'s order', () => {
    const t = headlessTable(BOOK, parseView({ version: 5, pivot: { column: 'tenorBucket', values: ['notional'] } }));
    const buckets = t.getAllLeafColumns().map((c) => c.id).filter((id) => id.startsWith('p:notional:')).map((id) => id.slice('p:notional:'.length));
    expect(buckets).toEqual(LADDER);
  });

  it('compiles the sort as a CASE over the ladder, a parameter per value, inlined for Dremio', () => {
    const view = parseView({ version: 1, sorting: [{ id: 'tenorBucket', desc: true }] });
    const c = compileSql(view, { table: 'positions' }, SQLITE);
    const ranks = LADDER.map((_, i) => `WHEN ? THEN ${i}`).join(' ');
    expect(c.sql).toContain(` ORDER BY CASE "tenorBucket" ${ranks} ELSE ${LADDER.length} END DESC, "tenorBucket" DESC, "tradeId" ASC`);
    expect(c.params).toEqual(LADDER);
    const d = compileSql(view, { table: 'positions' }, DREMIO);
    expect(d.sql).toContain(`CASE "tenorBucket" WHEN 'O/N' THEN 0 WHEN '1W' THEN 1`);
    expect(d.params).toEqual([]);
    // A grouping level on the ladder reads in its order by default.
    const g = compileSql(parseView({ version: 1, grouping: ['tenorBucket'] }), { table: 'positions' }, SQLITE);
    expect(g.sql).toContain(`GROUP BY "tenorBucket" ORDER BY CASE "tenorBucket" ${ranks} ELSE ${LADDER.length} END ASC, "tenorBucket" ASC`);
  });

  it('answers the same order through an engine as in memory', async () => {
    const sql = sqlSource({ executor: sqliteExecutor(BOOK), table: 'positions', dialect: SQLITE, name: 'sqlite' });
    const memory = inMemorySource(BOOK, 'memory');
    const view = parseView({ version: 1, sorting: [{ id: 'tenorBucket', desc: false }, { id: 'tradeId', desc: false }] });
    const fromSql = await sql.query(view);
    const viaMemory = await queryView(memory, view, { limit: 1000, display: false });
    expect(fromSql.rows.slice(0, viaMemory.rows.length).map((r) => r.tradeId)).toEqual(viaMemory.rows.map((r) => r.id));
    const level = await sql.query(parseView({ version: 1, grouping: ['tenorBucket'] }));
    expect(level.rows.map((r) => r.tenorBucket)).toEqual(LADDER);
  });
});

describe('a metric\'s ordinal dim', () => {
  const SHAPE = { measure: 'weighted_outflows_30d', unit: 'USD', format: 'currency_usd', allowed_aggregations: ['sum'] };
  it('takes its order from the contract\'s values, and none when the contract lists none', () => {
    const s = metricGroupsSchema({ ...SHAPE, dims: [{ name: 'maturity_bucket', ordinal: true, values: ['O/N', '2-7D', '8-30D'] }, { name: 'entity_id', values: ['WF-US', 'WF-EMEA'] }] }, ['entity_id', 'maturity_bucket']);
    expect(s.columns.maturity_bucket!.order).toEqual(['O/N', '2-7D', '8-30D']);
    expect(s.columns.entity_id!.order).toBeUndefined();
    const rows = [
      { key: 'a', entity_id: 'WF-US', maturity_bucket: '8-30D', value: 1 },
      { key: 'b', entity_id: 'WF-US', maturity_bucket: 'O/N', value: 2 },
      { key: 'c', entity_id: 'WF-US', maturity_bucket: '2-7D', value: 3 },
    ];
    const t = headlessTable(rows, parseView({ version: 1, sorting: [{ id: 'maturity_bucket', desc: false }] }, s), s);
    expect(t.getRowModel().rows.map((r) => r.getValue('maturity_bucket'))).toEqual(['O/N', '2-7D', '8-30D']);
  });
});
