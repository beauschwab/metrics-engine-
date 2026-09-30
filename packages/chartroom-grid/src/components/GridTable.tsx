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
import type { GridRecord } from '../grid/schema';
import type { Features } from '../grid/features';
import { aggregatedNumber } from '../grid/aggregations';
import { SELECT_ID } from '../grid/columns';
import { rangesToTsv, selectedCellRanges } from '../grid/copy';
import { copyText } from './clipboard';
import { heatBackground, heatIntensity } from '../grid/heat';
import { aggregateMeta, alignOf, type Agg, type ColumnFormat } from '../grid/meta';
import { hasBands, headerBands } from '../grid/bands';
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
  /** A measure's aggregation chosen for the view (ADR-72). */
  onAggChange?: (columnId: string, agg: Agg | null) => void;
  /** How a measure reads for the view (ADR-74). */
  onFormatChange?: (columnId: string, patch: ColumnFormat | null) => void;
  /** Drop a calculated column from the view (ADR-79). */
  onRemoveComputed?: (columnId: string) => void;
  /** Pivot by a dimension, or stop (ADR-80). */
  onPivot?: (columnId: string | null) => void;
  /**
   * The rows are one window of a larger answer (ADR-85): `offset` rows
   * precede them and `total` rows exist; the body draws placeholders for the
   * rest and reports the range on screen so the shell can fetch it.
   */
  window?: { offset: number; total: number };
  onRange?: (first: number, last: number) => void;
  /** The grand totals the source answered (ADR-85); with them the footer never sums a window. */
  totals?: Record<string, number>;
  /** The rows the view matches, when the source counted them. */
  servedTotal?: number;
  /** Changes when the served slices did: the body scrolls back to the top. */
  resetKey?: string;
}

type GridColumn = Column<Features, GridRecord, unknown>;
type DisplayItem = { kind: 'row'; row: GridRow } | { kind: 'detail'; row: GridRow };

/**
 * The band row (ADR-75): one cell per contiguous run of visible columns
 * that share a `meta.band`, sized to their summed widths and pinned the way
 * they are, so the row reads as a family line above the headers and never
 * disagrees with them on where a column sits.
 */
function BandRow({ columns }: { columns: GridColumn[] }) {
  const described = columns.map((c) => ({ id: c.id, band: c.columnDef.meta?.band, size: c.getSize(), pinned: c.getIsPinned() }));
  if (!hasBands(described)) return null;
  const byId = new Map(columns.map((c) => [c.id, c]));
  return (
    <TableRow className="flex w-full border-0 bg-card hover:bg-card" data-slot="header-bands">
      {headerBands(described).map((band) => {
        const first = byId.get(band.columns[0]!)!;
        const last = byId.get(band.columns[band.columns.length - 1]!)!;
        const anchor = band.pinned === 'end' ? last : first;
        return (
          <TableHead
            key={band.columns.join('|')}
            scope="colgroup"
            data-slot="header-band"
            data-band={band.band ?? undefined}
            data-columns={band.columns.join(' ')}
            aria-colspan={band.columns.length}
            style={{ width: band.size, ...pinnedStyle(anchor) }}
            className={cn(
              'flex h-5 items-center overflow-hidden border-b border-border-subtle bg-card px-2.5 text-[9px] font-semibold tracking-[0.08em] text-faint/80 uppercase whitespace-nowrap',
              band.band && band.columns.length > 0 && 'border-l border-l-border-subtle first:border-l-0',
            )}
          >
            {band.band}
          </TableHead>
        );
      })}
    </TableRow>
  );
}

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

