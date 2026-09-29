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
import { features } from '../grid/features';
import { toTableState, type ViewState } from '../grid/viewState';
import type { Position } from '../data/mock';
import { isGroupNode } from '../data/sqlSource';

export const headlessFeatures = tableFeatures({ ...features, coreReactivityFeature: storeReactivityBindings() });
export type HeadlessFeatures = typeof headlessFeatures;
export type HeadlessTable = Table<HeadlessFeatures, Position>;

export function headlessTable(rows: Position[], view: ViewState): HeadlessTable {
  return constructTable<HeadlessFeatures, Position>({
    features: headlessFeatures,
    columns: buildColumns(view.columnAggs, view.columnFormats) as unknown as ColumnDef<HeadlessFeatures, Position, unknown>[],
    data: rows,
    getRowId: (r) => r.tradeId,
    globalFilterFn: 'search',
    keepPinnedRows: false,
    enableRowPinning: (row) => !row.getIsGrouped() && !isGroupNode(row.original),
    state: toTableState(view),
  });
}
