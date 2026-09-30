/**
 * Row pinning (ADR-77): a pinned row leaves the centre rows for the top,
 * follows the pin order, and leaves the top when the view no longer shows it.
 */

import { describe, expect, it } from 'vitest';
import { headlessTable } from '../src/agent/headless';
import { generatePositions } from '../src/data/mock';
import { parseView } from '../src/grid/viewState';

const BOOK = generatePositions(300);

describe('row pinning', () => {
  it('moves a row from the centre to the top and back', () => {
    const t = headlessTable(BOOK, parseView({ version: 3 }));
    const first = t.getRowModel().rows[0]!;
    const third = t.getRowModel().rows[2]!;
    expect(first.getCanPin()).toBe(true);
    third.pin('top');
    first.pin('top');
    expect(t.getTopRows().map((r) => r.id)).toEqual([third.id, first.id]);
    expect(t.getCenterRows().some((r) => r.id === first.id || r.id === third.id)).toBe(false);
    expect(t.getCenterRows().length).toBe(BOOK.length - 2);
    first.pin(false);
    expect(t.getTopRows().map((r) => r.id)).toEqual([third.id]);
    t.resetRowPinning(true);
    expect(t.getTopRows()).toEqual([]);
    expect(t.getCenterRows().length).toBe(BOOK.length);
  });

  it('a group row cannot be pinned, and a pinned leaf hides with its collapsed group', () => {
    const t = headlessTable(BOOK, parseView({ version: 3, grouping: ['desk'], expanded: true }));
    const group = t.getRowModel().rows.find((r) => r.getIsGrouped())!;
    expect(group.getCanPin()).toBe(false);
    const leaf = t.getRowModel().rows.find((r) => !r.getIsGrouped())!;
    leaf.pin('top');
    expect(t.getTopRows().map((r) => r.id)).toEqual([leaf.id]);
    // The same book with every group collapsed: the pinned leaf is not on
    // screen, so it is not at the top either.
    const collapsed = headlessTable(BOOK, parseView({ version: 3, grouping: ['desk'] }));
    collapsed.getCoreRowModel().rows[0]!.pin('top');
    expect(collapsed.getTopRows()).toEqual([]);
    expect(collapsed.getCenterRows().every((r) => r.getIsGrouped())).toBe(true);
  });
});
