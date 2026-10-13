/**
 * The grouped cell: the toggle, the group's value and how many positions
 * sit under it. Indented by depth so a three-deep grouping reads as a tree.
 */

import { ChevronDown, ChevronRight } from 'lucide-react';
import type { Row } from '@tanstack/react-table';
import type { Features } from '../grid/features';
import type { GridRecord } from '../grid/schema';
import type { GroupNode } from '../data/sqlSource';

export type GridRow = Row<Features, GridRecord>;

/** Positions under a group: leaves, never the synthetic rows between. */
export function leafCount(row: GridRow): number {
  let n = 0;
  for (const r of row.getLeafRows()) if (!r.getIsGrouped()) n++;
  return n;
}

export const INDENT_PX = 14;

export function GroupCell({ row, fit = false }: { row: GridRow; fit?: boolean }) {
  const label = String(row.groupingValue ?? '—');
  const open = row.getIsExpanded();
  return (
    // Not truncated in a dimension column: a group's label spills over the
    // empty placeholder cells to its right, the way AG Grid's group column
    // reads, rather than shrinking to its count inside a 92px column. In the
    // tree column (ADR-93) a measure sits next door, so the label fits its own cell.
    <span className={fit ? 'flex min-w-0 items-center gap-1 whitespace-nowrap' : 'flex items-center gap-1 whitespace-nowrap'} title={fit ? label : undefined} style={{ paddingLeft: row.depth * INDENT_PX }}>
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
      <span className={fit ? 'min-w-0 truncate font-medium' : 'font-medium'}>{label}</span>
      <span className="shrink-0 text-faint tabular-nums">({leafCount(row).toLocaleString('en-US')})</span>
    </span>
  );
}

/**
 * The same cell for a group the *source* made (ADR-70): the value and the
 * count come from the node, and the toggle asks the shell to fetch the
 * children before it expands.
 */
export function ServerGroupCell({ row, node, onToggle, fit = false }: { row: GridRow; node: GroupNode; onToggle: (row: GridRow) => void; fit?: boolean }) {
  const open = row.getIsExpanded();
  return (
    <span className={fit ? 'flex min-w-0 items-center gap-1 whitespace-nowrap' : 'flex items-center gap-1 whitespace-nowrap'} title={fit ? node.__group.value : undefined} style={{ paddingLeft: row.depth * INDENT_PX }}>
      <button
        type="button"
        data-slot="group-toggle"
        aria-label={`${open ? 'Collapse' : 'Expand'} ${node.__group.value}`}
        aria-expanded={open}
        onClick={() => onToggle(row)}
        className="inline-flex size-4 shrink-0 items-center justify-center rounded-sm text-muted-foreground hover:bg-muted hover:text-foreground"
      >
        {open ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
      </button>
      <span className={fit ? 'min-w-0 truncate font-medium' : 'font-medium'}>{node.__group.value}</span>
      <span className="shrink-0 text-faint tabular-nums">({node.__group.count.toLocaleString('en-US')})</span>
    </span>
  );
}
