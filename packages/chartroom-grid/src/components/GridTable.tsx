/**
 * The table itself: a sticky header of sortable, draggable, resizable,
 * pinnable columns; a windowed body of leaf rows, group rows and detail
 * rows; a sticky footer of grand totals. shadcn's Table primitives in the
 * grid/flex geometry the virtualizer needs (ADR-65, ADR-66).
 *
 * Every cell decides what it is from the row and the column — grouped,
 * aggregated, placeholder, or a value — and renders that, never a leaf
 * value on a group row (ADR-67). A heatmap cell mixes the accent token by
 * the value's place in its column's faceted range; a negative in a
 * `negativeRed` column takes the breach text token (ADR-68).
 *
 * Deferred, with the seam where each would plug in:
 * - range selection — TODO(grid-deferred): v9's `cellSelectionFeature` in
 *   the registry, a mouse-drag on `BodyCell`;
 * - undo/redo — TODO(grid-deferred): a history of view states in the shell;
 * - charts and the pivot UI — TODO(grid-deferred): the selection's rows
 *   handed to a widget contract, and `columnGroupingFeature`'s pivot mode.
 */

import { useEffect, useMemo, useRef, type CSSProperties, type ReactNode } from 'react';
import { useDraggable } from '@dnd-kit/core';
import { useVirtualizer } from '@tanstack/react-virtual';
import { ArrowDown, ArrowUp, ChevronDown, ChevronRight } from 'lucide-react';
import type { Cell, Column, Header } from '@tanstack/react-table';
import type { Position } from '../data/mock';
import type { Features } from '../grid/features';
import { aggregatedNumber } from '../grid/aggregations';
import { SELECT_ID } from '../grid/columns';
import { heatBackground, heatIntensity } from '../grid/heat';
import { alignOf } from '../grid/meta';
import type { TreasuryTable } from '../grid/useTreasuryTable';
import { cn } from '../lib/utils';
import { ValueCell } from './CellRenderers';
import { DetailPanel } from './DetailPanel';
import { FilterPopover } from './FilterPopover';
import { isGroupNode } from '../data/sqlSource';
import { GroupCell, INDENT_PX, ServerGroupCell, type GridRow } from './GroupCell';
import { HeaderMenu } from './HeaderMenu';
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from './ui/table';

export const ROW_HEIGHTS = { compact: 22, comfortable: 28 } as const;
export type Density = keyof typeof ROW_HEIGHTS;
export const ROW_HEIGHT = ROW_HEIGHTS.compact;
export const DETAIL_HEIGHT = 118;
export const COLUMN_PREFIX = 'col:';

export interface ContextTarget {
  rowId: string;
  columnId: string;
}

export interface GridTableProps {
  table: TreasuryTable;
  /** A served re-query is in flight: the rows shown are the previous answer's. */
  pending?: boolean;
  density: Density;
  /** Leaf rows whose detail panel is open — transient, not part of the view. */
  detailOpen: ReadonlySet<string>;
  onToggleDetail: (rowId: string) => void;
  /** The cell under a right-click, for the context menu the shell renders. */
  onContextTarget: (target: ContextTarget | null) => void;
  /** A group the source made asks the shell for its children before it expands (ADR-70). */
  onExpandGroup: (row: GridRow) => void;
}

type GridColumn = Column<Features, Position, unknown>;
type DisplayItem = { kind: 'row'; row: GridRow } | { kind: 'detail'; row: GridRow };

/** The renderer owns sticky positioning; the feature only computes offsets. */
function pinnedStyle(column: GridColumn): CSSProperties {
  const pinned = column.getIsPinned();
  if (!pinned) return {};
  return {
    position: 'sticky',
    left: pinned === 'start' ? column.getStart('start') : undefined,
    right: pinned === 'end' ? column.getAfter('end') : undefined,
    zIndex: 2,
  };
}

