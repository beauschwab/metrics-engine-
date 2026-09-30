/**
 * The schema-driven grid (ADR-82): the same contract, tables, search and SQL
 * over a second schema — a registry metric's groups — with nothing about
 * treasury positions assumed.
 */

import { describe, expect, it } from 'vitest';
import { headlessTable } from '../src/agent/headless';
import { describeView, queryView, setView, viewContract } from '../src/agent/tools';
import { compileSql } from '../src/data/compileSql';
import { inMemorySource } from '../src/data/inMemorySource';
import { cellText } from '../src/grid/copy';
import { schemaFromColumns, type GridRecord, type GridSchema } from '../src/grid/schema';
import { parseSearch, rowMatchesSearch } from '../src/grid/search';
import { parseView, safeParseView } from '../src/grid/viewState';

/** LCR by entity and tenor: what the dashboard interpreter hands a grid widget. */
const GROUPS: GridSchema = schemaFromColumns([
  { id: 'key', meta: { label: 'Key', kind: 'dimension', width: 120 } },
  { id: 'entity_id', meta: { label: 'Entity', kind: 'dimension', groupable: true, width: 90 } },
  { id: 'bucket_code', meta: { label: 'Tenor', kind: 'dimension', groupable: true, width: 70 } },
  { id: 'value', meta: { label: 'Outflow', kind: 'measure', unit: 'ccy', agg: 'sum', width: 110 } },
  { id: 'prior', meta: { label: 'Prior', kind: 'measure', unit: 'ccy', agg: 'sum', width: 110 } },
  { id: 'delta', meta: { label: 'Δ', kind: 'measure', unit: 'ccy', agg: 'sum', negativeRed: true, width: 100 } },
], 'key');

const ROWS: GridRecord[] = [];
for (const entity of ['WF-US', 'WF-EMEA', 'WF-APAC']) {
  for (const [i, bucket] of ['O/N', '2-7D', '8-30D'].entries()) {
    const value = 1e8 * (i + 1) + entity.length * 1e6;
    ROWS.push({ key: `${entity}|${bucket}`, entity_id: entity, bucket_code: bucket, value, prior: value * 0.95, delta: value * 0.05 });
  }
}

describe('a second schema', () => {
  it('parses views against its own columns and refuses the treasury ones', () => {
    const ok = parseView({ version: 5, grouping: ['entity_id'], sorting: [{ id: 'value', desc: true }], columnAggs: { delta: 'mean' } }, GROUPS);
    expect(ok.grouping).toEqual(['entity_id']);
    const bad = safeParseView({ version: 5, grouping: ['desk'] }, GROUPS);
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.issues.join('\n')).toMatch(/unknown column: desk/);
    expect(safeParseView({ version: 5, grouping: ['key'] }, GROUPS)).toMatchObject({ ok: false });
    // The treasury default still refuses this schema's columns.
    expect(safeParseView({ version: 5, grouping: ['entity_id'] })).toMatchObject({ ok: false });
  });

  it('builds a table whose rows, subtotals and totals read the schema, identified by its row id', () => {
    const view = parseView({ version: 5, grouping: ['entity_id'], expanded: true }, GROUPS);
    const t = headlessTable(ROWS, view, GROUPS);
    expect(t.getRowModel().rows.filter((r) => r.getIsGrouped()).length).toBe(3);
    const leaf = t.getRowModel().rows.find((r) => !r.getIsGrouped())!;
    expect(leaf.id).toBe(String(leaf.original.key));
    const cell = leaf.getAllCells().find((c) => c.column.id === 'value')!;
    expect(cellText(cell)).toMatch(/^\$[\d,]+$/);
    const total = t.getColumn('value')!.getAggregationValue();
    expect(total).toBeCloseTo(ROWS.reduce((a, r) => a + (r.value as number), 0), 6);
    // The grouped column leads (groupedColumnMode: reorder); the rest keep the schema's order.
    expect(t.getAllLeafColumns().map((c) => c.id)).toEqual(['entity_id', 'key', 'bucket_code', 'value', 'prior', 'delta']);
  });

  it('the search grammar names the schema\'s columns by id or label, on the client and in SQL', () => {
    const q = parseSearch('entity:EMEA outflow>150m', GROUPS);
    expect(q.terms.map((x) => [x.column, x.op, x.value])).toEqual([['entity_id', ':', 'EMEA'], ['value', '>', 150e6]]);
    const kept = ROWS.filter((r) => rowMatchesSearch(q, (id) => r[id], GROUPS));
    expect(kept.length).toBe(2);
    const viaTable = headlessTable(ROWS, parseView({ version: 5, globalFilter: 'entity:EMEA outflow>150m' }, GROUPS), GROUPS).getFilteredRowModel().rows;
    expect(viaTable.map((r) => r.original.key)).toEqual(kept.map((r) => r.key));
    const c = compileSql(parseView({ version: 5, globalFilter: 'outflow>150m', grouping: ['entity_id'] }, GROUPS), { table: 'lcr_groups' }, undefined, GROUPS);
    expect(c.sql).toContain('SUM("value") AS "value"');
    expect(c.sql).toContain('"value" > ?');
    expect(c.sql).not.toContain('notional');
  });

  it('the agent contract and tools speak the source\'s schema', async () => {
    const source = inMemorySource(ROWS, 'lcr groups', GROUPS);
    const about = await source.describe();
    expect(about.rowId).toBe('key');
    const d = await describeView(source, parseView({ version: 5 }, GROUPS));
    expect(d.contract.columns.map((c) => c.id)).toEqual(GROUPS.order);
    expect(d.contract.columns.find((c) => c.id === 'entity_id')).toMatchObject({ groupable: true, filter: 'set', aggs: [] });
    expect(viewContract(GROUPS).columns.find((c) => c.id === 'value')!.aggs).toContain('sum');
    const r = await queryView(source, parseView({ version: 5, grouping: ['bucket_code'] }, GROUPS), { limit: 10 });
    expect(r.rows.filter((x) => x.kind === 'group').length).toBe(3);
    const set = setView(parseView({ version: 5 }, GROUPS), { grouping: ['entity_id'] }, {}, GROUPS);
    expect(set.ok).toBe(true);
    const refused = setView(parseView({ version: 5 }, GROUPS), { grouping: ['desk'] }, {}, GROUPS);
    expect(refused.ok).toBe(false);
  });
});
