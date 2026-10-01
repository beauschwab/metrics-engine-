/**
 * What the MCP pressure test found (ADR-91), held: the server lists columns in
 * screen order, refuses a view that says two things at once or a search token
 * that cannot mean anything, warns when a view names values the data does not
 * have — and says where the value lives — lists a dimension's values for an
 * agent to copy, bounds a pivot, and reports a rule's emphasis per cell.
 * The full stdio battery and the blind-agent trials live in `.pressure/`.
 */

import { describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { inMemorySource } from '../src/data/inMemorySource';
import { generatePositions } from '../src/data/mock';
import { defaultView } from '../src/grid/viewState';
import { agentIssues, queryView, setView } from '../src/agent/tools';
import { buildGridServer } from '../src/agent/server';
import { TREASURY_SCHEMA } from '../src/data/treasury';

const BOOK = generatePositions(3000);

async function connect() {
  const server = buildGridServer(inMemorySource(BOOK, 'pressure book'));
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await server.connect(serverSide);
  const client = new Client({ name: 'pressure', version: '0' });
  await client.connect(clientSide);
  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const r = await client.callTool({ name, arguments: args });
    return { isError: !!r.isError, body: JSON.parse((r.content as Array<{ text: string }>)[0]!.text) };
  };
  return call;
}

describe('a view says one thing', () => {
  const refused = (patch: Record<string, unknown>, mention: RegExp) => {
    const r = setView(defaultView(), patch);
    expect(r.ok, JSON.stringify(patch)).toBe(false);
    if (!r.ok) expect(r.issues.join(' ')).toMatch(mention);
  };

  it('refuses a column named twice in a slice, or pinned at both ends', () => {
    refused({ grouping: ['desk', 'desk'] }, /grouping names desk twice/);
    refused({ sorting: [{ id: 'desk', desc: false }, { id: 'desk', desc: true }] }, /sorting names desk twice/);
    refused({ columnFilters: [{ id: 'desk', value: ['Rates'] }, { id: 'desk', value: ['FX'] }] }, /one filter per column/);
    refused({ columnOrder: ['desk', 'desk'] }, /columnOrder names desk twice/);
    refused({ columnPinning: { start: ['desk'], end: ['desk'] } }, /pins to one end/);
  });

  it('refuses search tokens that cannot mean anything, and says why', () => {
    expect(agentIssues({ ...defaultView(), globalFilter: 'notional>abc' }, TREASURY_SCHEMA).join()).toMatch(/needs a number/);
    expect(agentIssues({ ...defaultView(), globalFilter: 'region:EMEA' }, TREASURY_SCHEMA).join()).toMatch(/region is not a column/);
    // A quoted token is text by choice, and a real column passes.
    expect(agentIssues({ ...defaultView(), globalFilter: '"region:EMEA" desk:Rates' }, TREASURY_SCHEMA)).toEqual([]);
  });

  it('refuses an expanded key that does not follow the grouping', () => {
    const r = setView(defaultView(), { grouping: ['desk'], expanded: { 'legalEntity:WF-US': true } });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.issues[0]).toMatch(/level 1 must be "desk:<value>"/);
    expect(setView(defaultView(), { grouping: ['desk', 'legalEntity'], expanded: { 'desk:Rates>legalEntity:WF-US': true } }).ok).toBe(true);
  });

  it('says what a calculated column id may be', () => {
    const r = setView(defaultView(), { computedColumns: [{ id: 'c:mtm-pct', label: 'X', op: 'ratio', of: ['mtm', 'notional'] }] });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.issues.join()).toMatch(/lowercase letters, digits or underscores/);
  });
});

