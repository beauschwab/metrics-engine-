/**
 * From a grid selection to dashboard widgets (ADR-92). The grid says what the
 * reader selected — the dimension columns in the block and the values they
 * hold, the measure columns — and this says, for every kind in the gallery,
 * the widget instance that charts it, or why that kind cannot.
 *
 * The instance is a *binding*, not a snapshot: the grid widget's metric and
 * filters, the selected dimensions as dims, the selected values as an `in`
 * filter. A chart added to a dashboard is governed like every other tile —
 * re-evaluated at the board's as-of, linted, explained — and the preview the
 * reader picks from is that same instance, resolved the way the canvas will
 * resolve it.
 *
 * The planner refuses what the linter would block, with the linter's reason,
 * before the reader adds it: a stack of a measure that does not sum (AREA-01),
 * a part-to-whole over more than five parts (PIE-01). Refusing here is a
 * courtesy, not the gate — the gate is still the linter on the saved spec.
 */

import type { FilterExpr, WidgetInstance } from 'chartroom-spec';
import { CHART_KINDS, chartState, type ChartKindSpec } from './options';

/** A dimension column in the selected block, with the values the block holds, in its order. */
export interface SelectionDim {
  id: string;
  label: string;
  values: string[];
}

export interface ChartSelection {
  dims: SelectionDim[];
  /** Measure columns in the block; `computed` for a column calculated in the grid's view. */
  measures: Array<{ id: string; label: string; computed?: boolean }>;
}

/** What the planner needs to know about the metric — the registry contract, restated structurally. */
export interface PlanMetric {
  measure: string;
  format: string;
  allowed_aggregations?: string[];
  dims: Array<{ name: string; type: string; ordinal: boolean; values?: string[] }>;
}

export interface PlanInput {
  /** The grid widget the selection was made in. */
  source: WidgetInstance;
  metric: PlanMetric | undefined;
  selection: ChartSelection;
  /** The id and position the new widget takes on the canvas. */
  id: string;
  pos: WidgetInstance['pos'];
}

export type ChartCandidate =
  | { spec: ChartKindSpec; ok: true; instance: WidgetInstance; note?: string }
  | { spec: ChartKindSpec; ok: false; reason: string };

/** The grid widget's value column — the one measure a binding can carry. */
export const VALUE_COLUMN = 'value';
/** The window an over-time chart reads when the grid widget declares none. */
export const DEFAULT_WINDOW = { trailing: '30d' } as const;
/** The most lines one over-time chart draws (TS-02's default ceiling). */
export const MAX_LINES = 8;
/** The spec's ceiling on a binding's filters. */
const MAX_FILTERS = 8;
/** PIE-01's ceiling, restated: past five parts, a part-to-whole is unreadable. */
export const MAX_PARTS = 5;

/** AREA-01's judgment, restated: a stack is a claim the parts add to the whole. */
const SIGNED_NAME = /(^|_)(delta|change|move|variance|net_change|pnl|swing)(_|$)/;
export function stackRefusal(metric: PlanMetric): string | null {
  if (!(metric.allowed_aggregations ?? []).includes('sum')) {
    return `${metric.measure} does not add up by sum, so parts of it make no whole (AREA-01)`;
  }
  if (SIGNED_NAME.test(metric.measure) || metric.format === 'bps') {
    return `${metric.measure} can go negative, and a negative part overlaps the rest (AREA-01)`;
  }
  return null;
}

/** PIE-01 counts the dimension's values in the registry, not the selection's — say so. */
function partsRefusal(metric: PlanMetric, dim: SelectionDim): string | null {
  const contract = metric.dims.find((d) => d.name === dim.id);
  const n = contract?.values?.length;
  if (n !== undefined && n > MAX_PARTS) {
    return `${dim.label} has ${n} values; a part-to-whole over more than ${MAX_PARTS} is unreadable (PIE-01)`;
  }
  if (dim.values.length > MAX_PARTS) {
    return `the selection holds ${dim.values.length} ${dim.label} values; a part-to-whole reads ${MAX_PARTS} at most (PIE-01)`;
  }
  return null;
}

const sortFor = (metric: PlanMetric, dim: string): 'value' | 'dim' =>
  metric.dims.find((d) => d.name === dim)?.ordinal ? 'dim' : 'value';

const defaults = (spec: ChartKindSpec) => Object.fromEntries(spec.options.map((o) => [o.key, o.default]));

/**
 * Every kind in the gallery, planned for this selection: an instance to add,
 * or the reason it cannot be one.
 */
