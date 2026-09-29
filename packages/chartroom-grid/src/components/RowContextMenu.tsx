/**
 * The right-click menu over the body. One menu for the whole table: the
 * table records which cell the pointer was on, and the menu reads that
 * target. Every item is a feature API or the clipboard; a "filter by this
 * value" is the set filter with one value, so it shows up in the header's
 * filter and in the view like any other (ADR-66, ADR-68).
 */

import type { ReactNode } from 'react';
import { ChevronsDownUp, ChevronsUpDown, Copy, EyeOff, Funnel, FunnelX, PanelLeft, PinOff, Rows3, Table2 } from 'lucide-react';
import { formatValue } from '../grid/meta';
import type { TreasuryTable } from '../grid/useTreasuryTable';
import { SELECT_ID } from '../grid/columns';
import type { ContextTarget } from './GridTable';
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuLabel, ContextMenuSeparator, ContextMenuTrigger } from './ui/context-menu';

function copy(text: string) {
  try {
    void navigator.clipboard?.writeText(text);
  } catch {
    // The clipboard is a courtesy, not a contract.
  }
}

export function RowContextMenu({
  table, target, detailOpen, onToggleDetail, children,
}: {
  table: TreasuryTable;
  target: ContextTarget | null;
  detailOpen: ReadonlySet<string>;
  onToggleDetail: (rowId: string) => void;
  children: ReactNode;
}) {
  const row = target ? table.getRowModel().rows.find((r) => r.id === target.rowId) : undefined;
  const column = target && target.columnId !== SELECT_ID ? table.getColumn(target.columnId) : undefined;
  const meta = column?.columnDef.meta;
  const grouped = !!row?.getIsGrouped();
  const value = row && column && !grouped ? row.getValue(column.id) : undefined;
  const shown = value !== undefined && meta ? formatValue(value, meta) : undefined;
  const isGrouping = table.getVisibleLeafColumns().some((c) => c.getIsGrouped());

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent className="w-56 text-xs" data-slot="row-context-menu">
        {row && column && meta ? (
          <>
            <ContextMenuLabel className="text-[10px] tracking-[0.06em] uppercase text-faint">
              {grouped ? String(row.groupingValue) : row.id} · {meta.label}
            </ContextMenuLabel>
            {shown !== undefined && (
              <ContextMenuItem onSelect={() => copy(shown)}>
                <Copy /> Copy “{shown}”
              </ContextMenuItem>
            )}
            <ContextMenuItem
              onSelect={() =>
                copy(
                  row.getVisibleCells()
                    .filter((c) => c.column.id !== SELECT_ID && c.column.columnDef.meta)
                    .map((c) => (c.getIsPlaceholder() ? '' : formatValue(c.getIsGrouped() ? row.groupingValue : c.getValue(), c.column.columnDef.meta!)))
                    .join('\t'),
                )
              }
            >
              <Copy /> Copy row
            </ContextMenuItem>
            <ContextMenuSeparator />
            {meta.kind === 'dimension' && value !== undefined && (
              <ContextMenuItem onSelect={() => column.setFilterValue([String(value)])}>
                <Funnel /> Filter {meta.label} to “{shown}”
              </ContextMenuItem>
            )}
            {column.getCanGroup() && (
              <ContextMenuItem onSelect={() => column.toggleGrouping()}>
                <Rows3 /> {column.getIsGrouped() ? `Ungroup ${meta.label}` : `Group by ${meta.label}`}
              </ContextMenuItem>
            )}
            {column.getCanPin() &&
              (column.getIsPinned() ? (
                <ContextMenuItem onSelect={() => column.pin(false)}><PinOff /> Unpin {meta.label}</ContextMenuItem>
              ) : (
                <ContextMenuItem onSelect={() => column.pin('start')}><PanelLeft /> Pin {meta.label} to start</ContextMenuItem>
              ))}
            {column.getCanHide() && (
              <ContextMenuItem onSelect={() => column.toggleVisibility(false)}><EyeOff /> Hide {meta.label}</ContextMenuItem>
            )}
            <ContextMenuSeparator />
            {!grouped && (
              <ContextMenuItem onSelect={() => onToggleDetail(row.id)}>
                <Table2 /> {detailOpen.has(row.id) ? 'Hide details' : 'Show details'}
              </ContextMenuItem>
            )}
          </>
        ) : (
          <ContextMenuLabel className="text-[10px] tracking-[0.06em] uppercase text-faint">Table</ContextMenuLabel>
        )}
        {isGrouping && (
          <>
            <ContextMenuItem onSelect={() => table.toggleAllRowsExpanded(true)}><ChevronsUpDown /> Expand all</ContextMenuItem>
            <ContextMenuItem onSelect={() => table.toggleAllRowsExpanded(false)}><ChevronsDownUp /> Collapse all</ContextMenuItem>
          </>
        )}
        <ContextMenuItem onSelect={() => { table.resetColumnFilters(true); table.setGlobalFilter(''); }}>
          <FunnelX /> Clear all filters
        </ContextMenuItem>
        {/* TODO(grid-deferred): "Chart selection" hands the selected leaf rows to a widget contract; range selection copies a block. */}
      </ContextMenuContent>
    </ContextMenu>
  );
}
