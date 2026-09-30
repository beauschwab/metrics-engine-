/**
 * The chart panel beside the grid (ADR-81): the grid describes a widget —
 * a category, one series per measure, data in the widgets' own shape — and
 * this host renders it with the governed `Bar`, the same renderer a
 * dashboard uses, so a number charted from the grid formats and colours
 * as it does everywhere else. A refusal shows its reason instead.
 */

import { Bar, type WidgetData } from 'chartroom-widgets';
import type { WidgetInstance } from 'chartroom-spec';
import type { ChartOutcome } from 'chartroom-grid';

const instance = (id: string, dim: string): WidgetInstance => ({
  id, type: 'bar@1', pos: { x: 0, y: 0, w: 4, h: 3 },
  bind: { metric: 'keel://grid.range@1', dims: [dim], sort: 'dim' },
});

export function RangeChart({ outcome, onClose }: { outcome: ChartOutcome; onClose: () => void }) {
  return (
    <aside data-testid="range-chart" className="flex w-96 shrink-0 flex-col border-l border-border bg-card text-xs" data-ok={outcome.ok}>
      <div className="flex items-center justify-between px-3 py-2">
        <span className="font-semibold tracking-[0.06em] uppercase text-[10px] text-faint">
          {outcome.ok ? outcome.request.title : 'Chart selection'}
        </span>
        <button type="button" className="cr-link" onClick={onClose} aria-label="Close chart">close</button>
      </div>
      {outcome.ok ? (
        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-auto px-3 pb-3">
          {outcome.request.series.map((s) => (
            <section key={s.columnId} data-slot="range-chart-series" data-column={s.columnId}>
              <div className="mb-1 text-faint">{s.label}</div>
              <Bar instance={instance(`range-${s.columnId}`, outcome.request.category.columnId)} data={s.data as WidgetData} status="fresh" />
            </section>
          ))}
        </div>
      ) : (
        <div role="alert" data-slot="range-chart-refused" className="px-3 pb-3 text-breach-text">{outcome.reason}</div>
      )}
    </aside>
  );
}
