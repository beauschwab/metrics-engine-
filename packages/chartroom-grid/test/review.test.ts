/**
 * The pre-merge review of PR #11, held: an agent's grouping change drops the
 * expanded keys it orphans; a served grouping opens the groups an agent names
 * by their contract ids and answers with them; a band whose limit has not
 * arrived keeps the rest of a saved view; a count is never rescaled as basis
 * points nor emphasised by the column's rules; an export opens the groups the
 * reader opened over a served grouping; a source that never started closes
 * quietly; the row id is not listed as a vocabulary.
 */

import { describe, expect, it } from 'vitest';
import { generatePositions } from '../src/data/mock';
import { inMemorySource } from '../src/data/inMemorySource';
import { sqlSource, groupNodeId } from '../src/data/sqlSource';
import { SQLITE } from '../src/data/compileSql';
import { contractGroupId, contractGroupPath } from '../src/data/groupNode';
import { duckdbSource } from '../src/data/duckdbSource';
import { metricGroupRows, metricGroupsSchema, metricScale } from '../src/data/metricGroups';
import { headlessTable } from '../src/agent/headless';
import { describeView, queryView, setView } from '../src/agent/tools';
import { chartFromRange } from '../src/grid/chart';
import { defaultView, parseView, safeParseView } from '../src/grid/viewState';
import { sqliteExecutor } from './sqliteExecutor';

const BOOK = generatePositions(1200);

describe('an agent changes its grouping', () => {
  it('drops the expanded keys the new grouping orphans, and keeps those it still fits', () => {
    const a = setView(defaultView(), { grouping: ['desk'], expanded: { 'desk:Rates': true } });
    expect(a.ok).toBe(true);
    const b = setView(a.ok ? a.view : defaultView(), { grouping: ['book'] });
    expect(b.ok).toBe(true);
    if (b.ok) expect(b.view.expanded).toEqual({});
    const c = setView(a.ok ? a.view : defaultView(), { grouping: ['desk', 'legalEntity'] });
    if (c.ok) expect(c.view.expanded).toEqual({ 'desk:Rates': true });
    // A key it writes itself is still held to the grouping.
    expect(setView(defaultView(), { grouping: ['book'], expanded: { 'desk:Rates': true } }).ok).toBe(false);
  });
});

describe('a served grouping over MCP', () => {
  const sql = sqlSource({ executor: sqliteExecutor(BOOK), table: 'positions', dialect: SQLITE });

  it('names groups by their contract ids and opens only the ones the view names', async () => {
    const r = setView(defaultView(), { grouping: ['desk', 'legalEntity'], expanded: { 'desk:Rates': true, 'desk:Rates>legalEntity:WF-US': true } });
    expect(r.ok).toBe(true);
    const q = await queryView(sql, r.ok ? r.view : defaultView(), { limit: 1000 });
    expect(q.applied.group).toBe(true);
    const groups = q.rows.filter((x) => x.kind === 'group');
    expect(groups.map((g) => g.id)).toContain('desk:Rates');
    expect(groups.map((g) => g.id)).toContain('desk:Rates>legalEntity:WF-US');
    expect(groups.every((g) => !g.id.startsWith('g:'))).toBe(true);
    const leaves = q.rows.filter((x) => x.kind === 'leaf');
    const want = BOOK.filter((p) => p.desk === 'Rates' && p.legalEntity === 'WF-US');
    expect(leaves.map((l) => l.id).sort()).toEqual(want.map((p) => p.tradeId).sort());
    // The ids an answer gives are ids set_view takes.
    expect(setView(defaultView(), { grouping: ['desk', 'legalEntity'], expanded: Object.fromEntries(groups.map((g) => [g.id, true])) }).ok).toBe(true);
  });

  it('translates between the contract and the engine', () => {
    expect(contractGroupId(['desk', 'legalEntity'], ['Rates', 'WF-US'])).toBe('desk:Rates>legalEntity:WF-US');
    expect(contractGroupPath('desk:Rates>legalEntity:WF-US')).toEqual(['Rates', 'WF-US']);
    expect(groupNodeId(contractGroupPath('desk:Rates'))).toBe('g:Rates');
  });
});

describe('a band whose limit has not arrived', () => {
  it('keeps the rest of a saved dashboard view', () => {
    const shape = { measure: 'lcr_pct', unit: 'percent', format: 'percent_1dp', dims: [{ name: 'entity_id' }] };
    const noLimit = metricGroupsSchema(shape, ['entity_id'], { history: true });
    const saved = { version: 6, grouping: ['entity_id'], columnFormats: { value: { trend: 'band' } } };
    const r = safeParseView(saved, noLimit);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.view.grouping).toEqual(['entity_id']);
  });
});

describe('a count is a number of rows', () => {
  it('is never rescaled as basis points when charted', () => {
    const shape = { measure: 'spread', unit: 'percent', format: 'bps', dims: [{ name: 'entity_id' }, { name: 'bucket' }] };
    const schema = metricGroupsSchema(shape, ['entity_id', 'bucket']);
    const rows = metricGroupRows([
      { key: { entity_id: 'WF-US', bucket: 'a' }, value: 0.01, prior: 0.01 },
      { key: { entity_id: 'WF-US', bucket: 'b' }, value: 0.02, prior: 0.02 },
    ], ['entity_id', 'bucket'], metricScale('bps'));
    const t = headlessTable(rows, parseView({ version: 6, grouping: ['entity_id'], columnAggs: { value: 'count' } }, schema), schema);
    t.selectCellRange({ anchorRowId: 'entity_id:WF-US', anchorColumnId: 'entity_id', focusRowId: 'entity_id:WF-US', focusColumnId: 'value' });
    const outcome = chartFromRange(t);
    expect(outcome.ok).toBe(true);
    if (outcome.ok) expect(outcome.request.series[0]!.data.rows[0]!.value).toBe(2);
  });

  it('carries no emphasis from the column’s rules', async () => {
    const r = setView(defaultView(), { grouping: ['desk'], columnAggs: { notional: 'count' }, columnFormats: { notional: { rules: [{ op: '>', value: 5, emphasis: 'strong' }] } } });
    const q = await queryView(inMemorySource(BOOK), r.ok ? r.view : defaultView(), { limit: 5 });
    expect(q.rows[0]!.values.notional).toBeGreaterThan(5);
    expect(q.rows[0]!.emphasis).toBeUndefined();
  });
});

describe('a source let go', () => {
  it('closes quietly when it never started, and when it never ran', async () => {
    await expect(duckdbSource(BOOK.slice(0, 3)).close!()).resolves.toBeUndefined();
  });
});

describe('describe_view', () => {
  it('does not list the row id as a vocabulary', async () => {
    const d = await describeView(inMemorySource(BOOK), defaultView());
    const trade = d.contract.columns.find((c) => c.id === 'tradeId')!;
    expect(trade.values).toBeUndefined();
    expect(trade.distinct).toBeUndefined();
    expect(d.contract.columns.find((c) => c.id === 'desk')!.values).toHaveLength(5);
  });
});
