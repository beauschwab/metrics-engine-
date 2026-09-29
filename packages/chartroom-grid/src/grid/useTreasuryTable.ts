/**
 * The one hook that owns the table.
 *
 * Features, columns and the row identity are fixed here; a screen supplies
 * the rows and the view. Every registered state slice is controlled from
 * the view (ADR-66): v9 has no global state callback, so one updater on the
 * view fans out to one change handler per slice, and a feature API such as
 * `column.toggleSorting()` writes the view through it. Nothing else
 * constructs a table — the group-by zone, the sidebar, the export and the
 * agent tools all reach the same instance, which is the only way "view
 * state is the contract" can be true rather than aspirational.
 */

import { useMemo } from 'react';
import { functionalUpdate, useTable, type OnChangeFn, type ReactTable, type Updater } from '@tanstack/react-table';
import { features, type Features } from './features';
import { SELECT_ID, columns, selectColumn } from './columns';
import { toTableState, type ViewSlice, type ViewState } from './viewState';
import type { Position } from '../data/mock';

export type TreasuryTable = ReactTable<Features, Position>;

/** A functional update on the view, the shape React's own setter takes. */
export type ViewUpdate = (prev: ViewState) => ViewState;

export interface TreasuryTableOptions {
  /** The rows the source answered with; null while it has not. */
  data: Position[] | null;
  view: ViewState;
  onViewChange: (update: ViewUpdate) => void;
}

/** The module-level empty array v9 asks for: a fresh `[]` per render would rerun every row model. */
const NO_ROWS: Position[] = [];

/** The selection column first, then every data column. One stable array. */
const allColumns = [selectColumn, ...columns];

const withoutSelect = (ids: string[]) => ids.filter((id) => id !== SELECT_ID);

export function useTreasuryTable({ data, view, onViewChange }: TreasuryTableOptions): TreasuryTable {
  const handlers = useMemo(() => {
    const slice =
      <K extends ViewSlice>(key: K): OnChangeFn<ViewState[K]> =>
      (updater: Updater<ViewState[K]>) =>
        onViewChange((prev) => ({ ...prev, [key]: functionalUpdate(updater, prev[key]) }));
    return {
      onGroupingChange: slice('grouping'),
      onColumnFiltersChange: slice('columnFilters'),
      // v9's reset writes `undefined`; the contract says a string, and an
      // input bound to it must never go uncontrolled.
      onGlobalFilterChange: (updater: Updater<string | undefined>) =>
        onViewChange((prev) => ({ ...prev, globalFilter: functionalUpdate(updater, prev.globalFilter) ?? '' })),
      onSortingChange: slice('sorting'),
      onExpandedChange: slice('expanded'),
      onColumnVisibilityChange: slice('columnVisibility'),
      // The selection column is pinned at the start by the hook, never by
      // the view: strip it before a pinning or order update reaches the view,
      // so a saved view never names a column it cannot validate.
      onColumnOrderChange: (updater: Updater<string[]>) =>
        onViewChange((prev) => ({ ...prev, columnOrder: withoutSelect(functionalUpdate(updater, prev.columnOrder)) })),
      onColumnPinningChange: (updater: Updater<ViewState['columnPinning']>) =>
        onViewChange((prev) => {
          const next = functionalUpdate(updater, prev.columnPinning);
          return { ...prev, columnPinning: { start: withoutSelect(next.start), end: withoutSelect(next.end) } };
        }),
      onColumnSizingChange: slice('columnSizing'),
    };
  }, [onViewChange]);

  const base = toTableState(view);
  return useTable({
    features,
    columns: allColumns,
    data: data ?? NO_ROWS,
    getRowId: (row) => row.tradeId,
    // Grouped columns move to the front, AG Grid's shape: the tree reads
    // left to right, and a chip's order is the column order.
    groupedColumnMode: 'reorder',
    // The view owns expansion (ADR-66); the table must not rewrite it when
    // the grouping or the data changes underneath.
    autoResetExpanded: false,
    // Resizing writes the view on every pointer move; the body reads
    // `column.getSize()` per visible cell, which is a window, not the book.
    columnResizeMode: 'onChange',
    state: {
      ...base,
      columnPinning: { start: [SELECT_ID, ...base.columnPinning.start], end: base.columnPinning.end },
    },
    ...handlers,
  });
}
