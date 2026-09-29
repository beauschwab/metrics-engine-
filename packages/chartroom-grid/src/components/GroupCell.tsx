/**
 * The grouped cell: the toggle, the group's value and how many positions
 * sit under it. Indented by depth so a three-deep grouping reads as a tree.
 */

import { ChevronDown, ChevronRight } from 'lucide-react';
import type { Row } from '@tanstack/react-table';
import type { Features } from '../grid/features';
import type { Position } from '../data/mock';

export type GridRow = Row<Features, Position>;

/** Positions under a group: leaves, never the synthetic rows between. */
export function leafCount(row: GridRow): number {
  let n = 0;
  for (const r of row.getLeafRows()) if (!r.getIsGrouped()) n++;
  return n;
}

export const INDENT_PX = 14;

export function GroupCell({ row }: { row: GridRow }) {
  const label = String(row.groupingValue ?? '—');
  const open = row.getIsExpanded();
  return (
    // Not truncated: a group's label spills over the empty placeholder cells
    // to its right, the way AG Grid's group column reads, rather than
    // shrinking to its count inside a 92px dimension column.
    <span className="flex items-center gap-1 whitespace-nowrap" style={{ paddingLeft: row.depth * INDENT_PX }}>
      <button
        type="button"
        data-slot="group-toggle"
        aria-label={`${open ? 'Collapse' : 'Expand'} ${label}`}
        aria-expanded={open}
        onClick={row.getToggleExpandedHandler()}
        className="inline-flex size-4 shrink-0 items-center justify-center rounded-sm text-muted-foreground hover:bg-muted hover:text-foreground"
      >
        {open ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
      </button>
      <span className="font-medium">{label}</span>
      <span className="text-faint tabular-nums">({leafCount(row).toLocaleString('en-US')})</span>
    </span>
  );
}
