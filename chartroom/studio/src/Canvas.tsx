/**
 * The interpreter — the spec's `pos` data rendered as a CSS grid (ADR-10).
 *
 * A pure read of the spec: selection is the only state it touches, and edits
 * flow back out through the inspector, never through the canvas. The frame
 * carries what governance needs visible at a glance — the bound function, its
 * pinned version, and the DRAFT watermark when uncertified metrics are on
 * screen.
 */

import type { DashboardSpec, WidgetInstance } from 'chartroom-spec';
import { parseMetricRef } from 'chartroom-spec';
import { COMPONENTS } from 'chartroom-widgets';
import type { ContractSummary } from './data';
import { useWidgetData } from './useWidgetData';

interface FrameProps {
  w: WidgetInstance;
  spec: DashboardSpec;
  contracts: Map<string, ContractSummary>;
  selected: boolean;
  onSelect(id: string): void;
}

function Frame({ w, spec, contracts, selected, onSelect }: FrameProps) {
  const { data, status, error } = useWidgetData(w, spec, contracts);
  const Component = COMPONENTS[w.type];
  const ref = parseMetricRef(w.bind.metric);
  const contract = contracts.get(w.bind.metric);

  return (
    <section
      className="cr-frame"
      data-selected={selected || undefined}
      data-status={status}
      data-testid={`widget-${w.id}`}
      style={{
        gridColumn: `${w.pos.x + 1} / span ${w.pos.w}`,
        gridRow: `${w.pos.y + 1} / span ${w.pos.h}`,
      }}
      onClick={() => onSelect(w.id)}
    >
      <header className="cr-frame-head">
        <span className="cr-frame-title">{w.title || ref?.measure || w.id}</span>
        <span className="cr-frame-meta">
          {ref && (
            <span
              className="cr-frame-ref"
              data-status={contract?.status ?? 'unknown'}
              title={`${w.bind.metric} · ${contract?.status ?? 'not in the registry'}`}
            >
              {ref.measure}@{ref.version}
            </span>
          )}
        </span>
      </header>
      <div className="cr-frame-body">
        {Component
          ? <Component instance={w} data={data} status={status} error={error} />
          : <div className="cr-widget-error">{w.type} is not in the catalog</div>}
      </div>
    </section>
  );
}

interface CanvasProps {
  spec: DashboardSpec;
  contracts: Map<string, ContractSummary>;
  selected: string | null;
  onSelect(id: string): void;
}

export function Canvas({ spec, contracts, selected, onSelect }: CanvasProps) {
  // The watermark the PRD asks for: draft chrome whenever the dashboard is a
  // draft or any bound metric is ungoverned — said once, over the canvas, not
  // guessed from tile to tile.
  const uncertified = spec.dashboard.status === 'draft'
    || spec.widgets.some((w) => contracts.get(w.bind.metric)?.status !== 'approved');

  return (
    <div className="cr-canvas-wrap" data-testid="canvas">
      {uncertified && (
        <div className="cr-watermark" aria-hidden="true">
          DRAFT · uncertified metrics present
        </div>
      )}
      <div
        className="cr-canvas"
        style={{ gridAutoRows: `${spec.layout.grid.row_height}px` }}
      >
        {spec.widgets.map((w) => (
          <Frame
            key={w.id}
            w={w}
            spec={spec}
            contracts={contracts}
            selected={selected === w.id}
            onSelect={onSelect}
          />
        ))}
      </div>
    </div>
  );
}
