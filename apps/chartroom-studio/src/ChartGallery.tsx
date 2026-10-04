/**
 * Chart a grid selection, then keep it (ADR-92). The grid reports what the
 * reader selected; the planner turns it into one widget instance per kind in
 * the Evil Charts gallery — or the reason a kind cannot draw it — and this
 * dialog lets the reader pick a kind, dress it, and add it to the board.
 *
 * The preview *is* the widget: the candidate instance resolved through the
 * same hook and drawn by the same component the canvas uses, so what the
 * reader adds is exactly what they saw — a governed binding, re-evaluated at
 * the board's as-of, never a picture of the grid at the moment of selection.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import type { DashboardSpec, WidgetInstance } from 'chartroom-spec';
import type { RangeSelection } from 'chartroom-grid';
import {
  CHART_COMPONENTS, chartOptions, chartState, planCharts, type ChartCandidate, type ChartKind,
} from 'chartroom-charts';
import {
  ChartArea, ChartBarBig, ChartColumn, ChartColumnStacked, ChartLine, ChartNoAxesCombined, ChartPie,
  CircleGauge, Radar, Waypoints, X, type LucideIcon,
} from 'lucide-react';
import type { AnalystEnv } from './bindings';
import type { ContractSummary } from './data';
import { useWidgetData } from './useWidgetData';

const ICONS: Record<ChartKind, LucideIcon> = {
  'evil-bar': ChartColumn,
  'evil-stacked-bar': ChartColumnStacked,
  'evil-composed': ChartNoAxesCombined,
  'evil-line': ChartLine,
  'evil-area': ChartArea,
  'evil-stacked-area': ChartBarBig,
  'evil-pie': ChartPie,
  'evil-radial': CircleGauge,
  'evil-radar': Radar,
  'evil-sankey': Waypoints,
};

/** The spec's ceiling on a board's widgets. */
const MAX_WIDGETS = 24;
const WIDTHS = [{ w: 4, label: 'Third' }, { w: 6, label: 'Half' }, { w: 12, label: 'Full' }] as const;

/** A slug no widget on the board has yet. */
export function freeId(spec: DashboardSpec, kind: ChartKind): string {
  const stem = kind.replace(/^evil-/, '');
  const taken = new Set(spec.widgets.map((w) => w.id));
  for (let n = 1; ; n++) if (!taken.has(`${stem}-${n}`)) return `${stem}-${n}`;
}

/** Below everything on the board, at the left edge: a new tile never covers one. */
export function freePos(spec: DashboardSpec, w: number, h = 4): WidgetInstance['pos'] {
  const y = spec.widgets.reduce((m, x) => Math.max(m, x.pos.y + x.pos.h), 0);
  return { x: 0, y, w, h };
}

function Preview({ instance, spec, contracts, env }: {
  instance: WidgetInstance; spec: DashboardSpec; contracts: Map<string, ContractSummary>; env: AnalystEnv;
}) {
  const query = useWidgetData(instance, spec, contracts, [], env);
  const Component = CHART_COMPONENTS[instance.type];
  if (!Component) return null;
  return <Component instance={instance} data={query.data} status={query.status} error={query.error} />;
}

