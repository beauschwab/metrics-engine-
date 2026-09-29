/**
 * The agent tools (ADR-69): describe says the contract, set refuses what
 * the contract refuses, query answers as the screen would — and the same
 * three over MCP, through an in-memory transport.
 */

import { describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { inMemorySource } from '../src/data/inMemorySource';
import { DESKS, generatePositions } from '../src/data/mock';
import { COLUMN_ORDER } from '../src/grid/columns';
import { weightedAverage } from '../src/grid/aggregations';
import { defaultView, parseView } from '../src/grid/viewState';
import { VIEW_CONTRACT, describeView, queryView, setView } from '../src/agent/tools';
import { buildGridServer } from '../src/agent/server';

const BOOK = generatePositions(2000);
const source = inMemorySource(BOOK, 'agent book');

describe('describe_view', () => {
  it('reports the source and the contract an agent must write to', async () => {
    const d = await describeView(source, defaultView());
    expect(d.source.rowCount).toBe(2000);
    expect(d.contract.columns.map((c) => c.id)).toEqual(COLUMN_ORDER);
    expect(d.contract.columns.find((c) => c.id === 'desk')).toMatchObject({ groupable: true, filter: 'set' });
    expect(d.contract.columns.find((c) => c.id === 'yield')).toMatchObject({ agg: 'wavg', weightBy: 'notional', filter: 'range' });
    expect(d.contract.columns.find((c) => c.id === 'yield')!.aggs).toContain('wavg');
    expect(d.contract.columns.find((c) => c.id === 'dv01')!.aggs).not.toContain('wavg');
    expect(d.contract.columns.find((c) => c.id === 'desk')!.aggs).toEqual([]);
    expect(Object.keys(d.contract.slices).sort()).toEqual(
      ['columnAggs', 'columnFilters', 'columnFormats', 'columnOrder', 'columnPinning', 'columnSizing', 'columnVisibility', 'computedColumns', 'expanded', 'globalFilter', 'grouping', 'pagination', 'pivot', 'sorting'],
    );
    expect(VIEW_CONTRACT.notes.join(' ')).toMatch(/never a mean of means/);
  });
});

describe('set_view', () => {
  it('merges a patch slice for slice and validates the result', () => {
    const r = setView(defaultView(), { grouping: ['desk'], sorting: [{ id: 'notional', desc: true }] });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.view.grouping).toEqual(['desk']);
      expect(r.view.sorting).toEqual([{ id: 'notional', desc: true }]);
      const again = setView(r.view, { grouping: [] });
      expect(again.ok && again.view.sorting).toEqual([{ id: 'notional', desc: true }]);
    }
  });

  it('refuses an unknown column, an ungroupable grouping, an unknown slice and a non-object', () => {
    const bad = setView(defaultView(), { sorting: [{ id: 'pnl', desc: false }] });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.issues.join('\n')).toMatch(/unknown column: pnl/);
    const grp = setView(defaultView(), { grouping: ['tradeId'] });
    expect(grp.ok).toBe(false);
    const slice = setView(defaultView(), { rowSelection: {} });
    expect(slice.ok).toBe(false);
    expect(setView(defaultView(), 'grouping=desk').ok).toBe(false);
    expect(setView(defaultView(), [1]).ok).toBe(false);
  });

  it('replaces the whole view on request', () => {
    const start = parseView({ version: 1, grouping: ['desk'], globalFilter: 'x' });
    const r = setView(start, { sorting: [{ id: 'mtm', desc: false }] }, { replace: true });
    expect(r.ok && r.view.grouping).toEqual([]);
    expect(r.ok && r.view.globalFilter).toBe('');
  });
});

