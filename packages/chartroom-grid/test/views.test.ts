/**
 * Saved views and the URL (ADR-69): a store re-validates on read and drops
 * what no longer parses; a link carries the view and refuses what it cannot.
 */

import { describe, expect, it } from 'vitest';
import { defaultView, parseView } from '../src/grid/viewState';
import { memoryViewStore, storageViewStore, type KeyValueStorage } from '../src/views/store';
import { readViewFromHash, viewFromParam, viewToParam, writeViewToHash } from '../src/views/url';

const fakeStorage = (): KeyValueStorage & { data: Map<string, string> } => {
  const data = new Map<string, string>();
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => { data.set(k, v); } };
};

describe('the view store', () => {
  it('saves, lists, replaces by id and removes', async () => {
    for (const store of [memoryViewStore(), storageViewStore(fakeStorage())]) {
      const v = parseView({ version: 1, grouping: ['desk'] });
      const saved = await store.save('By desk', v);
      expect((await store.list()).map((s) => s.name)).toEqual(['By desk']);
      const updated = await store.save('By desk, sorted', { ...v, sorting: [{ id: 'mtm', desc: true }] }, saved.id);
      expect(updated.id).toBe(saved.id);
      const list = await store.list();
      expect(list.length).toBe(1);
      expect(list[0]!.view.sorting).toEqual([{ id: 'mtm', desc: true }]);
      await store.remove(saved.id);
      expect(await store.list()).toEqual([]);
    }
  });

  it('drops a stored view that no longer parses, and counts it, rather than rendering it', async () => {
    const storage = fakeStorage();
    storage.setItem('chartroom-grid.views', JSON.stringify([
      { id: 'a', name: 'good', view: { version: 1, grouping: ['currency'] }, savedAt: 'x' },
      { id: 'b', name: 'old', view: { version: 0, grouping: ['currency'] }, savedAt: 'x' },
      { id: 'c', name: 'bad column', view: { version: 1, sorting: [{ id: 'pnl', desc: true }] }, savedAt: 'x' },
      'not even an object',
    ]));
    const store = storageViewStore(storage);
    const list = await store.list();
    expect(list.map((s) => s.id)).toEqual(['a']);
    expect(store.dropped()).toBe(3);
    // Corrupt JSON reads as empty, never throws into the UI.
    storage.setItem('chartroom-grid.views', '{nope');
    expect(await store.list()).toEqual([]);
  });
});

describe('the view in a URL', () => {
  it('writes nothing for the default view and round-trips any other', () => {
    expect(viewToParam(defaultView())).toBeNull();
    const v = parseView({ version: 1, grouping: ['desk', 'currency'], columnFilters: [{ id: 'product', value: ['Bond'] }], globalFilter: 'CP-01' });
    const param = viewToParam(v)!;
    expect(param).toMatch(/^[A-Za-z0-9_-]+$/);
    const back = viewFromParam(param);
    expect(back.ok && back.view).toEqual(v);
  });

  it('reads and writes the hash on its route, and refuses what does not parse', () => {
    const v = parseView({ version: 1, sorting: [{ id: 'notional', desc: true }] });
    const hash = writeViewToHash('#/grid', v);
    expect(hash).toMatch(/^#\/grid\?v=[A-Za-z0-9_-]+$/);
    const read = readViewFromHash(hash);
    expect(read?.ok && read.view).toEqual(v);
    expect(writeViewToHash(hash, defaultView())).toBe('#/grid');
    expect(readViewFromHash('#/grid')).toBeNull();
    const bad = readViewFromHash('#/grid?v=not-json');
    expect(bad?.ok).toBe(false);
    const wrong = readViewFromHash(writeViewToHash('#/grid', { ...v, version: 99 as 6 }));
    expect(wrong?.ok).toBe(false);
  });
});
