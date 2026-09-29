/**
 * The right-click menu over the body. One menu for the whole table: the
 * table records which cell the pointer was on, and the menu reads that
 * target. Every item is a feature API or the clipboard; a "filter by this
 * value" is the set filter with one value, so it shows up in the header's
 * filter and in the view like any other (ADR-66, ADR-68).
 */

import type { ReactNode } from 'react';
import { BarChart3, ChevronsDownUp, ChevronsUpDown, Copy, EyeOff, Funnel, FunnelX, PanelLeft, Pin, PinOff, Rows3, Table2 } from 'lucide-react';
import { formatValue } from '../grid/meta';
import type { TreasuryTable } from '../grid/useTreasuryTable';
import { SELECT_ID } from '../grid/columns';
import { rangesToTsv, selectedCellRanges } from '../grid/copy';
import { chartFromRange, type ChartOutcome } from '../grid/chart';
import { copyText as copy } from './clipboard';
import type { ContextTarget } from './GridTable';
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuLabel, ContextMenuSeparator, ContextMenuTrigger } from './ui/context-menu';

export function RowContextMenu({
  table, target, detailOpen, onToggleDetail, onChart, children,
}: {
  table: TreasuryTable;
  target: ContextTarget | null;
  detailOpen: ReadonlySet<string>;
  onToggleDetail: (rowId: string) => void;
  /** The host draws a chart of the selected block (ADR-81); absent, the item is too. */
  onChart?: (outcome: ChartOutcome) => void;
  children: ReactNode;
}) {
  const row = target ? table.getRowModel().rows.find((r) => r.id === target.rowId) : undefined;
  const column = target && target.columnId !== SELECT_ID ? table.getColumn(target.columnId) : undefined;
  const meta = column?.columnDef.meta;
  const grouped = !!row?.getIsGrouped();
  const value = row && column && !grouped ? row.getValue(column.id) : undefined;
  const shown = value !== undefined && meta ? formatValue(value, meta) : undefined;
  const isGrouping = table.getVisibleLeafColumns().some((c) => c.getIsGrouped());
  const selectedCells = table.getSelectedCellCount();

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent className="w-56 text-xs" data-slot="row-context-menu">
        {selectedCells > 0 && (
          <>
            <ContextMenuLabel className="text-[10px] tracking-[0.06em] uppercase text-faint">
              {selectedCells.toLocaleString('en-US')} cells selected
            </ContextMenuLabel>
            <ContextMenuItem onSelect={() => copy(rangesToTsv(selectedCellRanges(table)))}>
              <Copy /> Copy range
            </ContextMenuItem>
            <ContextMenuItem onSelect={() => copy(rangesToTsv(selectedCellRanges(table), { headers: true }))}>
              <Copy /> Copy range with headers
            </ContextMenuItem>
            {onChart && (
              <ContextMenuItem onSelect={() => onChart(chartFromRange(table))} data-slot="chart-selection">
                <BarChart3 /> Chart selection
              </ContextMenuItem>
            )}
            <ContextMenuItem onSelect={() => copy(rangesToTsv(selectedCellRanges(table), { formatted: false }))}>
              <Copy /> Copy range as raw values
            </ContextMenuItem>
            <ContextMenuSeparator />
          </>
        )}
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
            {row.getCanPin() && (
              row.getIsPinned() === 'top' ? (
                <ContextMenuItem onSelect={() => row.pin(false)}><PinOff /> Unpin row</ContextMenuItem>
              ) : (
                <ContextMenuItem onSelect={() => row.pin('top')}><Pin /> Pin row to top</ContextMenuItem>
              )
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
        {table.getTopRows().length > 0 && (
          <ContextMenuItem onSelect={() => table.resetRowPinning(true)}><PinOff /> Unpin all rows</ContextMenuItem>
        )}

      </ContextMenuContent>
    </ContextMenu>
  );
}