describe('query_view', () => {
  it('answers a flat view a window at a time, formatted as the screen shows it', async () => {
    const view = parseView({ version: 1, sorting: [{ id: 'notional', desc: true }], columnVisibility: { asOf: false } });
    const r = await queryView(source, view, { limit: 5 });
    expect(r.rows.length).toBe(5);
    expect(r.total).toBe(2000);
    expect(r.truncated).toBe(true);
    expect(r.columns).not.toContain('asOf');
    expect(r.rows[0]!.values.notional).toBe(Math.max(...BOOK.map((b) => b.notional)));
    expect(r.rows[0]!.display!.notional).toMatch(/^\$[\d,]+\.\dM$/);
    expect(r.rows[0]!.display!.yield).toMatch(/^\d+\.\d\d%$/);
    expect(r.totals.values.notional).toBeCloseTo(BOOK.reduce((a, b) => a + b.notional, 0), 3);
    expect(r.applied).toEqual({ filter: false, sort: false, group: false });
    const next = await queryView(source, view, { limit: 5, offset: 1995 });
    expect(next.rows.length).toBe(5);
    expect(next.truncated).toBe(false);
  });

  it('answers a grouped view with subtotals equal to brute force, collapsed as the view stands', async () => {
    const view = parseView({ version: 1, grouping: ['desk'] });
    const r = await queryView(source, view);
    expect(r.rows.length).toBe(DESKS.length);
    for (const row of r.rows) {
      expect(row.kind).toBe('group');
      const mine = BOOK.filter((b) => b.desk === row.group!.value);
      expect(row.group!.count).toBe(mine.length);
      expect(row.values.notional).toBeCloseTo(mine.reduce((a, b) => a + b.notional, 0), 3);
      expect(row.values.yield).toBeCloseTo(weightedAverage(mine.map((b) => b.yield), mine.map((b) => b.notional))!, 9);
      expect(row.values.counterparty).toBeUndefined();
    }
    const open = await queryView(source, view, { expandAll: true, limit: 1000 });
    expect(open.modelRows).toBe(DESKS.length + 2000);
    expect(open.rows[1]!.kind).toBe('leaf');
    expect(open.rows[1]!.depth).toBe(1);
  });

  it('honours the view’s filters in the total', async () => {
    const view = parseView({ version: 1, columnFilters: [{ id: 'product', value: ['Bond'] }] });
    const r = await queryView(source, view, { limit: 1, display: false });
    expect(r.total).toBe(BOOK.filter((b) => b.product === 'Bond').length);
    expect(r.rows[0]!.display).toBeUndefined();
  });
});

describe('the MCP server', () => {
  it('serves the three tools over an in-memory transport and keeps one session view', async () => {
    const server = buildGridServer(source);
    const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
    await server.connect(serverSide);
    const client = new Client({ name: 'test', version: '0' });
    await client.connect(clientSide);
    const json = (r: unknown) => JSON.parse((r as { content: Array<{ text: string }> }).content[0]!.text);

    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(['describe_view', 'query_view', 'set_view']);

    const described = json(await client.callTool({ name: 'describe_view', arguments: {} }));
    expect(described.source.name).toBe('agent book');
    expect(described.view.grouping).toEqual([]);

    const refused = await client.callTool({ name: 'set_view', arguments: { patch: { grouping: ['tradeId'] } } });
    expect(refused.isError).toBe(true);
    expect(json(refused).issues.join('\n')).toMatch(/not groupable/);

    const set = json(await client.callTool({ name: 'set_view', arguments: { patch: { grouping: ['desk'] } } }));
    expect(set.view.grouping).toEqual(['desk']);

    const q = json(await client.callTool({ name: 'query_view', arguments: { limit: 10 } }));
    expect(q.rows.length).toBe(DESKS.length);
    expect(q.rows[0].kind).toBe('group');

    // A supplied view answers without changing the session's.
    const other = json(await client.callTool({ name: 'query_view', arguments: { limit: 2, view: { version: 1 } } }));
    expect(other.rows[0].kind).toBe('leaf');
    const still = json(await client.callTool({ name: 'describe_view', arguments: {} }));
    expect(still.view.grouping).toEqual(['desk']);

    await client.close();
    await server.close();
  });
});