export function GridTable({
  table, pending = false, density, detailOpen, onToggleDetail, onContextTarget, onExpandGroup, onAggChange, onFormatChange, onRemoveComputed, onPivot,
  window: served, onRange, totals, servedTotal, resetKey,
}: GridTableProps) {
  const rowHeight = ROW_HEIGHTS[density];
  // The rows the body scrolls are the centre rows: a pinned row leaves the
  // body for the sticky block under the header (ADR-77).
  const model = table.getCenterRows();
  const pinnedRows = table.getTopRows();
  const items = useMemo<DisplayItem[]>(() => {
    const out: DisplayItem[] = [];
    for (const row of model) {
      out.push({ kind: 'row', row });
      if (!row.getIsGrouped() && !isGroupNode(row.original) && detailOpen.has(row.id)) out.push({ kind: 'detail', row });
    }
    return out;
  }, [model, detailOpen]);

  // A window (ADR-85): the rows before it and after it are placeholders of
  // the same height, so the scrollbar spans the whole answer and a row keeps
  // its place while the window it sits in is fetched.
  const before = served ? served.offset : 0;
  const after = served ? Math.max(0, served.total - served.offset - table.getCoreRowModel().rows.length) : 0;
  const count = before + items.length + after;
  const itemAt = (i: number): DisplayItem | null => (i < before || i >= before + items.length ? null : items[i - before]!);
  const scrollRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count,
    getScrollElement: () => scrollRef.current,
    estimateSize: (i) => (itemAt(i)?.kind === 'detail' ? DETAIL_HEIGHT : rowHeight),
    overscan: 12,
    getItemKey: (i) => { const it = itemAt(i); return it ? `${it.kind}:${it.row.id}` : `ph:${i}`; },
  });
  // Heights are declared, never measured; tell the virtualizer when the
  // declaration changed (a detail opened, the density switched).
  useEffect(() => { virtualizer.measure(); }, [items, rowHeight, virtualizer, before, after]);
  // The range on screen, reported when it moves; the shell decides whether it needs a new window.
  const virtualItems = virtualizer.getVirtualItems();
  const firstIndex = virtualItems[0]?.index ?? 0;
  const lastIndex = virtualItems[virtualItems.length - 1]?.index ?? 0;
  useEffect(() => { onRange?.(firstIndex, lastIndex); }, [firstIndex, lastIndex, onRange]);
  // A served slice changed: the answer starts over, and so does the scroll.
  useEffect(() => { if (resetKey !== undefined) virtualizer.scrollToOffset(0); }, [resetKey, virtualizer]);

  const heat = useMemo(() => {
    const ranges = new Map<string, [number, number] | undefined>();
    for (const c of table.getVisibleLeafColumns()) if (c.columnDef.meta?.heatmap) ranges.set(c.id, c.getFacetedMinMaxValues());
    return ranges;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- facets follow the filtered model
  }, [table, model]);

  // The positions the footer totals: when the engine grouped, the rows are
  // nodes and the positions are their counts (ADR-70).
  const coreRows = table.getCoreRowModel().rows;
  const filtered = servedTotal ?? (coreRows.some((r) => isGroupNode(r.original))
    ? coreRows.reduce((n, r) => n + (isGroupNode(r.original) ? r.original.__group.count : 1), 0)
    : table.getFilteredRowModel().rows.length);
  const visible = table.getVisibleLeafColumns();
  const sortCount = visible.filter((c) => c.getIsSorted()).length;
  // The first data column carries the tree indent and the footer's label,
  // whatever order pinning and grouping put the columns in.
  const firstDataId = visible.find((c) => c.id !== SELECT_ID)?.id;
  const rowProps = { table, firstDataId, heat, detailOpen, onToggleDetail, onExpandGroup } as const;

  return (
    <Table
      ref={scrollRef}
      containerClassName="h-full min-h-0 overflow-auto"
      className="grid w-max min-w-full border-separate border-spacing-0 text-[11.5px] text-foreground"
      data-testid="treasury-grid"
      data-density={density}
      data-pending={pending || undefined}
      aria-busy={pending || undefined}
      tabIndex={0}
      onKeyDown={(e) => {
        // The block's keyboard (ADR-71): copy, clear, move, extend, all.
        const mod = e.ctrlKey || e.metaKey;
        if (mod && (e.key === 'c' || e.key === 'C')) {
          if (table.getSelectedCellCount() === 0) return;
          e.preventDefault();
          copyText(rangesToTsv(selectedCellRanges(table), { formatted: !e.shiftKey }));
        } else if (mod && (e.key === 'a' || e.key === 'A')) {
          e.preventDefault();
          table.selectAllCells();
        } else if (e.key === 'Escape') {
          table.resetCellSelection(true);
        } else if (e.key.startsWith('Arrow') && table.getFocusedCell()) {
          e.preventDefault();
          const dir = e.key.slice(5).toLowerCase() as 'up' | 'down' | 'left' | 'right';
          if (e.shiftKey) table.extendCellSelection(dir);
          else table.moveCellSelection(dir);
        }
      }}
      onContextMenuCapture={(e) => {
        const cell = (e.target as HTMLElement).closest('td');
        const row = cell?.closest('tr');
        onContextTarget(cell && row?.dataset.row ? { rowId: row.dataset.row, columnId: cell.dataset.column ?? '' } : null);
      }}
    >
      <TableHeader className="sticky top-0 z-10 grid bg-card">
        <BandRow columns={visible} />
        {table.getHeaderGroups().map((group) => (
          <TableRow key={group.id} className="flex w-full bg-card hover:bg-card">
            {group.headers.map((header) => (
              <HeaderCell key={header.id} header={header} table={table} sortCount={sortCount} onAggChange={onAggChange} onFormatChange={onFormatChange} onRemoveComputed={onRemoveComputed} onPivot={onPivot} />
            ))}
          </TableRow>
        ))}
        {pinnedRows.map((row, i) => (
          <BodyRow
            key={`pinned:${row.id}`}
            row={row}
            index={i}
            pinned
            className={cn('relative font-normal', i === pinnedRows.length - 1 && 'border-b-2 border-b-border shadow-[0_2px_4px_-2px_rgb(0_0_0/0.15)]')}
            style={{ height: rowHeight }}
            {...rowProps}
          />
        ))}
      </TableHeader>
      <TableBody className={cn('relative grid transition-opacity', pending && 'opacity-50')} style={{ height: Math.max(virtualizer.getTotalSize(), items.length ? 0 : ROW_HEIGHTS[density]) }}>
        {/* The header, its menus and its filters stay when nothing matches:
            a reader who filtered to nothing needs the filter to undo it. */}
        {items.length === 0 && (
          <TableRow className="absolute flex w-full border-0 hover:bg-transparent" style={{ height: ROW_HEIGHTS[density] }}>
            <TableCell className="flex items-center p-3 text-xs text-faint" data-slot="empty" colSpan={visible.length}>no positions match</TableCell>
          </TableRow>
        )}
        {virtualItems.map((item) => {
          const entry = itemAt(item.index);
          if (!entry) {
            return (
              <TableRow
                key={item.key}
                data-slot="placeholder-row"
                data-index={item.index}
                aria-hidden="true"
                className="absolute flex w-full border-0 bg-card hover:bg-card"
                style={{ height: rowHeight, transform: `translateY(${item.start}px)` }}
              >
                {visible.map((column) => (
                  <TableCell
                    key={column.id}
                    data-column={column.id}
                    style={{ width: column.getSize(), ...pinnedStyle(column) }}
                    className="flex items-center border-b border-border-subtle bg-inherit px-2.5 py-0"
                  >
                    {column.id !== SELECT_ID && <span className="h-2 w-2/3 animate-pulse rounded-sm bg-muted" />}
                  </TableCell>
                ))}
              </TableRow>
            );
          }
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
          return (
            <BodyRow
              key={row.id}
              row={row}
              index={item.index}
              className="absolute"
              style={{ height: rowHeight, transform: `translateY(${item.start}px)` }}
              {...rowProps}
            />
          );
        })}
      </TableBody>
      <TableFooter className="sticky bottom-0 z-10 grid border-t bg-card font-medium">
        <TableRow className="flex w-full border-0 bg-card hover:bg-card" data-slot="grand-total">
          {visible.map((column) => {
            const meta = column.columnDef.meta;
            const align = meta ? alignOf(meta) : 'left';
            // With the source's grand totals (ADR-85) the footer never sums a window; without them it aggregates the rows it has.
            const total = totals
              ? (meta?.kind === 'measure' && column.columnDef.aggregationFn && totals[column.id] !== undefined ? totals[column.id] : undefined)
              : meta?.kind === 'measure' && column.columnDef.aggregationFn ? aggregatedNumber(column.getAggregationValue()) : undefined;
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
                  <ValueCell value={total} meta={aggregateMeta(meta, column.columnDef.aggregationFn)} />
                ) : null}
              </TableCell>
            );
          })}
        </TableRow>
      </TableFooter>
    </Table>
  );
}

