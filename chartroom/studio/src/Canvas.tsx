/**
 * The interpreter — the spec's `pos` data rendered as a CSS grid (ADR-10).
 *
 * A pure read of the spec: selection and the active cross-filter are the only
 * state it touches, and edits flow back out through the inspector, never
 * through the canvas. The frame carries what governance needs visible at a
 * glance — the bound function, its pinned version, and the DRAFT watermark
 * when uncertified metrics are on screen.
 *
 * Cross-filtering (Phase 4) is spec-interpreted, not widget-invented: a
 * widget is clickable only when `spec.interactions` names it a source, a
 * click narrows only the declared targets, and the active filter is a visible
 * chip — never ambient state a reader has to infer from the numbers looking
 * odd. IX-01 lints the wiring; this file merely obeys it.
 */

import { useEffect, useState } from 'react';
import type { DashboardSpec, FilterExpr, WidgetInstance } from 'chartroom-spec';
import { parseMetricRef } from 'chartroom-spec';
import { COMPONENTS } from 'chartroom-widgets';
import type { ContractSummary } from './data';
import { useWidgetData } from './useWidgetData';

interface CrossFilter {
  source: string;
  dim: string;
  value: string;
}

interface FrameProps {
  w: WidgetInstance;
  spec: DashboardSpec;
  contracts: Map<string, ContractSummary>;
  selected: boolean;
  onSelect(id: string): void;
  extraFilters: FilterExpr[];
  pickDim: string | null;
  picked: CrossFilter | null;
  onPick(key: Record<string, string>): void;
  /** Type refs the catalog carries but nothing can draw yet (ADR-47). */
  unrenderable: ReadonlySet<string>;
}

function Frame({
  w, spec, contracts, selected, onSelect, extraFilters, pickDim, picked, onPick,
  unrenderable,
}: FrameProps) {
  const { data, status, error } = useWidgetData(w, spec, contracts, extraFilters);
  const Component = COMPONENTS[w.type];
  const ref = parseMetricRef(w.bind.metric);
  const contract = contracts.get(w.bind.metric);

  return (
    <section
      className="cr-frame"
      data-selected={selected || undefined}
      data-status={status}
      data-filtered={extraFilters.length > 0 || undefined}
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
          {extraFilters.length > 0 && (
            <span className="cr-frame-filtered" data-testid={`filtered-${w.id}`}>filtered</span>
          )}
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
          ? (
            <Component
              instance={w}
              data={data}
              status={status}
              error={error}
              onPick={pickDim ? onPick : undefined}
              picked={picked && picked.source === w.id ? { [picked.dim]: picked.value } : null}
            />
          )
          : unrenderable.has(w.type)
            ? (
              // Contract-first (ADR-47): the catalog really does carry this
              // widget — a design steward approved the contract — but no
              // implementation has landed, so the frame says which of the two
              // is missing rather than reading as a broken binding.
              <div className="cr-widget-pending" data-testid={`pending-${w.id}`}>
                {w.type} is an approved contract with no renderer yet
              </div>
            )
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
  /** From /api/widgets — approved contracts with no renderer yet (ADR-47). */
  unrenderable?: ReadonlySet<string>;
}

export function Canvas({
  spec, contracts, selected, onSelect, unrenderable = new Set<string>(),
}: CanvasProps) {
  const [cross, setCross] = useState<CrossFilter | null>(null);
  // A filter belongs to the dashboard it was clicked on.
  useEffect(() => setCross(null), [spec.dashboard.id]);

  // The watermark the PRD asks for: draft chrome whenever the dashboard is a
  // draft or any bound metric is ungoverned — said once, over the canvas, not
  // guessed from tile to tile.
  const uncertified = spec.dashboard.status === 'draft'
    || spec.widgets.some((w) => contracts.get(w.bind.metric)?.status !== 'approved');

  const sourceDim = (id: string): string | null =>
    spec.interactions.find((ix) => ix.cross_filter.source === id)?.cross_filter.dim ?? null;

  const targetsOf = (filter: CrossFilter): Set<string> => {
    const hit = spec.interactions.find(
      (ix) => ix.cross_filter.source === filter.source && ix.cross_filter.dim === filter.dim,
    );
    return new Set(hit?.cross_filter.targets ?? []);
  };

  const activeTargets = cross ? targetsOf(cross) : new Set<string>();

  const pickFor = (w: WidgetInstance) => (key: Record<string, string>) => {
    const dim = sourceDim(w.id);
    if (!dim || key[dim] === undefined) return;
    const next = { source: w.id, dim, value: key[dim] };
    // Clicking the active value again clears — a filter should die where it
    // was born, not only at the chip.
    setCross((c) => (c && c.source === next.source && c.dim === next.dim && c.value === next.value
      ? null
      : next));
  };

  return (
    <div className="cr-canvas-wrap" data-testid="canvas">
      {uncertified && (
        <div className="cr-watermark" aria-hidden="true">
          DRAFT · uncertified metrics present
        </div>
      )}
      {cross && (
        <div className="cr-crossfilter-bar" data-testid="crossfilter-chip">
          <span className="cr-crossfilter-chip">
            {cross.dim} = {cross.value}
            <span className="cr-crossfilter-src"> · from {cross.source}</span>
          </span>
          <button
            type="button"
            className="cr-crossfilter-clear"
            data-testid="crossfilter-clear"
            onClick={() => setCross(null)}
          >
            clear
          </button>
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
            extraFilters={cross && activeTargets.has(w.id)
              ? [{ dim: cross.dim, op: '=', value: cross.value }]
              : []}
            pickDim={sourceDim(w.id)}
            picked={cross}
            onPick={pickFor(w)}
            unrenderable={unrenderable}
          />
        ))}
      </div>
    </div>
  );
}
