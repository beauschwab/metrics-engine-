/**
 * The one hook that owns the table.
 *
 * Features, columns and the row identity are fixed here; a screen supplies
 * data and, from Phase 1, an initial view state. Nothing else constructs a
 * table — the group-by zone, the sidebar, the export and the agent tools all
 * reach the same instance, which is the only way "view state is the contract"
 * can be true rather than aspirational.
 */

import { useTable, type ReactTable } from '@tanstack/react-table';
import { features, type Features } from './features';
import { columns } from './columns';
import type { Position } from '../data/mock';

export type TreasuryTable = ReactTable<Features, Position>;

/** The module-level empty array v9 asks for: a fresh `[]` per render would rerun every row model. */
const NO_ROWS: Position[] = [];

export function useTreasuryTable(data: Position[] | null): TreasuryTable {
  return useTable({
    features,
    columns,
    data: data ?? NO_ROWS,
    getRowId: (row) => row.tradeId,
  });
}