/** One body row: in the virtualized body, or held at the top (ADR-77). */
function BodyRow({
  row, index, pinned = false, className, style, table, firstDataId, heat, detailOpen, onToggleDetail, onExpandGroup,
}: {
  row: GridRow;
  index: number;
  pinned?: boolean;
  className?: string;
  style?: CSSProperties;
  table: TreasuryTable;
  firstDataId: string | undefined;
  heat: Map<string, [number, number] | undefined>;
  detailOpen: ReadonlySet<string>;
  onToggleDetail: (rowId: string) => void;
  onExpandGroup: (row: GridRow) => void;
}) {
  const grouped = row.getIsGrouped() || isGroupNode(row.original);
  const selected = row.getIsSelected();
  return (
    <TableRow
      data-row={row.id}
      data-index={index}
      data-depth={row.depth}
      data-grouped={grouped || undefined}
      data-pinned={pinned ? 'top' : undefined}
      data-slot={pinned ? 'pinned-row' : undefined}
      data-state={selected ? 'selected' : undefined}
      className={cn(
        'flex w-full border-0 transition-none',
        grouped ? 'bg-muted font-medium hover:bg-muted' : 'bg-card hover:bg-muted',
        selected && 'bg-selected hover:bg-selected',
        className,
      )}
      style={style}
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
}

function HeaderCell({
  header, table, sortCount, onAggChange, onFormatChange, onRemoveComputed, onPivot,
}: {
  header: Header<Features, GridRecord, unknown>;
  table: TreasuryTable;
  sortCount: number;
  onAggChange?: (columnId: string, agg: Agg | null) => void;
  onFormatChange?: (columnId: string, patch: ColumnFormat | null) => void;
  onRemoveComputed?: (columnId: string) => void;
  onPivot?: (columnId: string | null) => void;
}) {
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
      data-computed={meta?.computed || undefined}
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
          {meta?.computed && (
            <span data-slot="calc-badge" title="A calculated column: a draft the view defines, not a governed metric" className="shrink-0 rounded-sm border border-border px-1 text-[8px] leading-3 text-faint">
              calc
            </span>
          )}
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
                // Opacity, not display: a trigger that leaves the layout when the
                // pointer moves into the popover leaves the popover anchored to
                // nothing, and it snaps to the viewport's corner.
                className="size-4 opacity-0 group-hover/th:opacity-100 focus-visible:opacity-100 data-[active]:opacity-100 data-[state=open]:opacity-100"
              />
            )}
            <HeaderMenu
              column={column}
              onAggChange={onAggChange}
              onFormatChange={onFormatChange}
              onRemoveComputed={onRemoveComputed}
              onPivot={onPivot}
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
  cell: Cell<Features, GridRecord, unknown>;
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

  // The block: one outline around a union of rectangles, from the edges the
  // feature computes; the fill is the accent, faint (ADR-71).
  const selected = cell.getIsSelected();
  const edges = selected ? cell.getSelectionEdges() : null;
  const outline = edges
    ? [edges.top && 'inset 0 1px 0 var(--cr-accent)', edges.bottom && 'inset 0 -1px 0 var(--cr-accent)', edges.left && 'inset 1px 0 0 var(--cr-accent)', edges.right && 'inset -1px 0 0 var(--cr-accent)']
        .filter(Boolean)
        .join(', ') || undefined
    : undefined;

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
    if (meta?.kind === 'measure' && column.columnDef.aggregationFn && typeof v === 'number' && Number.isFinite(v)) {
      kind = 'aggregated';
      content = <ValueCell value={v} meta={aggregateMeta(meta, column.columnDef.aggregationFn)} />;
    } else {
      kind = 'placeholder';
    }
  } else if (cell.getIsAggregated()) {
    kind = 'aggregated';
    const n = aggregatedNumber(cell.getValue());
    content = meta && n !== undefined ? <ValueCell value={n} meta={aggregateMeta(meta, column.columnDef.aggregationFn)} /> : null;
  } else if (cell.getIsPlaceholder() || grouped) {
    // A grouped column on a leaf row, or a dimension on a group row: nothing
    // to say here, and saying a leaf value would be a wrong number (ADR-44).
    kind = 'placeholder';
  } else if (meta?.pivot && cell.getValue() === undefined) {
    // A leaf row outside the bucket has nothing to say in it (ADR-80).
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
      data-selected={selected || undefined}
      onMouseDown={(e) => {
        // A right-click inside the range keeps it, so the context menu can
        // copy what the user selected (Excel does the same); anywhere else,
        // any button starts a new range at this cell.
        if (e.button === 2 && selected) return;
        cell.getSelectionStartHandler()(e);
      }}
      onMouseEnter={cell.getSelectionExtendHandler()}
      style={{
        width: column.getSize(),
        paddingLeft: first && kind === 'value' && row.depth > 0 ? 10 + row.depth * INDENT_PX : undefined,
        backgroundColor: selected ? 'color-mix(in oklab, var(--cr-accent) 12%, var(--cr-panel))' : background,
        boxShadow: outline,
        ...pinnedStyle(column),
      }}
      className={cn(
        'flex min-w-0 select-none items-center border-b border-border-subtle bg-inherit px-2.5 py-0 data-[align=right]:justify-end',
        kind === 'group' && 'z-[1] overflow-visible',
        column.getIsPinned() === 'start' && 'border-r border-r-border',
        column.getIsPinned() === 'end' && 'border-l border-l-border',
      )}
    >
      {content}
    </TableCell>
  );
}
