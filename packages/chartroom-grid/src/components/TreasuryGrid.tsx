/**
 * The grid — Phase 0: a plain table, every cell formatted from its meta.
 *
 * Rendered with shadcn's Table primitives (ADR-65): the markup stays
 * semantic (`<table>`, `<th scope>`) because the table is the reader's
 * instrument and a screen reader is a reader too. Deliberately not
 * virtualized yet — Phase 1 replaces the `<tbody>` with a windowed body over
 * 50,000 rows and keeps this header.
 */

import type { Position } from '../data/mock';
import { alignOf } from '../grid/meta';
import { useTreasuryTable } from '../grid/useTreasuryTable';
import { ValueCell } from './CellRenderers';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './ui/table';

export interface TreasuryGridProps {
  rows: Position[] | null;
}

export function TreasuryGrid({ rows }: TreasuryGridProps) {
  const table = useTreasuryTable(rows);
  const model = table.getRowModel();

  if (!rows) return <div className="h-full animate-pulse rounded-sm bg-muted" data-slot="skeleton" />;
  if (!model.rows.length) return <div className="py-2 text-xs text-faint">no positions match</div>;

  return (
    <Table
      containerClassName="h-full min-h-0 overflow-auto"
      className="w-max min-w-full border-separate border-spacing-0 text-[11.5px] text-foreground"
      data-testid="treasury-grid"
    >
      <TableHeader>
        {table.getHeaderGroups().map((group) => (
          <TableRow key={group.id} className="hover:bg-transparent">
            {group.headers.map((header) => {
              const meta = header.column.columnDef.meta;
              return (
                <TableHead
                  key={header.id}
                  scope="col"
                  data-align={meta ? alignOf(meta) : 'left'}
                  data-column={header.column.id}
                  className="sticky top-0 z-10 h-auto border-b bg-card px-2.5 py-1.5 text-[10px] font-semibold tracking-[0.06em] text-faint uppercase data-[align=right]:text-right"
                >
                  {header.isPlaceholder ? null : <table.FlexRender header={header} />}
                </TableHead>
              );
            })}
          </TableRow>
        ))}
      </TableHeader>
      <TableBody>
        {model.rows.map((row) => (
          <TableRow key={row.id} data-row={row.id} className="border-0">
            {row.getAllCells().map((cell) => {
              const meta = cell.column.columnDef.meta;
              return (
                <TableCell
                  key={cell.id}
                  data-align={meta ? alignOf(meta) : 'left'}
                  data-column={cell.column.id}
                  className="border-b border-border-subtle px-2.5 py-[3px] data-[align=right]:text-right"
                >
                  {meta
                    ? <ValueCell value={cell.getValue()} meta={meta} />
                    : <table.FlexRender cell={cell} />}
                </TableCell>
              );
            })}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
