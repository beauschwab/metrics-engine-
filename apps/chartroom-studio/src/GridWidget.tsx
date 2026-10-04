/**
 * The grid as a dashboard widget (ADR-83). The binding resolves to the same
 * group query every other widget runs; the answer becomes a grid schema and
 * records (`metricGroupsSchema`, `metricGroupRows`), and the treasury grid
 * renders them with everything it has — grouping, sorting, filters, pivot,
 * calculated columns, range copy — over an in-memory source. The reader's
 * arrangement is the widget's `state`: a view the grid validates against the
 * columns it actually has, written back into the spec on every change so a
 * saved dashboard opens as it was left. A state the grid refuses falls back
 * to the default view rather than blocking the frame.
 *
 * A binding with a `window` also asks for each group's series over it, so the
 * value column has a history a reader may draw as a trend (ADR-89); a
 * threshold `compare` with a declared side is the limit a band draws against.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { parseMetricRef, type DashboardSpec, type FilterExpr, type WidgetInstance } from 'chartroom-spec';
import {
  TreasuryGrid, VIEW_VERSION, defaultView, inMemorySource, metricGroupRows, metricGroupsSchema, metricScale, orderFromRows, safeParseView,
  type ChartOutcome, type GridHistory, type ViewUpdate,
} from 'chartroom-grid';
import type { SeriesPoint, SparkLimit } from 'chartroom-widgets';
import { DEFAULT_ENV, requestsFor, type AnalystEnv, type GroupResult, type QueryResult } from './bindings';
import { runQuery, type ContractSummary } from './data';
import { ChartGallery } from './ChartGallery';

/** What the frame shows about the answer: its status and the date it was evaluated at. */
export interface GridFrameState {
  status: 'loading' | 'fresh' | 'empty' | 'error';
  asOf: string | null;
}

