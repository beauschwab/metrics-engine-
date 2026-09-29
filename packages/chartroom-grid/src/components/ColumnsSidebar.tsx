/**
 * The columns tool panel — the AG Grid sidebar's first tab, in the studio's
 * shape: every column in display order, a checkbox for visibility, a drag
 * handle for reordering, and for a groupable dimension a button that groups
 * by it (the drop zone's keyboard path). Every affordance is a reading of
 * meta: `label`, `groupable` through `getCanGroup()`.
 */

import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { GripVertical, Rows3 } from 'lucide-react';
import type { Column } from '@tanstack/react-table';
import { SELECT_ID } from '../grid/columns';
import type { Features } from '../grid/features';
import type { TreasuryTable } from '../grid/useTreasuryTable';
import type { Position } from '../data/mock';
import { cn } from '../lib/utils';
import { Button } from './ui/button';
import { Checkbox } from './ui/checkbox';

export const SIDE_PREFIX = 'side:';

type GridColumn = Column<Features, Position>;

/** Every data column, hidden ones included, in the view's order; never the selection column. */
export function orderedLeafColumns(table: TreasuryTable, columnOrder: string[]): GridColumn[] {
  const all = table.getAllLeafColumns().filter((c) => c.id !== SELECT_ID);
  const byId = new Map(all.map((c) => [c.id, c]));
  const first = columnOrder.map((id) => byId.get(id)).filter((c): c is GridColumn => !!c);
  const rest = all.filter((c) => !columnOrder.includes(c.id));
  return [...first, ...rest];
}

export function ColumnsSidebar({
  table,
  grouping,
  columnOrder,
}: {
  table: TreasuryTable;
  grouping: string[];
  columnOrder: string[];
}) {
  const ordered = orderedLeafColumns(table, columnOrder);
  return (
    <aside data-slot="columns-sidebar" data-testid="columns-sidebar" className="flex w-60 shrink-0 flex-col border-l border-border bg-card text-xs">
      <div className="px-3 py-2 text-[10px] font-semibold tracking-[0.06em] uppercase text-faint">Columns</div>
      <SortableContext items={ordered.map((c) => SIDE_PREFIX + c.id)} strategy={verticalListSortingStrategy}>
        <ul className="min-h-0 flex-1 overflow-auto px-1 pb-2">
          {ordered.map((col) => (
            <SidebarItem key={col.id} column={col} grouped={grouping.includes(col.id)} />
          ))}
        </ul>
      </SortableContext>
    </aside>
  );
}

function SidebarItem({ column, grouped }: { column: GridColumn; grouped: boolean }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: SIDE_PREFIX + column.id });
  const label = column.columnDef.meta?.label ?? column.id;
  return (
    <li
      ref={setNodeRef}
      data-slot="sidebar-column"
      data-column={column.id}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn('flex h-7 items-center gap-1.5 rounded-sm px-1.5 hover:bg-muted/50', isDragging && 'opacity-60')}
    >
      <span {...attributes} {...listeners} className="cursor-grab text-faint touch-none" aria-label={`Drag ${label}`}>
        <GripVertical className="size-3.5" />
      </span>
      <Checkbox
        aria-label={`Show ${label}`}
        checked={column.getIsVisible()}
        onCheckedChange={(v) => column.toggleVisibility(v === true)}
      />
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {column.getCanGroup() && (
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label={grouped ? `Ungroup ${label}` : `Group by ${label}`}
          aria-pressed={grouped}
          data-grouped={grouped || undefined}
          onClick={() => column.toggleGrouping()}
          className={cn('text-faint', grouped && 'bg-muted text-primary')}
        >
          <Rows3 />
        </Button>
      )}
    </li>
  );
}
