/**
 * A table without a screen: the same registry, columns and view state the
 * grid renders, constructed headlessly so an agent tool, a test or a server
 * can answer a view the way the screen would (ADR-69). `constructTable`
 * needs a reactivity slot the React registry must not carry — `useTable`
 * injects React's own only when the slot is empty — so this registry is
 * the shared one plus that slot, and `ColumnDef` being invariant in its
 * registry is why the columns are cast.
 */

import { constructTable, tableFeatures, type ColumnDef, type Table } from '@tanstack/table-core';
import { storeReactivityBindings } from '@tanstack/table-core/store-reactivity-bindings';
import { buildColumns } from '../grid/columns';
import { distinctValues } from '../grid/pivot';
import { features } from '../grid/features';
import { toTableState, type ViewState } from '../grid/viewState';
import type { GridRecord, GridSchema } from '../grid/schema';
import { TREASURY_SCHEMA } from '../data/treasury';
import { isGroupNode } from '../data/sqlSource';

export const headlessFeatures = tableFeatures({ ...features, coreReactivityFeature: storeReactivityBindings() });
export type HeadlessFeatures = typeof headlessFeatures;
export type HeadlessTable = Table<HeadlessFeatures, GridRecord>;

/**
 * `manual`: the stages the source already applied (ADR-70). The rows are
 * then its answer — engine-made group nodes carrying the children fetched
 * for them under `__children` — and the table passes them through rather
 * than filtering, sorting or grouping them a second time.
 */
export function headlessTable(rows: GridRecord[], view: ViewState, schema: GridSchema = TREASURY_SCHEMA, manual?: { filter: boolean; sort: boolean; group: boolean }): HeadlessTable {
  return constructTable<HeadlessFeatures, GridRecord>({
    features: headlessFeatures,
    columns: buildColumns(view.columnAggs, view.columnFormats, view.computedColumns, view.pivot.column ? { ...view.pivot, distinct: distinctValues(rows, view.pivot.column) } : undefined, schema) as unknown as ColumnDef<HeadlessFeatures, GridRecord, unknown>[],
    data: rows,
    getRowId: (r) => String(r[schema.rowId]),
    globalFilterFn: 'search',
    keepPinnedRows: false,
    enableRowPinning: (row) => !row.getIsGrouped() && !isGroupNode(row.original),
    manualFiltering: manual?.filter ?? false,
    manualSorting: manual?.sort ?? false,
    manualGrouping: manual?.group ?? false,
    getSubRows: (row) => (row as GridRecord & { __children?: GridRecord[] }).__children,
    getRowCanExpand: (row) => isGroupNode(row.original) || row.subRows.length > 0,
    state: toTableState(view),
  });
}
