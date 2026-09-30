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
 */

import { useEffect, useMemo, useState } from 'react';
import type { DashboardSpec, FilterExpr, WidgetInstance } from 'chartroom-spec';
import {
  TreasuryGrid, VIEW_VERSION, defaultView, inMemorySource, metricGroupRows, metricGroupsSchema, safeParseView,
  type ViewUpdate,
} from 'chartroom-grid';
import { DEFAULT_ENV, requestsFor, type AnalystEnv, type GroupResult } from './bindings';
import { runQuery, type ContractSummary } from './data';

export function GridWidget({
  w, spec, contracts, extraFilters = [], env = DEFAULT_ENV, onState,
}: {
  w: WidgetInstance;
  spec: DashboardSpec;
  contracts: Map<string, ContractSummary>;
  extraFilters?: FilterExpr[];
  env?: AnalystEnv;
  /** The reader arranged the grid: keep it in the widget's state. */
  onState?: (id: string, state: Record<string, unknown>) => void;
}) {
  const contract = contracts.get(w.bind.metric);
  const dims = useMemo(() => (w.bind.dims ?? []).filter((d) => d !== 'as_of_date'), [JSON.stringify(w.bind.dims)]);
  // The dependency is the meaning of the binding — its resolved requests — not identity.
  const requests = useMemo(() => requestsFor(w, spec, extraFilters, env), [
    JSON.stringify(w.bind), JSON.stringify(spec.context), JSON.stringify(extraFilters), w.type, JSON.stringify(env),
  ]);
  const [answer, setAnswer] = useState<{ result: GroupResult | null; error?: string }>({ result: null });
  useEffect(() => {
    let alive = true;
    runQuery(requests.main)
      .then((r) => {
        if (!alive) return;
        if (r.kind === 'groups') setAnswer({ result: r });
        else setAnswer({ result: null, error: 'a grid needs at least one dimension to make rows' });
      })
      .catch((e: unknown) => { if (alive) setAnswer({ result: null, error: e instanceof Error ? e.message : String(e) }); });
    return () => { alive = false; };
  }, [requests]);

  const schema = useMemo(
    () => metricGroupsSchema({
      measure: contract?.measure ?? w.bind.metric,
      unit: answer.result?.unit ?? contract?.unit ?? 'number',
      format: answer.result?.format ?? contract?.format ?? 'number',
      precision: contract?.precision,
      dims: contract?.dims ?? dims.map((name) => ({ name })),
      allowed_aggregations: contract?.allowed_aggregations,
    }, dims),
    [contract, answer.result?.unit, answer.result?.format, dims],
  );
  const rows = useMemo(() => (answer.result ? metricGroupRows(answer.result.rows, dims) : []), [answer.result, dims]);
  const source = useMemo(
    () => inMemorySource(rows, `${contract?.measure ?? w.bind.metric}${answer.result ? ` · as of ${answer.result.asOf}` : ''}`, schema),
    [rows, schema, contract?.measure, w.bind.metric, answer.result],
  );
  // The widget's state is the view; a refused one reads as the default.
  const view = useMemo(() => {
    const parsed = safeParseView(w.state ?? { version: VIEW_VERSION }, schema);
    return parsed.ok ? parsed.view : defaultView(schema);
  }, [JSON.stringify(w.state), schema]);
  const onViewChange = (update: ViewUpdate) => onState?.(w.id, update(view) as unknown as Record<string, unknown>);

  if (answer.error) return <div className="cr-widget-error">{answer.error}</div>;
  if (!answer.result) return <div className="cr-skeleton cr-skeleton-chart" />;
  if (rows.length === 0) return <div className="cr-widget-empty">no groups match</div>;
  return (
    <div className="h-full min-h-0" data-slot="grid-widget" data-widget={w.id}>
      <TreasuryGrid source={source} view={view} onViewChange={onViewChange} viewStore={null} defaultDensity="compact" />
    </div>
  );
}
