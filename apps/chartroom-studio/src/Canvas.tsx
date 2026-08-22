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
 * odd. IX-01 lints the wiring; this file merely obeys it. The chip itself now
 * renders in the context bar, with the rest of the scope: the filter is state
 * the whole board is read under, so it belongs where entity and as-of are, not
 * floating above the tiles.
 */

import type { DashboardSpec, FilterExpr, WidgetInstance } from 'chartroom-spec';
import { parseMetricRef } from 'chartroom-spec';
import { COMPONENTS } from 'chartroom-widgets';
import type { AnalystEnv } from './bindings';
import type { CrossFilter } from './analyst/ContextBar';
import type { ContractSummary } from './data';
import { useWidgetData } from './useWidgetData';

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
  env: AnalystEnv;
  onExplain(id: string): void;
  /** This widget is attached to the agent conversation (ADR-55). */
  attached: boolean;
  onAsk(id: string): void;
}

function Frame({
  w, spec, contracts, selected, onSelect, extraFilters, pickDim, picked, onPick,
  unrenderable, env, onExplain, attached, onAsk,
}: FrameProps) {
  const { data, status, error } = useWidgetData(w, spec, contracts, extraFilters, env);
  const Component = COMPONENTS[w.type];
  const ref = parseMetricRef(w.bind.metric);
  const contract = contracts.get(w.bind.metric);

  return (
    <section
      className="cr-frame"
      data-selected={selected || undefined}
      data-attached={attached || undefined}
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
      {/*
        The frame's provenance line. The as-of comes from the response, not
        from what the bar asked for: if the engine resolved a different date
        than the one requested — an unknown date falls back to the latest
        close — the frame says the date it actually drew, which is the only
        one a reader can act on.
      */}
      <footer className="cr-frame-foot">
        <span
          className="cr-frame-asof"
          data-stale={(data?.asOf && env.asOf && data.asOf !== env.asOf) || undefined}
          title="the date this frame was evaluated at"
        >
          {data?.asOf ?? '—'}
        </span>
        <span className="cr-context-spacer" />
        {ref && (
          <span
            className="cr-frame-ref"
            data-status={contract?.status ?? 'unknown'}
            title={`${w.bind.metric} · ${contract?.status ?? 'not in the registry'}`}
          >
            {ref.measure}@{ref.version}
          </span>
        )}
        <button
          type="button"
          className="cr-frame-explain"
          data-testid={`explain-${w.id}`}
          title="Where this number comes from"
          onClick={(e) => { e.stopPropagation(); onExplain(w.id); }}
        >
          explain
        </button>
        {/*
          The pointer (ADR-55): "explain this tile" as a resolved reference.
          The chip lands in the composer carrying the widget, its binding and
          the scope the reader was looking at — not a phrase the agent has to
          guess about.
        */}
        <button
          type="button"
          className="cr-frame-ask"
          data-attached={attached || undefined}
          data-testid={`ask-${w.id}`}
          title={attached ? 'attached to the conversation' : 'attach this widget to the conversation'}
          onClick={(e) => { e.stopPropagation(); onAsk(w.id); }}
        >
          {attached ? '\u2733 in chat' : '\u2733 ask'}
        </button>
      </footer>
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
  env: AnalystEnv;
  /** Lifted: the chip renders in the context bar, so the state lives above. */
  cross: CrossFilter | null;
  onCross(next: CrossFilter | null): void;
  onExplain(id: string): void;
  /** Widget ids attached to the agent conversation (ADR-55). */
  attached?: ReadonlySet<string>;
  onAsk?(id: string): void;
}

export function Canvas({
  spec, contracts, selected, onSelect, unrenderable = new Set<string>(),
  env, cross, onCross, onExplain, attached = new Set<string>(), onAsk = () => {},
}: CanvasProps) {

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
    onCross(
      cross && cross.source === next.source && cross.dim === next.dim && cross.value === next.value
        ? null
        : next,
    );
  };

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
            extraFilters={cross && activeTargets.has(w.id)
              ? [{ dim: cross.dim, op: '=', value: cross.value }]
              : []}
            pickDim={sourceDim(w.id)}
            picked={cross}
            onPick={pickFor(w)}
            unrenderable={unrenderable}
            env={env}
            onExplain={onExplain}
            attached={attached.has(w.id)}
            onAsk={onAsk}
          />
        ))}
      </div>
    </div>
  );
}