export function GridWidget({
  w, spec, contracts, extraFilters = [], env = DEFAULT_ENV, onState, onFrame, onAddWidget,
}: {
  w: WidgetInstance;
  spec: DashboardSpec;
  contracts: Map<string, ContractSummary>;
  extraFilters?: FilterExpr[];
  env?: AnalystEnv;
  /** The reader arranged the grid: keep it in the widget's state. */
  onState?: (id: string, state: Record<string, unknown>) => void;
  /** The grid runs the binding's query itself, so it tells the frame what it got. */
  onFrame?: (state: GridFrameState) => void;
  /** A chart the reader made from a selection, to add to the board (ADR-92). */
  onAddWidget?: (instance: WidgetInstance) => void;
}) {
  // "Chart selection" opens the gallery over the board (ADR-92), not a panel
  // inside this frame: the reader is choosing a new tile, not reading this one.
  const [charting, setCharting] = useState<ChartOutcome | null>(null);
  const contract = contracts.get(w.bind.metric);
  const dims = useMemo(() => (w.bind.dims ?? []).filter((d) => d !== 'as_of_date'), [JSON.stringify(w.bind.dims)]);
  // The dependency is the meaning of the binding — its resolved requests — not identity.
  const requests = useMemo(() => requestsFor(w, spec, extraFilters, env), [
    JSON.stringify(w.bind), JSON.stringify(spec.context), JSON.stringify(extraFilters), w.type, JSON.stringify(env),
  ]);
  const [answer, setAnswer] = useState<{ result: GroupResult | null; limit?: number; error?: string }>({ result: null });
  // The limit rides with the rows, not after them: a view that draws a band
  // is only valid once the schema has the limit, and a view refused for a
  // moment would flash the default arrangement.
  const side = w.bind.compare?.style === 'threshold' ? w.bind.compare.limit : undefined;
  useEffect(() => {
    let alive = true;
    Promise.all([runQuery(requests.main), side && requests.compare ? runQuery(requests.compare) : Promise.resolve(null)])
      .then(([r, c]) => {
        if (!alive) return;
        const limit = c?.kind === 'scalar' && Number.isFinite(c.value) ? c.value : undefined;
        if (r.kind === 'groups') setAnswer({ result: r, limit });
        else setAnswer({ result: null, error: 'a grid needs at least one dimension to make rows' });
      })
      .catch((e: unknown) => { if (alive) setAnswer({ result: null, error: e instanceof Error ? e.message : String(e) }); });
    return () => { alive = false; };
  }, [requests, side]);

  // Each group's series over the window (ADR-89): the same request with the
  // time dim added. It never holds the rows up — until it lands, or if it
  // fails, a trend reads as its plain number.
  const windowed = !!w.bind.window;
  const [series, setSeries] = useState<QueryResult | null>(null);
  useEffect(() => {
    setSeries(null);
    if (!windowed) return;
    let alive = true;
    runQuery({ ...requests.main, dims: [...dims, 'as_of_date'] })
      .then((r) => { if (alive) setSeries(r); })
      .catch(() => { /* the cells still say their numbers */ });
    return () => { alive = false; };
  }, [requests, windowed, dims]);

  // A `bps` metric is scaled to basis points once, on the way in (ADR-74).
  const scale = metricScale(answer.result?.format ?? contract?.format ?? 'number');
  const rows = useMemo(() => (answer.result ? metricGroupRows(answer.result.rows, dims, scale) : []), [answer.result, dims, scale]);
  useEffect(() => {
    onFrame?.({
      status: answer.error ? 'error' : !answer.result ? 'loading' : rows.length === 0 ? 'empty' : 'fresh',
      asOf: answer.result?.asOf ?? null,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the frame follows the answer
  }, [answer, rows.length]);
  const history = useMemo<GridHistory | null>(() => {
    if (series?.kind !== 'series') return null;
    // Keyed as the rows are (`metricGroupRows`), scaled as they are, so the last point is the cell's number.
    const s = metricScale(series.format);
    const byKey = new Map<string, SeriesPoint[]>(series.series.map((line) => [
      dims.map((d) => line.key[d] ?? '').join(' · '),
      line.points.map((p) => ({ date: p.date, value: p.value * s })),
    ]));
    return (rowId, columnId) => (columnId === 'value' ? byKey.get(rowId) : undefined);
  }, [series, dims]);
  const limit = useMemo<SparkLimit | undefined>(
    () => (side && answer.limit !== undefined && w.bind.compare && w.bind.compare.vs !== 'prior_period'
      ? { value: answer.limit * scale, side, label: parseMetricRef(w.bind.compare.vs)?.measure ?? w.bind.compare.vs }
      : undefined),
    [side, answer.limit, scale, w.bind.compare],
  );
  const schema = useMemo(
    () => metricGroupsSchema({
      measure: contract?.measure ?? w.bind.metric,
      unit: answer.result?.unit ?? contract?.unit ?? 'number',
      format: answer.result?.format ?? contract?.format ?? 'number',
      precision: contract?.precision,
      // An ordinal dim reads in its ladder's order (ADR-84): the contract's values
      // where the summary carries them, else the order the engine served the groups in — BAR-02's rule.
      dims: (contract?.dims ?? dims.map((name) => ({ name, ordinal: false }))).map((d) =>
        d.ordinal && !d.values?.length ? { ...d, values: orderFromRows(rows, d.name) } : d),
      allowed_aggregations: contract?.allowed_aggregations,
    }, dims, { history: windowed, limit }),
    [contract, answer.result?.unit, answer.result?.format, dims, rows, windowed, limit],
  );
  const source = useMemo(
    () => inMemorySource(rows, `${contract?.measure ?? w.bind.metric}${answer.result ? ` · as of ${answer.result.asOf}` : ''}`, schema),
    [rows, schema, contract?.measure, w.bind.metric, answer.result],
  );
  // The widget's state is the view; a refused one reads as the default.
  const view = useMemo(() => {
    const parsed = safeParseView(w.state ?? { version: VIEW_VERSION }, schema);
    return parsed.ok ? parsed.view : defaultView(schema);
  }, [JSON.stringify(w.state), schema]);
  // Two writes in one gesture — "Clear all filters" clears the column filters,
  // then the quick filter — must build on each other, not both on the view
  // this render read: the latest view is kept here until the spec catches up.
  const latest = useRef(view);
  latest.current = view;
  const onViewChange = (update: ViewUpdate) => {
    const next = update(latest.current);
    latest.current = next;
    onState?.(w.id, next as unknown as Record<string, unknown>);
  };

  if (answer.error) return <div className="cr-widget-error">{answer.error}</div>;
  if (!answer.result) return <div className="cr-skeleton cr-skeleton-chart" />;
  if (rows.length === 0) return <div className="cr-widget-empty">no groups match</div>;
  // No `edit` policy (ADR-87): a dashboard reads a governed number; the grid
  // is read-only here by the host's choice, not the package's.
  return (
    <div className="h-full min-h-0" data-slot="grid-widget" data-widget={w.id}>
      <TreasuryGrid source={source} view={view} onViewChange={onViewChange} viewStore={null} defaultDensity="compact" history={history} onChart={setCharting} />
      {charting && (
        <ChartGallery
          selection={charting.selection ?? { dims: [], measures: [] }}
          refusal={charting.ok ? undefined : charting.reason}
          source={w}
          spec={spec}
          contracts={contracts}
          env={env}
          onAdd={onAddWidget}
          onClose={() => setCharting(null)}
        />
      )}
    </div>
  );
}
