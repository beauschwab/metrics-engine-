/**
 * The grid — Phase 1: the book behind the data seam, a windowed body.
 *
 * The component owns nothing the contract does not: rows come from the
 * source, the view is the state, and the table is the hook's. Rendering is
 * shadcn's Table primitives (ADR-65) in the grid/flex geometry the
 * virtualizer needs — a `<tbody>` the height of fifty thousand rows, with
 * only the rows in the viewport in the DOM. Row height is fixed and never
 * measured: a treasury grid is a lattice, not a feed, and a measured row is
 * a scrollbar that jumps.
 *
 * The markup stays semantic (`<table>`, `<th scope>`) because the table is
 * the reader's instrument and a screen reader is a reader too.
 */

import { useEffect, useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import type { Position } from '../data/mock';
import type { DataSource } from '../data/source';
import { alignOf } from '../grid/meta';
import { useTreasuryTable, type ViewUpdate } from '../grid/useTreasuryTable';
import { defaultView, type ViewState } from '../grid/viewState';
import { ValueCell } from './CellRenderers';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './ui/table';

export const ROW_HEIGHT = 22;

export interface TreasuryGridProps {
  source: DataSource<Position>;
  /** Control the view from outside (a saved view, the URL, an agent); omit and the grid keeps its own. */
  view?: ViewState;
  onViewChange?: (update: ViewUpdate) => void;
}

export function TreasuryGrid({ source, view: controlled, onViewChange }: TreasuryGridProps) {
  const [ownView, setOwnView] = useState<ViewState>(defaultView);
  const view = controlled ?? ownView;
  const change = onViewChange ?? setOwnView;

  // The rows are asked for once per source. The in-memory source serves no
  // stage of the view, so a sort or a filter is the client's and needs no
  // second answer; when a source reports it serves one, the query must key
  // on that slice of the view too — TODO(grid-phase-5).
  const [rows, setRows] = useState<Position[] | null>(null);
  useEffect(() => {
    let live = true;
    setRows(null);
    void source.query(view).then((r) => { if (live) setRows(r.rows); });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- see the note above
  }, [source]);

  const table = useTreasuryTable({ data: rows, view, onViewChange: change });
  const model = table.getRowModel().rows;

  const scrollRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: model.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 12,
    getItemKey: (i) => model[i]!.id,
  });

  if (!rows) return <div className="h-full animate-pulse rounded-sm bg-muted" data-slot="skeleton" />;
  if (!model.length) return <div className="py-2 text-xs text-faint">no positions match</div>;

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
            {group.headers.map((header) => {
              const meta = header.column.columnDef.meta;
              return (
                <TableHead
                  key={header.id}
                  scope="col"
                  data-align={meta ? alignOf(meta) : 'left'}
                  data-column={header.column.id}
                  style={{ width: header.getSize() }}
                  className="flex h-auto items-center border-b px-2.5 py-1.5 text-[10px] font-semibold tracking-[0.06em] text-faint uppercase data-[align=right]:justify-end"
                >
                  {header.isPlaceholder ? null : <table.FlexRender header={header} />}
                </TableHead>
              );
            })}
          </TableRow>
        ))}
      </TableHeader>
      <TableBody className="relative grid" style={{ height: virtualizer.getTotalSize() }}>
        {virtualizer.getVirtualItems().map((item) => {
          const row = model[item.index]!;
          return (
            <TableRow
              key={row.id}
              data-row={row.id}
              data-index={item.index}
              className="absolute flex w-full border-0"
              style={{ height: ROW_HEIGHT, transform: `translateY(${item.start}px)` }}
            >
              {row.getAllCells().map((cell) => {
                const meta = cell.column.columnDef.meta;
                return (
                  <TableCell
                    key={cell.id}
                    data-align={meta ? alignOf(meta) : 'left'}
                    data-column={cell.column.id}
                    style={{ width: cell.column.getSize() }}
                    className="flex items-center border-b border-border-subtle px-2.5 py-0 data-[align=right]:justify-end"
                  >
                    {meta
                      ? <ValueCell value={cell.getValue()} meta={meta} />
                      : <table.FlexRender cell={cell} />}
                  </TableCell>
                );
              })}
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
