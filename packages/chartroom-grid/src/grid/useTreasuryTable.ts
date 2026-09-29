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
import { columns } from './columns';
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

export function useTreasuryTable({ data, view, onViewChange }: TreasuryTableOptions): TreasuryTable {
  const handlers = useMemo(() => {
    const slice =
      <K extends ViewSlice>(key: K): OnChangeFn<ViewState[K]> =>
      (updater: Updater<ViewState[K]>) =>
        onViewChange((prev) => ({ ...prev, [key]: functionalUpdate(updater, prev[key]) }));
    return {
      onGroupingChange: slice('grouping'),
      onColumnFiltersChange: slice('columnFilters'),
      onGlobalFilterChange: slice('globalFilter'),
      onSortingChange: slice('sorting'),
      onExpandedChange: slice('expanded'),
      onColumnVisibilityChange: slice('columnVisibility'),
      onColumnOrderChange: slice('columnOrder'),
      onColumnPinningChange: slice('columnPinning'),
      onColumnSizingChange: slice('columnSizing'),
    };
  }, [onViewChange]);

  return useTable({
    features,
    columns,
    data: data ?? NO_ROWS,
    getRowId: (row) => row.tradeId,
    state: toTableState(view),
    ...handlers,
  });
}
