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
import { SELECT_ID, buildColumns, selectColumn } from './columns';
import { toTableState, type ViewSlice, type ViewState } from './viewState';
import type { GridRecord, GridSchema } from './schema';
import { TREASURY_SCHEMA } from '../data/treasury';
import { isGroupNode } from '../data/sqlSource';

export type TreasuryTable = ReactTable<Features, GridRecord>;

/** A row the shell hands the table: a position, or a group node with the children it has loaded. */
export type GridRowData = GridRecord & { __children?: GridRowData[] };

/** What the source already applied — the table's `manual*` modes follow it (ADR-70). */
export interface Applied {
  filter: boolean;
  sort: boolean;
  group: boolean;
}

/** A functional update on the view, the shape React's own setter takes. */
export type ViewUpdate = (prev: ViewState) => ViewState;

export interface TreasuryTableOptions {
  /** The rows the source answered with; null while it has not. */
  data: GridRowData[] | null;
  view: ViewState;
  onViewChange: (update: ViewUpdate) => void;
  /**
   * The stages the source served. A served stage becomes a `manual*` mode:
   * the client row model passes rows through instead of doing the work
   * twice. Omit for a source that serves nothing.
   */
  applied?: Applied;
  /** The pivot dimension's distinct values (ADR-80); the shell asks the source for them. */
  pivotValues?: readonly string[];
  /** The columns the source serves (ADR-82); the treasury book by default. */
  schema?: GridSchema;
}

/** The module-level empty array v9 asks for: a fresh `[]` per render would rerun every row model. */
const NO_ROWS: GridRowData[] = [];


const withoutSelect = (ids: string[]) => ids.filter((id) => id !== SELECT_ID);

export function useTreasuryTable({ data, view, onViewChange, applied, pivotValues, schema = TREASURY_SCHEMA }: TreasuryTableOptions): TreasuryTable {
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
  // The selection column first, then every data column with the view's
  // aggregations (ADR-72) and formats (ADR-74) — one array per distinct
  // choice, not per render.
  const pivot = view.pivot.column ? { ...view.pivot, distinct: pivotValues ?? [] } : undefined;
  const columnsKey = JSON.stringify([view.columnAggs, view.columnFormats, view.computedColumns, pivot, schema.order]);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on the serialized choice
  const allColumns = useMemo(() => [selectColumn, ...buildColumns(view.columnAggs, view.columnFormats, view.computedColumns, pivot, schema)], [columnsKey, schema]);
  return useTable({
    features,
    columns: allColumns,
    data: data ?? NO_ROWS,
    getRowId: (row) => String(row[schema.rowId]),
    // Grouped columns move to the front, AG Grid's shape: the tree reads
    // left to right, and a chip's order is the column order.
    groupedColumnMode: 'reorder',
    // The view owns expansion (ADR-66); the table must not rewrite it when
    // the grouping or the data changes underneath.
    autoResetExpanded: false,
    // Resizing writes the view on every pointer move; the body reads
    // `column.getSize()` per visible cell, which is a window, not the book.
    columnResizeMode: 'onChange',
    // A stage the source served is not done again here (ADR-70). Grouping
    // served remotely arrives as group nodes whose children load on expand:
    // the sub-rows are what the shell attached, and a node can expand
    // before its children have arrived.
    // The quick filter reads as tokens (ADR-73); the same grammar the SQL compiles.
    globalFilterFn: 'search',
    manualFiltering: applied?.filter ?? false,
    manualSorting: applied?.sort ?? false,
    manualGrouping: applied?.group ?? false,
    // A block of cells can be selected anywhere but the selection column.
    enableCellSelection: (cell) => cell.column.id !== SELECT_ID,
    // A pinned row is one of the rows on screen: filter it out or collapse
    // its group and it leaves the top too, rather than showing a row the
    // view says is not there (ADR-77).
    keepPinnedRows: false,
    enableRowPinning: (row) => !row.getIsGrouped() && !isGroupNode(row.original),
    getSubRows: (row) => (row as GridRowData).__children,
    // A client-made group expands when it has sub-rows (the default rule);
    // an engine-made node expands before its children have been fetched.
    getRowCanExpand: (row) => isGroupNode(row.original) || row.subRows.length > 0,
    state: {
      ...base,
      columnPinning: { start: [SELECT_ID, ...base.columnPinning.start], end: base.columnPinning.end },
    },
    ...handlers,
  });
}