export function planCharts({ source, metric, selection, id, pos }: PlanInput): ChartCandidate[] {
  const refuseAll = (reason: string) => CHART_KINDS.map((spec): ChartCandidate => ({ spec, ok: false, reason }));
  if (!metric) return refuseAll(`${source.bind.metric} is not in the registry, so nothing can be bound to it`);

  // The measure: the metric's own value. A calculated column lives in the
  // grid's view, not in the registry, so a dashboard cannot bind it.
  const value = selection.measures.find((m) => m.id === VALUE_COLUMN);
  if (!value) {
    const computed = selection.measures.find((m) => m.computed);
    return refuseAll(computed
      ? `${computed.label} is calculated in this grid’s view; only the metric’s own value can go on the dashboard — include the value column`
      : 'include the value column to size the chart');
  }
  const extra = selection.measures.filter((m) => m.id !== VALUE_COLUMN);

  // The dimensions: those the binding has, in the order the block shows them.
  const bound = new Set((source.bind.dims ?? []).filter((d) => d !== 'as_of_date'));
  const dims = selection.dims.filter((d) => bound.has(d.id) && d.values.length > 0);
  if (dims.length === 0) return refuseAll('include a dimension column, or group rows, to name the groups');
  const [d0, d1] = dims as [SelectionDim, SelectionDim | undefined];
  const timeDim = metric.dims.find((d) => d.type === 'time')?.name;

  // The selected values narrow the binding; a value list naming every value the dimension has narrows nothing.
  const narrow = (ds: SelectionDim[]): FilterExpr[] => ds.flatMap((d): FilterExpr[] => {
    const all = metric.dims.find((c) => c.name === d.id)?.values;
    if (all && all.length > 0 && all.every((v) => d.values.includes(v))) return [];
    return [{ dim: d.id, op: 'in', value: d.values }];
  });
  const base = source.bind.filters ?? [];

  const make = (spec: ChartKindSpec, use: SelectionDim[], bindDims: string[], extraBind: Partial<WidgetInstance['bind']> = {}): WidgetInstance => {
    const filters = [...base, ...narrow(use)];
    const title = `${metric.measure} by ${use.map((d) => d.label).join(' and ')}`;
    return {
      id, type: spec.type, title: title.slice(0, 80), pos,
      bind: {
        metric: source.bind.metric,
        dims: bindDims,
        ...(filters.length ? { filters } : {}),
        ...extraBind,
      },
      state: chartState(defaults(spec)),
    };
  };
  const unused = (use: SelectionDim[]) => {
    const left = dims.filter((d) => !use.includes(d)).map((d) => d.label);
    const notes = [
      ...(left.length ? [`${left.join(' and ')} ${left.length > 1 ? 'are' : 'is'} folded into each group by the metric’s own aggregation, over the selected values`] : []),
      ...(extra.length ? [`${extra.map((m) => m.label).join(', ')} stay${extra.length > 1 ? '' : 's'} in the grid — the chart draws the metric’s value`] : []),
    ];
    return notes.length ? { note: notes.join('; ') } : {};
  };

  return CHART_KINDS.map((spec): ChartCandidate => {
    const no = (reason: string): ChartCandidate => ({ spec, ok: false, reason });
    const yes = (instance: WidgetInstance, use: SelectionDim[]): ChartCandidate =>
      ((instance.bind.filters?.length ?? 0) > MAX_FILTERS
        ? no(`the grid’s filters and the selection make ${instance.bind.filters!.length} filters; a binding carries ${MAX_FILTERS}`)
        : { spec, ok: true, instance, ...unused(use) });

    switch (spec.shape) {
      case 'category': {
        if (spec.kind === 'evil-pie') {
          const why = stackRefusal(metric) ?? partsRefusal(metric, d0);
          if (why) return no(why);
        }
        if (spec.kind === 'evil-radar' && d0.values.length < 3) return no(`a radar needs three spokes or more; the selection holds ${d0.values.length} ${d0.label} value${d0.values.length === 1 ? '' : 's'}`);
        if (spec.series !== 'none' && d1) {
          if (d1.values.length > MAX_LINES) return no(`${d1.values.length} ${d1.label} values would be ${d1.values.length} series; select ${MAX_LINES} or fewer`);
          return yes(make(spec, [d0, d1], [d0.id, d1.id], { sort: sortFor(metric, d0.id) }), [d0, d1]);
        }
        return yes(make(spec, [d0], [d0.id], { sort: sortFor(metric, d0.id) }), [d0]);
      }
      case 'category-series': {
        if (!d1) return no('select a second dimension column to stack by');
        const why = stackRefusal(metric);
        if (why) return no(why);
        // The parts: the second dimension, or the first when only it is few enough to read (PIE-01).
        const [parts, axis] = !partsRefusal(metric, d1) ? [d1, d0] : !partsRefusal(metric, d0) ? [d0, d1] : [null, null];
        if (!parts || !axis) return no(partsRefusal(metric, d1)!);
        // The parts lead the dims: PIE-01 counts the first categorical dimension, and the parts are what it judges.
        // The axis keeps its own order: a maturity ladder stays a ladder, whatever the parts are (BAR-02's rule).
        return yes(make(spec, [axis, parts], [parts.id, axis.id], { sort: sortFor(metric, axis.id) }), [d0, d1]);
      }
      case 'over-time': {
        if (!timeDim) return no(`${metric.measure} has no time dimension to draw a line over`);
        if (d0.values.length > MAX_LINES) return no(`${d0.values.length} ${d0.label} values would be ${d0.values.length} lines; select ${MAX_LINES} or fewer rows`);
        if (spec.kind === 'evil-stacked-area') {
          const why = stackRefusal(metric) ?? partsRefusal(metric, d0);
          if (why) return no(why);
        }
        return yes(make(spec, [d0], [timeDim, d0.id], { window: source.bind.window ?? { ...DEFAULT_WINDOW } }), [d0]);
      }
      case 'flow': {
        if (!d1) return no('select two dimension columns — the flow runs from the first to the second');
        const why = stackRefusal(metric);
        if (why) return no(why);
        // PIE-01 judges the first dimension: the flow runs from whichever side is few enough to read.
        const [source, target] = !partsRefusal(metric, d0) ? [d0, d1] : !partsRefusal(metric, d1) ? [d1, d0] : [null, null];
        if (!source || !target) return no(partsRefusal(metric, d0)!);
        return yes(make(spec, [source, target], [source.id, target.id]), [d0, d1]);
      }
    }
  });
}
