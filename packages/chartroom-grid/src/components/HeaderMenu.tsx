/**
 * The column header menu: sort, pin, group, hide — each item a feature API
 * writing the view (ADR-66). What appears is a reading of the column:
 * `getCanSort`, `getCanPin`, `getCanGroup`, `getCanHide`, all of which the
 * column def set from meta or, for the selection column, switched off.
 */

import { ArrowDown, ArrowUp, ArrowDownUp, EllipsisVertical, EyeOff, PanelLeft, PanelRight, PinOff, Rows3 } from 'lucide-react';
import type { Column } from '@tanstack/react-table';
import type { Position } from '../data/mock';
import type { Features } from '../grid/features';
import { cn } from '../lib/utils';
import { Button } from './ui/button';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from './ui/dropdown-menu';

export type GridColumn = Column<Features, Position, unknown>;

export function HeaderMenu({ column, className }: { column: GridColumn; className?: string }) {
  const label = column.columnDef.meta?.label ?? column.id;
  const sorted = column.getIsSorted();
  const pinned = column.getIsPinned();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-xs" aria-label={`${label} column menu`} className={cn('text-faint', className)}>
          <EllipsisVertical />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48 text-xs" data-slot="header-menu" data-column={column.id}>
        <DropdownMenuLabel className="text-[10px] tracking-[0.06em] uppercase text-faint">{label}</DropdownMenuLabel>
        {column.getCanSort() && (
          <>
            <DropdownMenuItem onSelect={() => column.toggleSorting(false)} data-active={sorted === 'asc' || undefined}>
              <ArrowUp /> Sort ascending
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => column.toggleSorting(true)} data-active={sorted === 'desc' || undefined}>
              <ArrowDown /> Sort descending
            </DropdownMenuItem>
            {sorted && (
              <DropdownMenuItem onSelect={() => column.clearSorting()}>
                <ArrowDownUp /> Clear sort
              </DropdownMenuItem>
            )}
            <DropdownMenuSeparator />
          </>
        )}
        {column.getCanPin() && (
          <>
            {pinned !== 'start' && (
              <DropdownMenuItem onSelect={() => column.pin('start')}>
                <PanelLeft /> Pin to start
              </DropdownMenuItem>
            )}
            {pinned !== 'end' && (
              <DropdownMenuItem onSelect={() => column.pin('end')}>
                <PanelRight /> Pin to end
              </DropdownMenuItem>
            )}
            {pinned && (
              <DropdownMenuItem onSelect={() => column.pin(false)}>
                <PinOff /> Unpin
              </DropdownMenuItem>
            )}
            <DropdownMenuSeparator />
          </>
        )}
        {column.getCanGroup() && (
          <DropdownMenuItem onSelect={() => column.toggleGrouping()}>
            <Rows3 /> {column.getIsGrouped() ? 'Ungroup' : `Group by ${label}`}
          </DropdownMenuItem>
        )}
        {column.getCanHide() && (
          <DropdownMenuItem onSelect={() => column.toggleVisibility(false)}>
            <EyeOff /> Hide column
          </DropdownMenuItem>
        )}
        {column.getCanResize() && (
          <DropdownMenuItem onSelect={() => column.resetSize()}>Reset width</DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
