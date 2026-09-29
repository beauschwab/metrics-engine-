/**
 * The row-groups bar: a drop target for a column header or a sidebar item,
 * and the current grouping as reorderable chips. Only a column whose meta is
 * `groupable` can land here — `column.getCanGroup()` reads that meta, and the
 * shell refuses the drop otherwise. Each chip also has a remove button, so a
 * keyboard reader can ungroup without dragging.
 */

import { useDroppable } from '@dnd-kit/core';
import { SortableContext, horizontalListSortingStrategy, useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { GripVertical, Rows3, X } from 'lucide-react';
import type { TreasuryTable } from '../grid/useTreasuryTable';
import { cn } from '../lib/utils';
import { Badge } from './ui/badge';

export const GROUP_ZONE_ID = 'group-zone';
export const GROUP_PREFIX = 'group:';

export function GroupByDropZone({ table, grouping }: { table: TreasuryTable; grouping: string[] }) {
  const { setNodeRef, isOver } = useDroppable({ id: GROUP_ZONE_ID });
  return (
    <div
      ref={setNodeRef}
      data-slot="group-zone"
      data-over={isOver || undefined}
      className={cn(
        'flex min-h-8 flex-1 flex-wrap items-center gap-1.5 rounded-sm border border-dashed border-border px-2 py-1 text-xs text-faint transition-colors',
        isOver && 'border-primary bg-muted/50 text-foreground',
      )}
    >
      <Rows3 className="size-3.5" />
      <span className="font-semibold tracking-[0.06em] uppercase text-[10px]">Row groups</span>
      <SortableContext items={grouping.map((id) => GROUP_PREFIX + id)} strategy={horizontalListSortingStrategy}>
        {grouping.map((id) => (
          <GroupChip
            key={id}
            id={id}
            label={table.getColumn(id)?.columnDef.meta?.label ?? id}
            onRemove={() => table.getColumn(id)?.toggleGrouping()}
          />
        ))}
      </SortableContext>
      {grouping.length === 0 && <span>drag a column here to group</span>}
    </div>
  );
}

function GroupChip({ id, label, onRemove }: { id: string; label: string; onRemove: () => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: GROUP_PREFIX + id });
  return (
    <Badge
      ref={setNodeRef}
      variant="secondary"
      data-slot="group-chip"
      data-column={id}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn('gap-1 pr-1 pl-1.5', isDragging && 'opacity-60')}
    >
      <span {...attributes} {...listeners} className="inline-flex cursor-grab items-center gap-1 touch-none">
        <GripVertical className="size-3 text-faint" />
        {label}
      </span>
      <button
        type="button"
        data-slot="group-chip-remove"
        aria-label={`Remove ${label} from groups`}
        onClick={onRemove}
        className="inline-flex size-4 items-center justify-center rounded-sm text-muted-foreground hover:bg-muted hover:text-foreground"
      >
        <X className="size-3" />
      </button>
    </Badge>
  );
}
