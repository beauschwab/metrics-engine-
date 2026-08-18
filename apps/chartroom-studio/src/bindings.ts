/**
 * Binding resolution — a widget's `bind` becomes query requests and the
 * responses become `WidgetData`.
 *
 * This is the interpreter's only smart part, and it is deliberately a pure
 * module: `requestsFor` says what to ask, `assemble` says what the widget
 * sees, and the component in between is plumbing. Both halves are unit-tested
 * without a server.
 */

import {
  parseMetricRef,
  type Binding, type DashboardSpec, type FilterExpr, type WidgetInstance,
} from 'chartroom-spec';
import type { WidgetData } from 'chartroom-widgets';
import type { ContractSummary } from './data';

// Mirrors the server's response types — the studio compiles against the same
// package the server serves from, so drift is a type error, not a surprise.
export interface QueryRequest {
  metric: string;
  dims?: string[];
  filters?: Binding['filters'];
  window?: { trailing: string };
  params?: Record<string, string>;
  max_cells?: number;
}
export interface SeriesResult {
  kind: 'series';
  unit: string;
  format: string;
  series: Array<{ key: Record<string, string>; points: Array<{ date: string; value: number }> }>;
  asOf: string;
}
export interface GroupResult {
  kind: 'groups';
  unit: string;
  format: string;
  rows: Array<{ key: Record<string, string>; value: number; prior: number }>;
  asOf: string;
}
export interface ScalarResult {
  kind: 'scalar';
  unit: string;
  format: string;
  value: number;
  prior: number;
  asOf: string;
}
export type QueryResult = SeriesResult | GroupResult | ScalarResult;

export interface ResolvedRequests {
  main: QueryRequest;
  compare: QueryRequest | null;
  bands: QueryRequest[];
}

/** Context params resolved to their defaults (Phase 1 — no context bar yet). */
export function paramsOf(spec: DashboardSpec): Record<string, string> {
  return Object.fromEntries(
    Object.entries(spec.context).map(([name, p]) => [name, p.default]),
  );
}

export function requestsFor(
  w: WidgetInstance,
  spec: DashboardSpec,
  // Cross-filter narrowing from an interaction source — main leg only:
  // compare thresholds and bands stay global on purpose (a floor is a floor,
  // whatever slice is highlighted).
  extraFilters: FilterExpr[] = [],
): ResolvedRequests {
  const params = paramsOf(spec);
  const bind = w.bind;
  const filters = [...(bind.filters ?? []), ...extraFilters];
  const main: QueryRequest = {
    metric: bind.metric,
    ...(bind.dims?.length ? { dims: bind.dims } : {}),
    ...(filters.length ? { filters } : {}),
    ...(bind.window ? { window: bind.window } : {}),
    ...(Object.keys(params).length ? { params } : {}),
    ...(bind.max_cells !== undefined ? { max_cells: bind.max_cells } : {}),
  };

  const compare = bind.compare && bind.compare.vs !== 'prior_period'
    ? { metric: bind.compare.vs, ...(Object.keys(params).length ? { params } : {}) }
    : null;

  // Bands ride the widget's own window so the reference covers the same days.
  const bands = (bind.bands ?? []).map((ref) => ({
    metric: ref,
    dims: ['as_of_date'],
    ...(bind.window ? { window: bind.window } : {}),
    ...(Object.keys(params).length ? { params } : {}),
  }));

  return { main, compare, bands };
}

const label = (ref: string): string => parseMetricRef(ref)?.measure ?? ref;

export function assemble(
  w: WidgetInstance,
  main: QueryResult,
  compare: QueryResult | null,
  bands: Array<{ ref: string; result: QueryResult }>,
  contract: ContractSummary | undefined,
): WidgetData {
  const data: WidgetData = { unit: main.unit, format: main.format, asOf: main.asOf };

  if (main.kind === 'scalar') data.scalar = { value: main.value, prior: main.prior };
  if (main.kind === 'groups') {
    data.rows = main.rows;
    const catDim = (w.bind.dims ?? []).find((d) => d !== 'as_of_date');
    data.ordinalDim = !!contract?.dims.find((d) => d.name === catDim)?.ordinal;
  }
  if (main.kind === 'series') data.series = main.series;

  if (w.bind.compare) {
    if (w.bind.compare.vs === 'prior_period') {
      if (main.kind === 'scalar') {
        data.compare = { label: 'prior day', value: main.prior, style: w.bind.compare.style };
      }
    } else if (compare && compare.kind === 'scalar') {
      data.compare = {
        label: label(w.bind.compare.vs),
        value: compare.value,
        style: w.bind.compare.style,
      };
    }
  }

  const bandData = bands
    .filter((b) => b.result.kind === 'series')
    .map((b) => ({
      label: label(b.ref),
      points: (b.result as SeriesResult).series[0]?.points ?? [],
    }));
  if (bandData.length) data.bands = bandData;

  return data;
}
