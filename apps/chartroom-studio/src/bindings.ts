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
  asOf?: string;
  basis?: Basis;
  max_cells?: number;
}

/** Mirrors the server's `Basis` — the delta's reference point. */
export type Basis = 'prior_day' | 'prior_week' | 'month_end';

/**
 * What the analyst bar is currently asking for. Every widget on the board
 * reads the same one, which is the point: a dashboard whose tiles sat on
 * different as-of dates would be a governance problem, not a feature.
 */
export interface AnalystEnv {
  asOf: string | null;
  basis: Basis;
  /** Context-param overrides from the context bar, by param name. */
  params: Record<string, string>;
}

export const DEFAULT_ENV: AnalystEnv = { asOf: null, basis: 'prior_day', params: {} };

/**
 * What `prior_period` means once the basis is selectable. The tile prints this
 * beside the delta, so it has to follow the control: a tile reading "vs prior
 * day" while the bar says month-end is a mislabelled number, which is worse
 * than no label at all.
 */
export const BASIS_LABEL: Record<Basis, string> = {
  prior_day: 'prior day',
  prior_week: 'prior week',
  month_end: 'month-end',
};
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

/**
 * Context params resolved to values: the spec's declared defaults, with the
 * context bar's selections layered over them. Only params the spec actually
 * declares survive — the bar cannot invent a param the board never named, so
 * a stale selection from a previous board is dropped rather than sent.
 */
export function paramsOf(
  spec: DashboardSpec,
  overrides: Record<string, string> = {},
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(spec.context).map(([name, p]) => [name, overrides[name] ?? p.default]),
  );
}

export function requestsFor(
  w: WidgetInstance,
  spec: DashboardSpec,
  // Cross-filter narrowing from an interaction source — main leg only:
  // compare thresholds and bands stay global on purpose (a floor is a floor,
  // whatever slice is highlighted).
  extraFilters: FilterExpr[] = [],
  env: AnalystEnv = DEFAULT_ENV,
): ResolvedRequests {
  const params = paramsOf(spec, env.params);
  const bind = w.bind;
  // The as-of date and the basis ride every leg — main, compare and bands
  // alike. A band drawn at today's date under a tile read at last month's
  // would be a reference line for a number that is not on screen.
  const at = {
    ...(env.asOf ? { asOf: env.asOf } : {}),
    ...(env.basis !== 'prior_day' ? { basis: env.basis } : {}),
  };
  const filters = [...(bind.filters ?? []), ...extraFilters];
  const main: QueryRequest = {
    metric: bind.metric,
    ...(bind.dims?.length ? { dims: bind.dims } : {}),
    ...(filters.length ? { filters } : {}),
    ...(bind.window ? { window: bind.window } : {}),
    ...(Object.keys(params).length ? { params } : {}),
    ...at,
    ...(bind.max_cells !== undefined ? { max_cells: bind.max_cells } : {}),
  };

  const compare = bind.compare && bind.compare.vs !== 'prior_period'
    ? { metric: bind.compare.vs, ...(Object.keys(params).length ? { params } : {}), ...at }
    : null;

  // Bands ride the widget's own window so the reference covers the same days.
  const bands = (bind.bands ?? []).map((ref) => ({
    metric: ref,
    dims: ['as_of_date'],
    ...(bind.window ? { window: bind.window } : {}),
    ...(Object.keys(params).length ? { params } : {}),
    ...at,
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
  basis: Basis = 'prior_day',
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
        data.compare = {
          label: BASIS_LABEL[basis],
          value: main.prior,
          style: w.bind.compare.style,
        };
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
