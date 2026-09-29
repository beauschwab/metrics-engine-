/**
 * The table itself: a sticky header of draggable columns, a windowed body
 * that renders leaf rows and group rows, and a sticky footer of grand
 * totals. shadcn's Table primitives in the grid/flex geometry the
 * virtualizer needs (ADR-65, ADR-66); every cell decides what it is from the
 * row and the column — grouped, aggregated, placeholder, or a value — and
 * renders that, never a leaf value on a group row (ADR-67).
 */

import { useRef } from 'react';
import { useDraggable } from '@dnd-kit/core';
import { useVirtualizer } from '@tanstack/react-virtual';
import type { Cell, Header } from '@tanstack/react-table';
import type { Position } from '../data/mock';
import type { Features } from '../grid/features';
import { aggregatedNumber } from '../grid/aggregations';
import { alignOf } from '../grid/meta';
import type { TreasuryTable } from '../grid/useTreasuryTable';
import { cn } from '../lib/utils';
import { ValueCell } from './CellRenderers';
import { GroupCell, INDENT_PX } from './GroupCell';
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from './ui/table';

export const ROW_HEIGHT = 22;
export const COLUMN_PREFIX = 'col:';

export function GridTable({ table }: { table: TreasuryTable }) {
  const model = table.getRowModel().rows;
  const scrollRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: model.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 12,
    getItemKey: (i) => model[i]!.id,
  });
  const filtered = table.getFilteredRowModel().rows.length;

  return (
    <Table
      ref={scrollRef}
      containerClassName="h-full min-h-0 overflow-auto"
      className="grid w-max min-w-full border-separate border-spacing-0 text-[11.5px] text-foreground"
      data-testid="treasury-grid"
    >
      <TableHeader className="sticky top-0 z-10 grid bg-card">
        {table.getHeaderGroups().map((group) => (
          <TableRow key={group.id} className="flex w-full hover:bg-transparent">
            {group.headers.map((header) => <HeaderCell key={header.id} header={header} table={table} />)}
          </TableRow>
        ))}
      </TableHeader>
      <TableBody className="relative grid" style={{ height: virtualizer.getTotalSize() }}>
        {virtualizer.getVirtualItems().map((item) => {
          const row = model[item.index]!;
          const grouped = row.getIsGrouped();
          return (
            <TableRow
              key={row.id}
              data-row={row.id}
              data-index={item.index}
              data-depth={row.depth}
              data-grouped={grouped || undefined}
              className={cn('absolute flex w-full border-0', grouped && 'bg-muted/40 font-medium')}
              style={{ height: ROW_HEIGHT, transform: `translateY(${item.start}px)` }}
            >
              {row.getAllCells().map((cell, i) => <BodyCell key={cell.id} cell={cell} table={table} first={i === 0} />)}
            </TableRow>
          );
        })}
      </TableBody>
      <TableFooter className="sticky bottom-0 z-10 grid border-t bg-card font-medium">
        <TableRow className="flex w-full border-0 hover:bg-transparent" data-slot="grand-total">
          {table.getVisibleLeafColumns().map((column, i) => {
            const meta = column.columnDef.meta;
            const align = meta ? alignOf(meta) : 'left';
            const total = meta?.kind === 'measure' && meta.agg ? aggregatedNumber(column.getAggregationValue()) : undefined;
            return (
              <TableCell
                key={column.id}
                data-column={column.id}
                data-align={align}
                style={{ width: column.getSize() }}
                className="flex h-[26px] items-center px-2.5 py-0 data-[align=right]:justify-end"
              >
                {i === 0 ? (
                  <span className="text-faint">
                    Total · <span className="tabular-nums text-foreground">{filtered.toLocaleString('en-US')}</span> rows
                  </span>
                ) : total !== undefined && meta ? (
                  <ValueCell value={total} meta={meta} />
                ) : null}
              </TableCell>
            );
          })}
        </TableRow>
      </TableFooter>
    </Table>
  );
}

function HeaderCell({ header, table }: { header: Header<Features, Position, unknown>; table: TreasuryTable }) {
  const column = header.column;
  const meta = column.columnDef.meta;
  const canDrag = column.getCanGroup();
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: COLUMN_PREFIX + column.id,
    disabled: !canDrag,
  });
  return (
    <TableHead
      scope="col"
      data-align={meta ? alignOf(meta) : 'left'}
      data-column={column.id}
      data-grouped={column.getIsGrouped() || undefined}
      style={{ width: header.getSize() }}
      className="flex h-auto items-center border-b bg-card px-2.5 py-1.5 text-[10px] font-semibold tracking-[0.06em] text-faint uppercase data-[align=right]:justify-end"
    >
      {header.isPlaceholder ? null : (
        <span
          ref={setNodeRef}
          {...attributes}
          {...listeners}
          data-slot="column-header"
          className={cn('truncate', canDrag && 'cursor-grab touch-none', isDragging && 'opacity-50')}
        >
          <table.FlexRender header={header} />
        </span>
      )}
    </TableHead>
  );
}

function BodyCell({ cell, table, first }: { cell: Cell<Features, Position, unknown>; table: TreasuryTable; first: boolean }) {
  const meta = cell.column.columnDef.meta;
  const row = cell.row;
  let content: React.ReactNode = null;
  let kind: 'group' | 'aggregated' | 'placeholder' | 'value' = 'value';
  if (cell.getIsGrouped()) {
    kind = 'group';
    content = <GroupCell row={row} />;
  } else if (cell.getIsAggregated()) {
    kind = 'aggregated';
    const n = aggregatedNumber(cell.getValue());
    content = meta && n !== undefined ? <ValueCell value={n} meta={meta} /> : null;
  } else if (cell.getIsPlaceholder() || row.getIsGrouped()) {
    // A grouped column on a leaf row, or a dimension on a group row: nothing
    // to say here, and saying a leaf value would be a wrong number (ADR-44).
    kind = 'placeholder';
  } else {
    content = meta ? <ValueCell value={cell.getValue()} meta={meta} /> : <table.FlexRender cell={cell} />;
  }
  return (
    <TableCell
      data-align={meta ? alignOf(meta) : 'left'}
      data-column={cell.column.id}
      data-cell={kind}
      style={{
        width: cell.column.getSize(),
        paddingLeft: first && kind === 'value' && row.depth > 0 ? 10 + row.depth * INDENT_PX : undefined,
      }}
      className={cn(
        'flex min-w-0 items-center border-b border-border-subtle px-2.5 py-0 data-[align=right]:justify-end',
        kind === 'group' && 'z-[1] overflow-visible',
      )}
    >
      {content}
    </TableCell>
  );
}
