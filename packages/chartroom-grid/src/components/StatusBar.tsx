/**
 * The status bar: what the source is, how many rows the filter left, and
 * what a selection adds up to — each measure aggregated over the selected
 * leaf rows by its own meta's aggregation, so a selection's yield is a
 * weighted average and its notional a sum (ADR-67, ADR-68).
 */

import { aggregatedNumber } from '../grid/aggregations';
import { formatValue } from '../grid/meta';
import type { Applied, TreasuryTable } from '../grid/useTreasuryTable';
import type { SourceDescription } from '../data/source';
import { isGroupNode } from '../data/sqlSource';

export function StatusBar({ table, about, applied }: { table: TreasuryTable; about: SourceDescription | null; applied?: Applied }) {
  // With a source that serves a stage, the client model passes rows through:
  // the count shown is what the source answered, against its whole book.
  // When the engine grouped, the rows are nodes; the positions they stand
  // for are their counts, summed at the top level.
  const filtered = applied?.group
    ? table.getCoreRowModel().rows.reduce((n, r) => n + (isGroupNode(r.original) ? r.original.__group.count : 1), 0)
    : table.getFilteredRowModel().rows.length;
  const total = applied ? (about?.rowCount ?? filtered) : table.getCoreRowModel().rows.length;
  const served = applied ? (['filter', 'sort', 'group'] as const).filter((k) => applied[k]) : [];
  const selected = table.getSelectedRowModel().rows.filter((r) => !r.getIsGrouped());
  const measures = table.getVisibleLeafColumns().filter((c) => c.columnDef.meta?.kind === 'measure' && c.columnDef.meta.agg);
  return (
    <div data-slot="status-bar" data-testid="status-bar" className="flex h-7 items-center gap-4 border-t border-border bg-card px-3 text-[11px] text-faint">
      <span data-slot="status-source">
        {about ? <>{about.name}{about.asOf ? <> · as of {about.asOf}</> : null}</> : 'describing the source…'}
        {served.length > 0 && <span data-slot="status-served" className="ml-1 text-muted-foreground">· serves {served.join(', ')}</span>}
      </span>
      <span data-slot="status-rows">
        <span className="tabular-nums text-foreground">{filtered.toLocaleString('en-US')}</span>
        {filtered !== total && <> of <span className="tabular-nums">{total.toLocaleString('en-US')}</span></>} rows
      </span>
      <span data-slot="status-selected" className="flex items-center gap-3">
        <span>
          <span className="tabular-nums text-foreground">{selected.length.toLocaleString('en-US')}</span> selected
        </span>
        {selected.length > 0 &&
          measures.map((c) => {
            const meta = c.columnDef.meta!;
            const n = aggregatedNumber(c.getAggregationValue({ rows: selected }));
            return (
              <span key={c.id} data-measure={c.id}>
                {meta.label} <span className="tabular-nums text-foreground">{n === undefined ? '—' : formatValue(n, meta)}</span>
              </span>
            );
          })}
      </span>
    </div>
  );
}
