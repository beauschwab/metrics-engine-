/**
 * The treasury columns — each one a field plus its meta, nothing else.
 *
 * Every behaviour the grid grows later (grouping, aggregation, heatmaps, the
 * xlsx number format) is a reading of the meta declared here. A column with
 * no `groupable` never appears in the group-by drop zone; a measure with no
 * `agg` shows blank on a subtotal row rather than a sum that means nothing.
 */

import { createColumnHelper } from '@tanstack/table-core';
import type { Features } from './features';
import { AGGS, FORMAT_KEYS, isScalable, type Agg, type ColumnFormat, type ColumnMeta } from './meta';
import { computedAggregation, computedMeta, computedValue, isComputedId, type ComputedColumn } from './computed';
import { sortByOrder } from './ordinal';
import { pivotAggregation, pivotId, pivotMeta, pivotValue, type PivotState } from './pivot';
import { TREASURY_META, TREASURY_ORDER, TREASURY_SCHEMA } from '../data/treasury';
import { idsOf, measuresOf, type GridRecord, type GridSchema } from './schema';

const helper = createColumnHelper<Features, GridRecord>();

/** The treasury book's columns (ADR-64) — the default schema, kept under their first names. */
export const COLUMN_META = TREASURY_META;
export const COLUMN_ORDER = TREASURY_ORDER;

/**
 * The selection column: structural, not a field, so it lives beside the
 * data columns rather than in `COLUMN_META` — the view never names it (it
 * cannot be hidden, ordered, grouped, pinned or sized), and the hook pins
 * it at the start (ADR-68). Its cell is the checkbox `GridTable` renders.
 */
export const SELECT_ID = 'select';
export const selectColumn = helper.display({
  id: SELECT_ID,
  header: '',
  size: 32,
  enableSorting: false,
  enableGrouping: false,
  enableHiding: false,
  enableResizing: false,
  enablePinning: false,
});

/** A view's per-column aggregation overrides (ADR-72). */
export type ColumnAggs = Partial<Record<string, Agg>>;

/** The aggregation a measure takes: the view's choice, else the meta's. */
export function effectiveAgg(id: string, aggs?: ColumnAggs, schema: GridSchema = TREASURY_SCHEMA): Agg | undefined {
  const meta = schema.columns[id];
  if (!meta || meta.kind !== 'measure') return undefined;
  return aggs?.[id] ?? meta.agg;
}

/** The aggregations a measure may take: `wavg` only where the meta names a weight. */
export function allowedAggs(id: string, schema: GridSchema = TREASURY_SCHEMA): Agg[] {
  const meta = schema.columns[id];
  if (!meta || meta.kind !== 'measure') return [];
  return AGGS.filter((a) => a !== 'wavg' || !!meta.weightBy);
}

export type ColumnFormats = Partial<Record<string, ColumnFormat>>;

/** The treasury schema's column ids, for the checks that must refuse anything else. */
export const REGISTRY_IDS: ReadonlySet<string> = idsOf(TREASURY_SCHEMA);

/**
 * The declared meta of any column the view can name: a schema column's,
 * or a calculated column's derived from its operands (ADR-79).
 */
export function metaFor(id: string, computed: readonly ComputedColumn[] = [], schema: GridSchema = TREASURY_SCHEMA): ColumnMeta | undefined {
  if (!isComputedId(id)) return schema.columns[id];
  const spec = computed.find((c) => c.id === id);
  return spec ? computedMeta(spec, (op) => schema.columns[op]) : undefined;
}

/** The format keys a meta can take: a measure's readings, a dollar column's scale (ADR-74). */
export function allowedFormatKeysFor(meta: ColumnMeta | undefined): readonly (keyof ColumnFormat)[] {
  if (!meta || meta.kind !== 'measure') return [];
  return FORMAT_KEYS.filter((k) => k !== 'scale' || isScalable(meta));
}

/** The format keys a column can take, by id; a calculated column's need its definition. */
export function allowedFormatKeys(id: string, computed: readonly ComputedColumn[] = [], schema: GridSchema = TREASURY_SCHEMA): readonly (keyof ColumnFormat)[] {
  return allowedFormatKeysFor(metaFor(id, computed, schema));
}

/**
 * The meta a column carries for a view: the declared meta with the view's
 * format on top, so every reader — cell, footer, copy, export — formats
 * through the same object and never asks who chose what.
 */