export function ChartGallery({
  selection, refusal, source, spec, contracts, env, onAdd, onClose,
}: {
  selection: RangeSelection;
  /** Why the grid could not read a block at all — one block at a time, a block at all. */
  refusal?: string;
  /** The grid widget the selection was made in. */
  source: WidgetInstance;
  spec: DashboardSpec;
  contracts: Map<string, ContractSummary>;
  env: AnalystEnv;
  /** Absent where the host cannot keep a chart — the gallery still previews. */
  onAdd?: (instance: WidgetInstance) => void;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = dialog.current;
    if (d && !d.open) d.showModal();
  }, []);

  const [width, setWidth] = useState(6);
  const candidates = useMemo<ChartCandidate[]>(
    () => planCharts({
      source, metric: contracts.get(source.bind.metric), selection,
      id: 'chart-preview', pos: freePos(spec, width),
    }),
    [source, contracts, selection, spec, width],
  );
  // The first kind that draws the selection — or, when none can, the first, so its reason is on screen.
  const [kind, setKind] = useState<ChartKind | null>(() => (candidates.find((c) => c.ok) ?? candidates[0])?.spec.kind ?? null);
  const picked = candidates.find((c) => c.spec.kind === kind);
  // Options and title per kind, kept while the reader moves between kinds.
  const [options, setOptions] = useState<Partial<Record<ChartKind, Record<string, string>>>>({});
  const [titles, setTitles] = useState<Partial<Record<ChartKind, string>>>({});

  const instance = useMemo<WidgetInstance | null>(() => {
    if (!picked?.ok) return null;
    const k = picked.spec.kind;
    const opts = { ...chartOptions(picked.instance.type, picked.instance.state), ...options[k] };
    return {
      ...picked.instance,
      id: freeId(spec, k),
      title: (titles[k] ?? picked.instance.title ?? '').slice(0, 80) || picked.instance.title,
      state: chartState(opts),
    };
  }, [picked, options, titles, spec]);

  const full = spec.widgets.length >= MAX_WIDGETS;
  const summary = selection.dims.map((d) => `${d.label}: ${d.values.length > 4 ? `${d.values.slice(0, 4).join(', ')} +${d.values.length - 4}` : d.values.join(', ')}`).join(' · ');

  const close = () => { dialog.current?.close(); };

  return (
    <dialog
      ref={dialog}
      data-testid="chart-gallery"
      aria-labelledby="chart-gallery-title"
      className="cr-chart-gallery w-[min(1080px,calc(100vw-32px))] max-h-[calc(100vh-32px)] overflow-hidden rounded-md border border-border bg-card p-0 text-foreground shadow-xl"
      onClose={onClose}
      // The dialog sits in the grid's frame in the DOM, though the top layer
      // draws it over the board: a click in it must not also select that frame.
      onClick={(e) => { e.stopPropagation(); if (e.target === dialog.current) close(); }}
    >
      <div className="flex max-h-[calc(100vh-34px)] flex-col">
        <header className="flex items-start justify-between gap-4 border-b border-border px-4 py-3">
          <div className="min-w-0">
            <h2 id="chart-gallery-title" className="text-sm font-semibold">Chart the selection</h2>
            {refusal && selection.dims.length === 0
              ? <p role="note" className="text-xs text-breach-text">{refusal}</p>
              : <p className="truncate text-xs text-muted-foreground" title={summary}>{summary || 'no dimension in the selection'}</p>}
          </div>
          <button type="button" aria-label="Close" className="rounded-sm p-1 text-muted-foreground hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring" onClick={close}>
            <X className="size-4" />
          </button>
        </header>

        <div className="grid min-h-0 flex-1 grid-cols-1 overflow-auto md:grid-cols-[300px_1fr]">
          <div role="radiogroup" aria-label="Chart type" className="grid content-start grid-cols-2 gap-1.5 border-b border-border p-3 md:border-r md:border-b-0">
            {candidates.map((c) => {
              const Icon = ICONS[c.spec.kind];
              const active = c.spec.kind === kind;
              return (
                <button
                  key={c.spec.kind}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  data-kind={c.spec.kind}
                  data-ok={c.ok}
                  title={c.ok ? c.spec.blurb : c.reason}
                  onClick={() => setKind(c.spec.kind)}
                  className={[
                    'flex min-h-14 flex-col items-start gap-1 rounded-sm border px-2 py-1.5 text-left text-xs outline-none',
                    'focus-visible:ring-1 focus-visible:ring-ring',
                    active ? 'border-primary bg-secondary' : 'border-border hover:border-muted-foreground',
                    c.ok ? '' : 'opacity-60',
                  ].join(' ')}
                >
                  <span className="flex items-center gap-1.5 font-medium">
                    <Icon className="size-4 shrink-0" aria-hidden="true" />
                    {c.spec.label}
                  </span>
                  {!c.ok && <span className="text-[11px] leading-tight text-muted-foreground">can’t draw this</span>}
                </button>
              );
            })}
          </div>

          <section className="flex min-w-0 flex-col gap-3 p-4" aria-live="polite">
            {!picked
              ? <p className="text-xs text-muted-foreground">Pick a chart type.</p>
              : !picked.ok
                ? (
                  <div data-slot="chart-refused" className="flex flex-col gap-1">
                    <h3 className="text-sm font-semibold">{picked.spec.label}</h3>
                    <p className="text-xs text-muted-foreground">{picked.spec.blurb}</p>
                    <p role="note" className="text-xs text-breach-text">{picked.reason}</p>
                  </div>
                )
                : instance && (
                  <>
                    <div className="flex flex-col gap-0.5">
                      <h3 className="text-sm font-semibold">{picked.spec.label} <span className="font-normal text-muted-foreground">· Evil Charts {picked.spec.source}</span></h3>
                      <p className="text-xs text-muted-foreground">{picked.spec.blurb}</p>
                    </div>
                    <div data-testid="chart-preview" className="h-72 shrink-0 rounded-sm border border-border bg-background p-2">
                      <Preview instance={instance} spec={spec} contracts={contracts} env={env} />
                    </div>
                    {picked.note && <p className="text-xs text-muted-foreground" data-slot="chart-note">{picked.note}</p>}

                    <div className="grid gap-x-4 gap-y-2 sm:grid-cols-2" data-slot="chart-options">
                      {picked.spec.options.map((o) => {
                        const current = chartOptions(instance.type, instance.state)[o.key];
                        return (
                          <fieldset key={o.key} className="flex min-w-0 flex-col gap-1">
                            <legend className="mb-1 text-[11px] font-semibold tracking-[0.06em] text-muted-foreground uppercase">{o.label}</legend>
                            <div className="flex flex-wrap gap-1">
                              {o.values.map((v) => (
                                <button
                                  key={v}
                                  type="button"
                                  aria-pressed={current === v}
                                  data-option={`${o.key}:${v}`}
                                  onClick={() => setOptions((all) => ({ ...all, [picked.spec.kind]: { ...all[picked.spec.kind], [o.key]: v } }))}
                                  className={[
                                    'rounded-sm border px-1.5 py-0.5 text-xs outline-none focus-visible:ring-1 focus-visible:ring-ring',
                                    current === v ? 'border-primary bg-primary text-primary-foreground' : 'border-border hover:border-muted-foreground',
                                  ].join(' ')}
                                >
                                  {v.replace(/-/g, ' ')}
                                </button>
                              ))}
                            </div>
                          </fieldset>
                        );
                      })}
                    </div>

                    <div className="flex flex-wrap items-end gap-3 border-t border-border pt-3">
                      <label className="flex min-w-48 flex-1 flex-col gap-1 text-[11px] font-semibold tracking-[0.06em] text-muted-foreground uppercase">
                        Title
                        <input
                          className="h-7 rounded-sm border border-input bg-transparent px-1.5 text-xs font-normal tracking-normal text-foreground normal-case outline-none focus-visible:border-ring"
                          maxLength={80}
                          value={titles[picked.spec.kind] ?? picked.instance.title ?? ''}
                          onChange={(e) => setTitles((t) => ({ ...t, [picked.spec.kind]: e.target.value }))}
                        />
                      </label>
                      <fieldset className="flex flex-col gap-1">
                        <legend className="mb-1 text-[11px] font-semibold tracking-[0.06em] text-muted-foreground uppercase">Width</legend>
                        <div className="flex gap-1">
                          {WIDTHS.map((x) => (
                            <button
                              key={x.w}
                              type="button"
                              aria-pressed={width === x.w}
                              onClick={() => setWidth(x.w)}
                              className={[
                                'rounded-sm border px-1.5 py-0.5 text-xs outline-none focus-visible:ring-1 focus-visible:ring-ring',
                                width === x.w ? 'border-primary bg-primary text-primary-foreground' : 'border-border hover:border-muted-foreground',
                              ].join(' ')}
                            >
                              {x.label}
                            </button>
                          ))}
                        </div>
                      </fieldset>
                      <div className="ml-auto flex flex-col items-end gap-1">
                        {full && <span className="text-xs text-breach-text">the board holds {MAX_WIDGETS} widgets already</span>}
                        <button
                          type="button"
                          data-testid="add-to-dashboard"
                          disabled={!onAdd || full}
                          onClick={() => { onAdd?.(instance); close(); }}
                          className="h-8 rounded-sm bg-primary px-3 text-xs font-semibold text-primary-foreground outline-none hover:opacity-90 focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50"
                        >
                          Add to dashboard
                        </button>
                      </div>
                    </div>
                  </>
                )}
          </section>
        </div>
      </div>
    </dialog>
  );
}
