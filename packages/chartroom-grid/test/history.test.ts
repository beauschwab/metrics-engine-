/**
 * Undo and redo (ADR-76): a stack of views, equal views are not steps, a
 * resize drag is one step, and the depth is bounded.
 */

import { describe, expect, it } from 'vitest';
import { canRedo, canUndo, createHistory, pushHistory, redoHistory, undoHistory } from '../src/views/history';
import { defaultView, parseView } from '../src/grid/viewState';

describe('view history', () => {
  it('pushes, undoes and redoes through the same views, and a redo branch dies on a new push', () => {
    const v0 = defaultView();
    const v1 = parseView({ ...v0, grouping: ['desk'] });
    const v2 = parseView({ ...v1, sorting: [{ id: 'notional', desc: true }] });
    let h = createHistory(v0, 0);
    expect(canUndo(h)).toBe(false);
    h = pushHistory(h, v1, {}, 1);
    h = pushHistory(h, v2, {}, 2);
    expect(h.past.length).toBe(2);
    h = undoHistory(h);
    expect(h.present).toEqual(v1);
    expect(canRedo(h)).toBe(true);
    h = redoHistory(h);
    expect(h.present).toEqual(v2);
    h = undoHistory(h);
    h = pushHistory(h, parseView({ ...v1, grouping: ['desk', 'currency'] }), {}, 3);
    expect(canRedo(h)).toBe(false);
    expect(h.past.map((v) => v.grouping)).toEqual([[], ['desk']]);
  });

  it('an equal view is not a step', () => {
    const v0 = defaultView();
    const h = pushHistory(createHistory(v0, 0), parseView({ ...v0 }), {}, 1);
    expect(h.past.length).toBe(0);
  });

  it('a run of resizes within the window is one step; a pause or another change starts a new one', () => {
    const v0 = defaultView();
    let h = createHistory(v0, 0);
    h = pushHistory(h, parseView({ ...v0, columnSizing: { desk: 100 } }), {}, 10);
    h = pushHistory(h, parseView({ ...v0, columnSizing: { desk: 110 } }), {}, 20);
    h = pushHistory(h, parseView({ ...v0, columnSizing: { desk: 120 } }), {}, 30);
    expect(h.past.length).toBe(1);
    expect(h.present.columnSizing).toEqual({ desk: 120 });
    h = pushHistory(h, parseView({ ...v0, columnSizing: { desk: 130 } }), {}, 5000);
    expect(h.past.length).toBe(2);
    h = pushHistory(h, parseView({ ...v0, columnSizing: { desk: 130 }, grouping: ['desk'] }), {}, 5001);
    expect(h.past.length).toBe(3);
    expect(undoHistory(h).present.columnSizing).toEqual({ desk: 130 });
  });

  it('keeps at most the limit behind the present', () => {
    let h = createHistory(defaultView(), 0);
    for (let i = 1; i <= 12; i++) h = pushHistory(h, parseView({ ...defaultView(), columnSizing: { desk: 50 + i } }), { limit: 5, coalesceMs: 0 }, i * 1000);
    expect(h.past.length).toBe(5);
    expect(h.past[0]!.columnSizing).toEqual({ desk: 57 });
  });
});
