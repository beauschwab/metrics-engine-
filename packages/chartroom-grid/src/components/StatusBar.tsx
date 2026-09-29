/**
 * The status bar: what the source is, how many rows the filter left, and
 * what a selection adds up to — each measure aggregated over the selected
 * leaf rows by its own meta's aggregation, so a selection's yield is a
 * weighted average and its notional a sum (ADR-67, ADR-68).
 */

import { aggregatedNumber } from '../grid/aggregations';
import { formatValue } from '../grid/meta';
import type { TreasuryTable } from '../grid/useTreasuryTable';
import type { SourceDescription } from '../data/source';

export function StatusBar({ table, about }: { table: TreasuryTable; about: SourceDescription | null }) {
  const filtered = table.getFilteredRowModel().rows.length;
  const total = table.getCoreRowModel().rows.length;
  const selected = table.getSelectedRowModel().rows.filter((r) => !r.getIsGrouped());
  const measures = table.getVisibleLeafColumns().filter((c) => c.columnDef.meta?.kind === 'measure' && c.columnDef.meta.agg);
  return (
    <div data-slot="status-bar" data-testid="status-bar" className="flex h-7 items-center gap-4 border-t border-border bg-card px-3 text-[11px] text-faint">
      <span data-slot="status-source">
        {about ? <>{about.name}{about.asOf ? <> · as of {about.asOf}</> : null}</> : 'describing the source…'}
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