export function GridTable({ table, pending = false, density, detailOpen, onToggleDetail, onContextTarget, onExpandGroup }: GridTableProps) {
  const rowHeight = ROW_HEIGHTS[density];
  const model = table.getRowModel().rows;
  const items = useMemo<DisplayItem[]>(() => {
    const out: DisplayItem[] = [];
    for (const row of model) {
      out.push({ kind: 'row', row });
      if (!row.getIsGrouped() && !isGroupNode(row.original) && detailOpen.has(row.id)) out.push({ kind: 'detail', row });
    }
    return out;
  }, [model, detailOpen]);

  const scrollRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: (i) => (items[i]!.kind === 'detail' ? DETAIL_HEIGHT : rowHeight),
    overscan: 12,
    getItemKey: (i) => `${items[i]!.kind}:${items[i]!.row.id}`,
  });
  // Heights are declared, never measured; tell the virtualizer when the
  // declaration changed (a detail opened, the density switched).
  useEffect(() => { virtualizer.measure(); }, [items, rowHeight, virtualizer]);

  const heat = useMemo(() => {
    const ranges = new Map<string, [number, number] | undefined>();
    for (const c of table.getVisibleLeafColumns()) if (c.columnDef.meta?.heatmap) ranges.set(c.id, c.getFacetedMinMaxValues());
    return ranges;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- facets follow the filtered model
  }, [table, model]);

  // The positions the footer totals: when the engine grouped, the rows are
  // nodes and the positions are their counts (ADR-70).
  const coreRows = table.getCoreRowModel().rows;
  const filtered = coreRows.some((r) => isGroupNode(r.original))
    ? coreRows.reduce((n, r) => n + (isGroupNode(r.original) ? r.original.__group.count : 1), 0)
    : table.getFilteredRowModel().rows.length;
  const visible = table.getVisibleLeafColumns();
  const sortCount = visible.filter((c) => c.getIsSorted()).length;
  // The first data column carries the tree indent and the footer's label,
  // whatever order pinning and grouping put the columns in.
  const firstDataId = visible.find((c) => c.id !== SELECT_ID)?.id;

  return (
    <Table
      ref={scrollRef}
      containerClassName="h-full min-h-0 overflow-auto"
      className="grid w-max min-w-full border-separate border-spacing-0 text-[11.5px] text-foreground"
      data-testid="treasury-grid"
      data-density={density}
      data-pending={pending || undefined}
      aria-busy={pending || undefined}
      onContextMenuCapture={(e) => {
        const cell = (e.target as HTMLElement).closest('td');
        const row = cell?.closest('tr');
        onContextTarget(cell && row?.dataset.row ? { rowId: row.dataset.row, columnId: cell.dataset.column ?? '' } : null);
      }}
    >
      <TableHeader className="sticky top-0 z-10 grid bg-card">
        {table.getHeaderGroups().map((group) => (
          <TableRow key={group.id} className="flex w-full bg-card hover:bg-card">
            {group.headers.map((header) => (
              <HeaderCell key={header.id} header={header} table={table} sortCount={sortCount} />
            ))}
          </TableRow>
        ))}
      </TableHeader>
      <TableBody className={cn('relative grid transition-opacity', pending && 'opacity-50')} style={{ height: virtualizer.getTotalSize() }}>
        {virtualizer.getVirtualItems().map((item) => {
          const entry = items[item.index]!;
          const row = entry.row;
          if (entry.kind === 'detail') {
            return (
              <TableRow
                key={`detail:${row.id}`}
                data-slot="detail-row"
                data-row={row.id}
                className="absolute flex w-full border-b border-border-subtle bg-card hover:bg-card"
                style={{ height: DETAIL_HEIGHT, transform: `translateY(${item.start}px)` }}
              >
                <TableCell className="flex w-full items-start p-0" colSpan={visible.length}>
                  <DetailPanel position={row.original} />
                </TableCell>
              </TableRow>
            );
          }
          const grouped = row.getIsGrouped() || isGroupNode(row.original);
          const selected = row.getIsSelected();
          return (
            <TableRow
              key={row.id}
              data-row={row.id}
              data-index={item.index}
              data-depth={row.depth}
              data-grouped={grouped || undefined}
              data-state={selected ? 'selected' : undefined}
              className={cn(
                'absolute flex w-full border-0 transition-none',
                grouped ? 'bg-muted font-medium hover:bg-muted' : 'bg-card hover:bg-muted',
                selected && 'bg-selected hover:bg-selected',
              )}
              style={{ height: rowHeight, transform: `translateY(${item.start}px)` }}
            >
              {row.getVisibleCells().map((cell) => (
                <BodyCell
                  key={cell.id}
                  cell={cell}
                  table={table}
                  first={cell.column.id === firstDataId}
                  heat={heat}
                  detailOpen={detailOpen.has(row.id)}
                  onToggleDetail={onToggleDetail}
                  onExpandGroup={onExpandGroup}
                />
              ))}
            </TableRow>
          );
        })}
      </TableBody>
      <TableFooter className="sticky bottom-0 z-10 grid border-t bg-card font-medium">
        <TableRow className="flex w-full border-0 bg-card hover:bg-card" data-slot="grand-total">
          {visible.map((column) => {
            const meta = column.columnDef.meta;
            const align = meta ? alignOf(meta) : 'left';
            const total = meta?.kind === 'measure' && meta.agg ? aggregatedNumber(column.getAggregationValue()) : undefined;
            return (
              <TableCell
                key={column.id}
                data-column={column.id}
                data-align={align}
                style={{ width: column.getSize(), ...pinnedStyle(column) }}
                className="flex h-[26px] items-center bg-inherit px-2.5 py-0 data-[align=right]:justify-end"
              >
                {column.id === firstDataId ? (
                  <span className="whitespace-nowrap text-faint">
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

function HeaderCell({ header, table, sortCount }: { header: Header<Features, Position, unknown>; table: TreasuryTable; sortCount: number }) {
  const column = header.column;
  const meta = column.columnDef.meta;
  const isSelect = column.id === SELECT_ID;
  const canDrag = column.getCanGroup();
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: COLUMN_PREFIX + column.id, disabled: !canDrag });
  const sorted = column.getIsSorted();
  const pinned = column.getIsPinned();
  return (
    <TableHead
      scope="col"
      data-align={meta ? alignOf(meta) : 'left'}
      data-column={column.id}
      data-grouped={column.getIsGrouped() || undefined}
      data-pinned={pinned || undefined}
      data-sorted={sorted || undefined}
      aria-sort={sorted === 'asc' ? 'ascending' : sorted === 'desc' ? 'descending' : undefined}
      style={{ width: header.getSize(), ...pinnedStyle(column) }}
      className={cn(
        'group/th relative flex h-auto items-center gap-0.5 border-b bg-card px-2.5 py-1 text-[10px] font-semibold tracking-[0.06em] text-faint uppercase data-[align=right]:justify-end',
        pinned === 'start' && 'border-r border-r-border',
        pinned === 'end' && 'border-l border-l-border',
      )}
    >
      {isSelect ? (
        <SelectAll table={table} />
      ) : header.isPlaceholder ? null : (
        <>
          <span
            ref={setNodeRef}
            // A groupable column is a draggable (dnd-kit's role, tabindex and
            // description); any other sortable column is a plain button, never
            // `aria-disabled` — the sort click is live.
            {...(canDrag ? { ...attributes, ...listeners } : { role: 'button', tabIndex: 0 })}
            data-slot="column-header"
            onClick={column.getToggleSortingHandler()}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                column.getToggleSortingHandler()?.(e);
              }
            }}
            className={cn(
              'min-w-0 truncate',
              column.getCanSort() && 'cursor-pointer hover:text-foreground',
              canDrag && 'touch-none',
              isDragging && 'opacity-50',
            )}
          >
            <table.FlexRender header={header} />
          </span>
          {sorted && (
            <span data-slot="sort-indicator" className="inline-flex shrink-0 items-center text-primary">
              {sorted === 'asc' ? <ArrowUp className="size-3" /> : <ArrowDown className="size-3" />}
              {sortCount > 1 && <span className="text-[9px] tabular-nums">{column.getSortIndex() + 1}</span>}
            </span>
          )}
          {/* The controls sit in the flow, never over the label: the menu
              reserves 16px and is invisible until hover; the filter button is
              not displayed at all until hover or while its filter is active,
              so nothing unseen can catch a click meant for the label. A
              right-aligned header keeps its figures' edge and takes them on
              the left. */}
          <span
            data-slot="header-actions"
            data-keep={(column.getIsFiltered() || pinned) || undefined}
            className={cn(
              'flex shrink-0 items-center',
              meta && alignOf(meta) === 'right' ? 'order-first mr-0.5' : 'ml-auto',
            )}
          >
            {column.getCanFilter() && (
              <FilterPopover
                column={column}
                className="hidden size-4 group-hover/th:inline-flex data-[active]:inline-flex"
              />
            )}
            <HeaderMenu
              column={column}
              className="size-4 opacity-0 group-hover/th:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100"
            />
          </span>
          {column.getCanResize() && (
            <div
              data-slot="resize-handle"
              role="separator"
              aria-orientation="vertical"
              aria-label={`Resize ${meta?.label ?? column.id}`}
              onMouseDown={header.getResizeHandler()}
              onTouchStart={header.getResizeHandler()}
              onClick={(e) => e.stopPropagation()}
              className={cn(
                'absolute top-0 right-0 z-[1] h-full w-1 cursor-col-resize touch-none select-none hover:bg-primary',
                column.getIsResizing() && 'bg-primary',
              )}
            />
          )}
        </>
      )}
    </TableHead>
  );
}

function SelectAll({ table }: { table: TreasuryTable }) {
  const ref = useRef<HTMLInputElement>(null);
  const all = table.getIsAllRowsSelected();
  const some = table.getIsSomeRowsSelected();
  useEffect(() => { if (ref.current) ref.current.indeterminate = !all && some; }, [all, some]);
  return (
    <input
      ref={ref}
      type="checkbox"
      data-slot="select-all"
      aria-label="Select all rows"
      className="size-3.5 accent-primary"
      checked={all}
      onChange={table.getToggleAllRowsSelectedHandler()}
    />
  );
}

function BodyCell({
  cell, table, first, heat, detailOpen, onToggleDetail, onExpandGroup,
}: {
  cell: Cell<Features, Position, unknown>;
  table: TreasuryTable;
  first: boolean;
  heat: Map<string, [number, number] | undefined>;
  detailOpen: boolean;
  onToggleDetail: (rowId: string) => void;
  onExpandGroup: (row: GridRow) => void;
}) {
  const column = cell.column;
  const meta = column.columnDef.meta;
  const row = cell.row;
  const node = isGroupNode(row.original) ? row.original : null;
  const grouped = row.getIsGrouped() || node !== null;

  if (column.id === SELECT_ID) {
    return (
      <TableCell
        data-column={SELECT_ID}
        data-cell="select"
        style={{ width: column.getSize(), ...pinnedStyle(column) }}
        className="flex items-center gap-1 border-b border-border-subtle bg-inherit px-1.5 py-0"
      >
        {row.getCanSelect() && (
          <input
            type="checkbox"
            data-slot="select-row"
            aria-label={grouped ? `Select group ${String(row.groupingValue)}` : `Select ${row.id}`}
            className="size-3.5 accent-primary"
            checked={row.getIsSelected()}
            onChange={row.getToggleSelectedHandler()}
          />
        )}
        {!grouped && (
          <button
            type="button"
            data-slot="detail-toggle"
            aria-label={`${detailOpen ? 'Hide' : 'Show'} details for ${row.id}`}
            aria-expanded={detailOpen}
            onClick={() => onToggleDetail(row.id)}
            className="inline-flex size-4 items-center justify-center rounded-sm text-faint hover:bg-muted hover:text-foreground"
          >
            {detailOpen ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
          </button>
        )}
      </TableCell>
    );
  }

  let content: ReactNode = null;
  let kind: 'group' | 'aggregated' | 'placeholder' | 'value' = 'value';
  let background: string | undefined;
  if (cell.getIsGrouped()) {
    kind = 'group';
    content = <GroupCell row={row} />;
  } else if (node && column.id === node.__group.column) {
    kind = 'group';
    content = <ServerGroupCell row={row} node={node} onToggle={onExpandGroup} />;
  } else if (node) {
    // A group the source made: measures hold their aggregates, the other
    // dimensions are blank — the same reading as a client group (ADR-67).
    const v = cell.getValue();
    if (meta?.kind === 'measure' && meta.agg && typeof v === 'number' && Number.isFinite(v)) {
      kind = 'aggregated';
      content = <ValueCell value={v} meta={meta} />;
    } else {
      kind = 'placeholder';
    }
  } else if (cell.getIsAggregated()) {
    kind = 'aggregated';
    const n = aggregatedNumber(cell.getValue());
    content = meta && n !== undefined ? <ValueCell value={n} meta={meta} /> : null;
  } else if (cell.getIsPlaceholder() || grouped) {
    // A grouped column on a leaf row, or a dimension on a group row: nothing
    // to say here, and saying a leaf value would be a wrong number (ADR-44).
    kind = 'placeholder';
  } else {
    const value = cell.getValue();
    content = meta ? <ValueCell value={value} meta={meta} /> : <table.FlexRender cell={cell} />;
    if (meta?.heatmap) background = heatBackground(heatIntensity(value, heat.get(column.id)));
  }
  return (
    <TableCell
      data-align={meta ? alignOf(meta) : 'left'}
      data-column={column.id}
      data-cell={kind}
      data-heat={background ? '' : undefined}
      style={{
        width: column.getSize(),
        paddingLeft: first && kind === 'value' && row.depth > 0 ? 10 + row.depth * INDENT_PX : undefined,
        backgroundColor: background,
        ...pinnedStyle(column),
      }}
      className={cn(
        'flex min-w-0 items-center border-b border-border-subtle bg-inherit px-2.5 py-0 data-[align=right]:justify-end',
        kind === 'group' && 'z-[1] overflow-visible',
        column.getIsPinned() === 'start' && 'border-r border-r-border',
        column.getIsPinned() === 'end' && 'border-l border-l-border',
      )}
    >
      {content}
    </TableCell>
  );
}
