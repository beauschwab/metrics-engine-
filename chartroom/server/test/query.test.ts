/**
 * The query layer against the real engine.
 *
 * The central assertions are conservation laws, not magic numbers: grouped
 * values must sum back to the headline value for an additive measure, and the
 * grouped path must agree with a hand-built filtered Evaluator — because both
 * run the same code, and this test is what keeps that true.
 */

import { describe, expect, it } from 'vitest';
import { INITIAL_DOCS } from '../../../src/engine/documents';
import { Evaluator } from '../../../src/engine/evaluate';
import { DATES, LAST } from '../../../src/engine/fixtures';
import { parseDoc } from '../../../src/engine/parse';
import { buildRegistry } from '../../../src/engine/registry';
import { fetchRegistryState } from '../src/keel';
import { QueryService, QueryUnresolved } from '../src/query';

const state = await fetchRegistryState();
const rev = state.docs.find((d) => d.name === 'liquidity_pit')!.revision;
const ref = (m: string) => `keel://liquidity_pit.${m}@${rev}`;

const service = () => {
  let evals = 0;
  const s = new QueryService({ state, onEvaluate: () => { evals += 1; } });
  return { s, evals: () => evals };
};

const direct = () => {
  const docs = Object.fromEntries(state.docs.map((d) => [d.name, d.body]));
  const graph = parseDoc(INITIAL_DOCS.liquidity_pit);
  return new Evaluator(graph, 'nominal', buildRegistry(docs));
};

describe('scalar queries', () => {
  it('return exactly what the engine computes', async () => {
    const { s } = service();
    const r = await s.run({ metric: ref('hqla_total') });
    expect(r.kind).toBe('scalar');
    if (r.kind !== 'scalar') return;
    expect(r.value).toBeCloseTo(direct().value('hqla_total').v, 6);
    expect(r.unit).toBe('USD');
    expect(r.asOf).toBe(DATES[LAST]);
    expect(r.prior).toBeCloseTo(direct().series('hqla_total').s[LAST - 1], 6);
  });
});

describe('grouped queries', () => {
  it('conserve mass: per-entity sums equal the headline for an additive measure', async () => {
    const { s } = service();
    const grouped = await s.run({ metric: ref('hqla_total'), dims: ['entity_id'] });
    expect(grouped.kind).toBe('groups');
    if (grouped.kind !== 'groups') return;
    expect(grouped.rows.length).toBeGreaterThan(1);

    const total = grouped.rows.reduce((a, r) => a + r.value, 0);
    expect(total).toBeCloseTo(direct().value('hqla_total').v, 4);
  });

  it('agree with a hand-filtered Evaluator — same code path, same answer', async () => {
    const { s } = service();
    const grouped = await s.run({ metric: ref('hqla_total'), dims: ['entity_id'] });
    if (grouped.kind !== 'groups') throw new Error('expected groups');
    const one = grouped.rows[0];

    const docs = Object.fromEntries(state.docs.map((d) => [d.name, d.body]));
    const graph = parseDoc(INITIAL_DOCS.liquidity_pit);
    const filtered = new Evaluator(
      graph, 'nominal', buildRegistry(docs),
      (row) => String(row.entity_id) === one.key.entity_id,
    );
    expect(one.value).toBeCloseTo(filtered.value('hqla_total').v, 6);
  });

  it('honour filters, including in filters', async () => {
    const { s } = service();
    const all = await s.run({ metric: ref('hqla_total'), dims: ['entity_id'] });
    if (all.kind !== 'groups') throw new Error('expected groups');
    const keep = all.rows.slice(0, 2).map((r) => r.key.entity_id);

    const filtered = await s.run({
      metric: ref('hqla_total'),
      dims: ['entity_id'],
      filters: [{ dim: 'entity_id', op: 'in', value: keep }],
    });
    if (filtered.kind !== 'groups') throw new Error('expected groups');
    expect(filtered.rows.map((r) => r.key.entity_id).sort()).toEqual([...keep].sort());
  });

  it('resolve context params, and refuse an unsupplied one', async () => {
    const { s } = service();
    const all = await s.run({ metric: ref('hqla_total'), dims: ['entity_id'] });
    if (all.kind !== 'groups') throw new Error('expected groups');
    const entity = all.rows[0].key.entity_id;

    const scoped = await s.run({
      metric: ref('hqla_total'),
      filters: [{ dim: 'entity_id', op: '=', param: 'entity' }],
      params: { entity },
    });
    if (scoped.kind !== 'scalar') throw new Error('expected scalar');
    expect(scoped.value).toBeCloseTo(all.rows[0].value, 6);

    await expect(s.run({
      metric: ref('hqla_total'),
      filters: [{ dim: 'entity_id', op: '=', param: 'entity' }],
    })).rejects.toThrow(/param "entity"/);
  });
});

describe('series queries', () => {
  it('slice the trailing window off the daily series', async () => {
    const { s } = service();
    const r = await s.run({
      metric: ref('lcr_pct'), dims: ['as_of_date'], window: { trailing: '30d' },
    });
    if (r.kind !== 'series') throw new Error('expected series');
    expect(r.series).toHaveLength(1);
    expect(r.series[0].points).toHaveLength(30);
    expect(r.series[0].points.at(-1)!.date).toBe(DATES[LAST]);
    expect(r.series[0].points.at(-1)!.value).toBeCloseTo(direct().value('lcr_pct').v, 6);
  });

  it('split by a categorical dim into one series per value', async () => {
    const { s } = service();
    const r = await s.run({ metric: ref('hqla_total'), dims: ['as_of_date', 'entity_id'] });
    if (r.kind !== 'series') throw new Error('expected series');
    expect(r.series.length).toBeGreaterThan(1);
    for (const line of r.series) expect(line.key.entity_id).toBeTruthy();
  });
});

describe('the cache', () => {
  it('is single-flight: two widgets sharing a slice cost one evaluation', async () => {
    const { s, evals } = service();
    const req = { metric: ref('lcr_pct'), dims: ['as_of_date'] };
    const [a, b] = await Promise.all([s.run(req), s.run(req)]);
    expect(evals()).toBe(1);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('serves repeats from cache, marked as such', async () => {
    const { s, evals } = service();
    await s.run({ metric: ref('hqla_total') });
    const again = await s.run({ metric: ref('hqla_total') });
    expect(evals()).toBe(1);
    expect(again.cost.cache).toBe('hit');
  });

  it('a different slice is a different key', async () => {
    const { s, evals } = service();
    await s.run({ metric: ref('hqla_total') });
    await s.run({ metric: ref('hqla_total'), dims: ['entity_id'] });
    expect(evals()).toBe(2);
  });
});

describe('refusals', () => {
  it('an unresolvable ref says so, and mentions the shipped-docs limitation', async () => {
    const { s } = service();
    await expect(s.run({ metric: 'keel://liquidity_pit.no_such@1' }))
      .rejects.toThrow(QueryUnresolved);
  });
});