describe('the answer reads as the screen does', () => {
  it('lists columns in screen order, pinned first', async () => {
    const r = setView(defaultView(), { columnPinning: { start: ['desk'], end: ['wal'] }, columnOrder: ['counterparty'] });
    expect(r.ok).toBe(true);
    const q = await queryView(inMemorySource(BOOK), r.ok ? r.view : defaultView(), { limit: 1 });
    expect(q.columns[0]).toBe('desk');
    expect(q.columns[1]).toBe('counterparty');
    expect(q.columns.at(-1)).toBe('wal');
  });

  it('reports the emphasis a highlight rule gives a cell', async () => {
    const r = setView(defaultView(), { columnFormats: { notional: { rules: [{ op: '>', value: 2e9, emphasis: 'strong' }] } }, sorting: [{ id: 'notional', desc: true }] });
    const q = await queryView(inMemorySource(BOOK), r.ok ? r.view : defaultView(), { limit: 1 });
    expect(q.rows[0]!.emphasis).toEqual({ notional: 'strong' });
  });
});

describe('over MCP, against the data', () => {
  it('lists a small dimension’s values and a large one’s count', async () => {
    const call = await connect();
    const { body } = await call('describe_view');
    const col = (id: string) => body.contract.columns.find((c: { id: string }) => c.id === id);
    expect([...col('desk').values].sort()).toEqual(['Credit', 'FX', 'Funding', 'Mortgages', 'Rates']);
    expect(col('counterparty').values).toBeUndefined();
    expect(col('counterparty').distinct).toBe(320);
    expect(col('notional').values).toBeUndefined();
    // An ordered dimension lists its values in its own order.
    expect(col('tenorBucket').values).toEqual(['O/N', '1W', '1M', '3M', '6M', '1Y', '5Y', '10Y+']);
    expect(body.contract.slices.pivot).toMatch(/only up to 50 values/);
  });

  it('warns when a filter names a value the column does not have, and says which column has it', async () => {
    const call = await connect();
    // The blind agent's slip: WF-US is an entity, not a book — the filter kept every row.
    let r = await call('set_view', { patch: { globalFilter: 'book!=WF-US' } });
    expect(r.isError).toBe(false);
    expect(r.body.warnings.join()).toMatch(/Book \(book\) has no value "WF-US" — it is a value of Entity \(legalEntity\)/);
    // The warning stands on every answer while the view does.
    const q = await call('query_view', { limit: 1 });
    expect(q.body.warnings.join()).toMatch(/WF-US/);
    // Set values match exactly: the wrong case filters to nothing, and the right spelling is offered.
    r = await call('set_view', { patch: { columnFilters: [{ id: 'desk', value: ['rates'] }] }, replace: true });
    expect(r.body.warnings.join()).toMatch(/did you mean "Rates"/);
    r = await call('set_view', { patch: { grouping: ['desk'], expanded: { 'desk:Nonesuch': true } }, replace: true });
    expect(r.body.warnings.join()).toMatch(/expanded desk:Nonesuch/);
    r = await call('set_view', { patch: { pivot: { column: 'currency', values: ['notional'], buckets: ['ZZZ'] } }, replace: true });
    expect(r.body.warnings.join()).toMatch(/pivot\.buckets/);
    // A clean view carries no warnings at all.
    r = await call('set_view', { patch: { columnFilters: [{ id: 'desk', value: ['Rates'] }] }, replace: true });
    expect(r.body.warnings).toBeUndefined();
  });

  it('refuses a pivot that would spread hundreds of columns, and keeps the view it had', async () => {
    const call = await connect();
    await call('set_view', { patch: { grouping: ['desk'] } });
    const r = await call('set_view', { patch: { pivot: { column: 'counterparty', values: ['notional'], buckets: [] } } });
    expect(r.isError).toBe(true);
    expect(r.body.issues.join()).toMatch(/320 values .* name up to 50 in pivot\.buckets/);
    expect((await call('describe_view')).body.view.pivot.column).toBeNull();
    // Named buckets are fine.
    expect((await call('set_view', { patch: { pivot: { column: 'counterparty', values: ['notional'], buckets: ['CP-0001', 'CP-0002'] } } })).isError).toBe(false);
    // And a query's own view is held to the same checks.
    const q = await call('query_view', { view: { pivot: { column: 'counterparty', values: [], buckets: [] } } });
    expect(q.isError).toBe(true);
  });
});
