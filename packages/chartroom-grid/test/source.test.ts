/**
 * The data seam (ADR-64, ADR-66): the in-memory source describes the book,
 * answers a view honestly about what it applied, and serves a group path
 * the way a remote source will have to.
 */

import { describe, expect, it } from 'vitest';
import { inMemorySource } from '../src/data/inMemorySource';
import { generatePositions } from '../src/data/mock';
import { COLUMN_META, COLUMN_ORDER } from '../src/grid/columns';
import { defaultView, parseView } from '../src/grid/viewState';

const BOOK = generatePositions(50_000);

describe('the seeded book at scale', () => {
  it('is fifty thousand distinct trades, deterministic on the default seed', () => {
    expect(BOOK.length).toBe(50_000);
    expect(new Set(BOOK.map((r) => r.tradeId)).size).toBe(50_000);
    expect(BOOK[0]!.tradeId).toBe('T000001');
    expect(BOOK.at(-1)!.tradeId).toBe('T050000');
    expect(generatePositions(50_000)[12_345]).toEqual(BOOK[12_345]);
  });
});

describe('the in-memory source', () => {
  const source = inMemorySource(BOOK, 'test book');

  it('describes the book from the meta, not a second column list', async () => {
    const about = await source.describe();
    expect(about.name).toBe('test book');
    expect(about.rowCount).toBe(50_000);
    expect(about.asOf).toBe('2026-09-28');
    expect(about.columns.map((c) => c.id)).toEqual(COLUMN_ORDER);
    for (const c of about.columns) expect(c.meta).toBe(COLUMN_META[c.id as keyof typeof COLUMN_META]);
    expect(about.serves).toEqual({ filter: false, sort: false, group: false, groupPath: true, window: false });
  });

  it('answers a view with everything and says it applied nothing', async () => {
    const r = await source.query(parseView({ version: 1, sorting: [{ id: 'mtm', desc: true }] }));
    expect(r.rows).toBe(BOOK);
    expect(r.total).toBe(50_000);
    expect(r.applied).toEqual({ filter: false, sort: false, group: false });
  });

  it('serves the rows under a group path, matching brute force', async () => {
    const view = parseView({ version: 1, grouping: ['desk', 'currency'] });
    const one = await source.query(view, { groupPath: ['Credit'] });
    expect(one.rows).toEqual(BOOK.filter((r) => r.desk === 'Credit'));
    const two = await source.query(view, { groupPath: ['Credit', 'EUR'] });
    expect(two.rows).toEqual(BOOK.filter((r) => r.desk === 'Credit' && r.currency === 'EUR'));
    expect(two.total).toBe(two.rows.length);
    expect(two.rows.length).toBeGreaterThan(0);
  });

  it('refuses a path deeper than the grouping rather than guessing a dimension', async () => {
    await expect(source.query(defaultView(), { groupPath: ['Credit'] })).rejects.toThrow(RangeError);
  });
});
