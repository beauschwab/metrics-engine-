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
import { Columns3, GripVertical, ListChecks, Rows3, X } from 'lucide-react';
import { sortByOrder } from '../grid/ordinal';
import type { TreasuryTable } from '../grid/useTreasuryTable';
import { cn } from '../lib/utils';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import { Checkbox } from './ui/checkbox';
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover';

export const GROUP_ZONE_ID = 'group-zone';
export const GROUP_PREFIX = 'group:';
export const PIVOT_ZONE_ID = 'pivot-zone';

/**
 * The pivot zone (ADR-80): one dimension across the top. A groupable header
 * dropped here becomes the pivot column; the chip's cross clears it.
 */
export function PivotDropZone({
  table, pivot, onPivot, values, buckets = [], onBuckets,
}: {
  table: TreasuryTable;
  pivot: string | null;
  onPivot: (column: string | null) => void;
  /** The dimension's values from the source (ADR-80), the picker's list. */
  values?: readonly string[];
  /** The values chosen as columns (ADR-86); none chosen means every value. */
  buckets?: readonly string[];
  onBuckets?: (buckets: string[]) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: PIVOT_ZONE_ID });
  const meta = pivot ? table.getColumn(pivot)?.columnDef.meta : undefined;
  const label = pivot ? meta?.label ?? pivot : null;
  const all = sortByOrder(values ?? [], meta?.order);
  const chosen = buckets.length ? buckets : all;
  const isOn = (v: string) => buckets.length === 0 || buckets.includes(v);
  // Every value chosen is no choice at all, so the view stays clean (ADR-86).
  const write = (next: string[]) => onBuckets?.(next.length === all.length && all.every((v) => next.includes(v)) ? [] : all.filter((v) => next.includes(v)));
  const toggle = (v: string) => write(chosen.includes(v) ? chosen.filter((x) => x !== v) : [...chosen, v]);
  return (
    <div
      ref={setNodeRef}
      data-slot="pivot-zone"
      data-over={isOver || undefined}
      data-pivot={pivot ?? undefined}
      className={cn(
        'flex min-h-8 flex-wrap items-center gap-1.5 rounded-sm border border-dashed border-border px-2 py-1 text-xs text-faint transition-colors',
        isOver && 'border-primary bg-muted/50 text-foreground',
      )}
    >
      <Columns3 className="size-3.5" />
      <span className="font-semibold tracking-[0.06em] uppercase text-[10px]">Pivot</span>
      {label ? (
        <Badge variant="secondary" data-slot="pivot-chip" data-column={pivot ?? undefined} className="gap-1 pr-1 pl-1.5">
          {label}
          {onBuckets && (
            <Popover>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  data-slot="pivot-values"
                  data-chosen={buckets.length || undefined}
                  aria-label={`Choose ${label} values to pivot`}
                  title={buckets.length ? `${buckets.length} of ${all.length} values` : 'every value'}
                  className="inline-flex h-4 items-center gap-0.5 rounded-sm px-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                >
                  <ListChecks className="size-3" />
                  {buckets.length > 0 && <span className="text-[10px] tabular-nums">{buckets.length}</span>}
                </button>
              </PopoverTrigger>
              <PopoverContent align="start" className="w-56 p-2 text-xs" data-slot="pivot-values-popover">
                <div className="flex items-center justify-between text-faint">
                  <span>{buckets.length ? `${buckets.length} of ${all.length} values` : `${all.length.toLocaleString('en-US')} values`}</span>
                  <div className="flex gap-0.5">
                    <Button variant="ghost" size="xs" onClick={() => write(all)} aria-pressed={buckets.length === 0}>All</Button>
                    <Button variant="ghost" size="xs" onClick={() => onBuckets(all.length ? [all[0]!] : [])}>First only</Button>
                  </div>
                </div>
                <ul className="mt-1 max-h-56 overflow-auto" data-slot="pivot-values-list">
                  {all.map((value) => (
                    <li key={value} className="flex h-6 items-center gap-2 px-1" data-value={value}>
                      <Checkbox id={`pivot-${value}`} checked={isOn(value)} onCheckedChange={() => toggle(value)} aria-label={value} />
                      <label htmlFor={`pivot-${value}`} className="min-w-0 flex-1 truncate">{value}</label>
                    </li>
                  ))}
                </ul>
              </PopoverContent>
            </Popover>
          )}
          <button
            type="button"
            data-slot="pivot-chip-remove"
            aria-label={`Stop pivoting by ${label}`}
            onClick={() => onPivot(null)}
            className="inline-flex size-4 items-center justify-center rounded-sm text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <X className="size-3" />
          </button>
        </Badge>
      ) : (
        <span>drop a column here to pivot</span>
      )}
    </div>
  );
}

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
