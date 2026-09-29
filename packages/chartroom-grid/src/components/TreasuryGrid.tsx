/**
 * The grid — Phase 0: a plain table, every cell formatted from its meta.
 *
 * Deliberately not virtualized yet. Phase 1 replaces the `<tbody>` with a
 * windowed body over 50,000 rows and keeps this header; the markup stays
 * semantic (`<table>`, `<th scope>`) because the table is the reader's
 * instrument and a screen reader is a reader too.
 */

import type { Position } from '../data/mock';
import { alignOf } from '../grid/meta';
import { useTreasuryTable } from '../grid/useTreasuryTable';
import { ValueCell } from './CellRenderers';

export interface TreasuryGridProps {
  rows: Position[] | null;
}

export function TreasuryGrid({ rows }: TreasuryGridProps) {
  const table = useTreasuryTable(rows);
  const model = table.getRowModel();

  if (!rows) return <div className="cr-skeleton cr-skeleton-table" />;
  if (!model.rows.length) return <div className="cr-widget-empty">no positions match</div>;

  return (
    <div className="cr-grid" data-testid="treasury-grid">
      <table className="cr-grid-table">
        <thead>
          {table.getHeaderGroups().map((group) => (
            <tr key={group.id}>
              {group.headers.map((header) => {
                const meta = header.column.columnDef.meta;
                return (
                  <th
                    key={header.id}
                    scope="col"
                    data-align={meta ? alignOf(meta) : 'left'}
                    data-column={header.column.id}
                  >
                    {header.isPlaceholder ? null : <table.FlexRender header={header} />}
                  </th>
                );
              })}
            </tr>
          ))}
        </thead>
        <tbody>
          {model.rows.map((row) => (
            <tr key={row.id} data-row={row.id}>
              {row.getAllCells().map((cell) => {
                const meta = cell.column.columnDef.meta;
                return (
                  <td key={cell.id} data-align={meta ? alignOf(meta) : 'left'} data-column={cell.column.id}>
                    {meta
                      ? <ValueCell value={cell.getValue()} meta={meta} />
                      : <table.FlexRender cell={cell} />}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