export function effectiveMeta(id: string, formats?: ColumnFormats, computed: readonly ComputedColumn[] = [], schema: GridSchema = TREASURY_SCHEMA): ColumnMeta {
  const meta = metaFor(id, computed, schema);
  if (!meta) throw new RangeError(`unknown column: ${id}`);
  const format = formats?.[id];
  if (!format) return meta;
  const keys = allowedFormatKeysFor(meta).filter((k) => format[k] !== undefined);
  if (keys.length === 0) return meta;
  const out: ColumnMeta = { ...meta };
  for (const k of keys) (out as unknown as Record<string, unknown>)[k] = format[k];
  return out;
}

/**
 * The column definitions for a view: the same columns, the view's
 * aggregations and formats, and the view's calculated columns after them
 * (ADR-79) — each a real column with its own accessor, meta and roll-up.
 */
/** The pivot a table is built with: the view's slice plus the values the data holds (ADR-80). */
export interface PivotBuild extends PivotState {
  distinct: readonly string[];
}

/** The measures a pivot spreads: the named ones, else every measure. */
export function pivotMeasures(pivot: PivotState | undefined, schema: GridSchema = TREASURY_SCHEMA): string[] {
  if (!pivot?.column) return [];
  const measures = measuresOf(schema);
  return pivot.values.length ? measures.filter((id) => pivot.values.includes(id)) : measures;
}

export function buildColumns(aggs: ColumnAggs = {}, formats: ColumnFormats = {}, computed: readonly ComputedColumn[] = [], pivot?: PivotBuild, schema: GridSchema = TREASURY_SCHEMA) {
  const pivoted = pivot?.column ? pivotMeasures(pivot, schema) : [];
  // The buckets read in the dimension's own order where it has one (ADR-84).
  const buckets = pivot?.column ? sortByOrder(pivot.distinct, schema.columns[pivot.column]?.order) : [];
  const pivotColumns = pivot?.column
    ? buckets.flatMap((value) =>
      pivoted.flatMap((m) => {
        const meta = effectiveMeta(m, formats, [], schema);
        const agg = effectiveAgg(m, aggs, schema);
        if (!agg) return [];
        return [
          helper.accessor((row) => pivotValue(row, pivot.column!, m, value), {
            id: pivotId(m, value),
            header: meta.label,
            meta: pivotMeta(meta, value),
            size: meta.width,
            enableGrouping: false,
            enableColumnFilter: false,
            aggregationFn: pivotAggregation(agg, m, meta.weightBy, pivot.column!, value),
            sortFn: 'basic',
            // Rows outside the bucket have no value: they sort last either way.
            sortUndefined: 'last',
          }),
        ];
      }))
    : [];
  const derived = computed.flatMap((spec) => {
    const meta = metaFor(spec.id, computed, schema);
    if (!meta) return [];
    return [
      helper.accessor((row) => computedValue(spec, row), {
        id: spec.id,
        header: spec.label,
        meta: effectiveMeta(spec.id, formats, computed, schema),
        size: meta.width,
        enableGrouping: false,
        aggregationFn: computedAggregation(spec),
        filterFn: 'inNumberRange',
        sortFn: 'basic',
        sortUndefined: 'last',
      }),
    ];
  });
  // Pivoted measures follow the buckets under a Total band; the rest keep their place.
  const base = pivot?.column ? schema.order.filter((id) => !pivoted.includes(id)) : schema.order;
  const totals = pivot?.column ? pivoted : [];
  const registry = (id: string, band?: string) => {
      const meta = band ? { ...effectiveMeta(id, formats, [], schema), band } : effectiveMeta(id, formats, [], schema);
      return helper.accessor((row) => row[id], {
        id,
        header: meta.label,
        meta,
        size: meta.width,
        enableGrouping: meta.kind === 'dimension' && !!meta.groupable,
        // Every aggregation the meta or the view names is registered (`wavg`
        // since Phase 2, ADR-67); a measure without one leaves a subtotal
        // blank — ADR-44.
        aggregationFn: effectiveAgg(id, aggs, schema),
        // A dimension filters as a set ("value is one of these"); a measure as
        // an inclusive range with open ends. Both read the meta's kind, not a
        // per-feature list — the set filter and the number filter (Phase 3)
        // are the UI over these.
        filterFn: meta.kind === 'dimension' ? 'arrHas' : 'inNumberRange',
        // Measures sort numerically — a grouped row's aggregate is a Number
        // object (ADR-67), which `basic` compares by value. A dimension with
        // an implied order sorts by it (ADR-84).
        sortFn: meta.kind === 'measure' ? 'basic' : meta.order ? 'ordinal' : 'alphanumeric',
      });
  };
  return helper.columns([
    ...base.map((id) => registry(id)),
    ...pivotColumns,
    ...totals.map((id) => registry(id, 'Total')),
    ...derived,
  ]);
}

/** The columns with the meta's own aggregations. */
export const columns = buildColumns();
