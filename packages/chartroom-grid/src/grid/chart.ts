/**
 * A chart from a range (ADR-81). The grid does not draw: it reads the
 * selected block through the same resolver the copier uses (ADR-71) and
 * describes a widget the host can render with the governed renderers —
 * the type, the resolved data in the widgets' own shape, and a title.
 * The shapes below are the widgets' contract restated structurally, so
 * this module stays React-free and the boundary rule holds.
 */

import type { ColumnMeta } from './meta';
import { aggregateMeta, formatValue } from './meta';
import { selectedCellRanges, type CopyCell, type CopyTable } from './copy';
import { aggregatedNumber } from './aggregations';

/** One bar: the category value and the measure, as the widgets read rows. */
export interface ChartRow {
  key: Record<string, string>;
  value: number;
  prior: number;
}

/** The widgets' resolved data, restated. */
export interface ChartData {
  unit: string;
  format: string;
  asOf: string;
  rows: ChartRow[];
  ordinalDim: boolean;
}

export interface ChartSeries {
  columnId: string;
  label: string;
  data: ChartData;
}

export interface ChartRequest {
  /** The widget type the host should render each series with. */
  type: 'bar@1';
  title: string;
  /** The dimension across the bars. */
  category: { columnId: string; label: string };
  series: ChartSeries[];
}

export type ChartOutcome = { ok: true; request: ChartRequest } | { ok: false; reason: string };

/** The widget catalog's format id for a measure's meta — the same function the cell formats through (ADR-29). */
export function widgetFormat(meta: ColumnMeta): { unit: string; format: string } {
  switch (meta.unit) {
    case 'ccy': return { unit: 'USD', format: 'currency_usd' };
    case 'mm': return { unit: 'USD', format: 'currency_usd_mm' };
    case 'pct': return { unit: '%', format: `percent_${meta.dp ?? 2}dp` };
    case 'bps': return { unit: 'bps', format: 'bps' };
    case 'years': return { unit: 'years', format: 'number' };
    default: return { unit: '', format: 'number' };
  }
}

interface ResolvedCell { cell: CopyCell; meta: ColumnMeta | undefined }

/** The category text of a cell: a group row's value, or a dimension's text. */
function categoryOf(cell: CopyCell): string | undefined {
  const node = cell.row.original as { __group?: { column: string; value: string } } | undefined;
  if (cell.getIsGrouped()) return String(cell.row.groupingValue ?? '');
  if (node?.__group && node.__group.column === cell.column.id) return node.__group.value;
  if (cell.getIsPlaceholder()) return undefined;
  const v = cell.getValue();
  return v === undefined || v === null ? undefined : String(v);
}

function measureOf(cell: CopyCell): number | undefined {
  if (cell.getIsPlaceholder()) return undefined;
  const v = cell.getIsAggregated() ? aggregatedNumber(cell.getValue()) : cell.getValue();
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

/**
 * Describe a chart for the selected block, or say why it cannot be one:
 * the first dimension column (or the group column on group rows) is the
 * category, every measure column a series, and every measure must share a
 * unit — a bar chart has one axis (NUM-01).
 */
export function chartFromRange(table: CopyTable, asOf = ''): ChartOutcome {
  const ranges = selectedCellRanges(table);
  if (ranges.length === 0) return { ok: false, reason: 'select a block of cells first' };
  if (ranges.length > 1) return { ok: false, reason: 'chart one block at a time' };
  const rows = ranges[0]!;
  const first = rows[0];
  if (!first || first.length === 0) return { ok: false, reason: 'select a block of cells first' };
  const columns = first.map((c): ResolvedCell => ({ cell: c, meta: c.column.columnDef.meta }));
  // The category: the first column that reads as a dimension in this block.
  const categoryIndex = columns.findIndex(({ cell, meta }) => (meta && meta.kind === 'dimension') || cell.getIsGrouped() || cell.column.id === (cell.row.original as { __group?: { column: string } })?.__group?.column);
  if (categoryIndex < 0) return { ok: false, reason: 'include a dimension column, or group rows, to name the bars' };
  const measures = columns.map((c, i) => ({ ...c, i })).filter(({ meta, i }) => i !== categoryIndex && meta?.kind === 'measure');
  if (measures.length === 0) return { ok: false, reason: 'include a measure column to size the bars' };
  const units = new Set(measures.map(({ meta }) => widgetFormat(meta!).unit));
  if (units.size > 1) return { ok: false, reason: `the block mixes units (${[...units].join(', ')}); a bar chart has one axis (NUM-01)` };

  const categoryColumn = columns[categoryIndex]!.cell.column;
  const categoryLabel = categoryColumn.columnDef.meta?.label ?? categoryColumn.id;
  const series: ChartSeries[] = measures.map(({ cell, meta, i }) => {
    const agg = cell.column.columnDef.aggregationFn;
    const out: ChartRow[] = [];
    const seen = new Map<string, number>();
    // A grid `bps` column holds basis points; the catalog's `bps` format holds a
    // percent and multiplies as it renders (ADR-74), so the chart is handed the percent.
    const toCatalog = meta!.unit === 'bps' ? 0.01 : 1;
    for (const row of rows) {
      const category = categoryOf(row[categoryIndex]!);
      const measured = measureOf(row[i]!);
      // A count or distinct count is a number of rows, not basis points: it is never rescaled.
      const counted = row[i]!.getIsAggregated() && (agg === 'count' || agg === 'uniqueCount');
      const value = measured === undefined ? undefined : measured * (counted ? 1 : toCatalog);
      if (category === undefined || value === undefined) continue;
      // Two rows with one label (a repeated desk) would draw one bar over another: number them.
      const n = (seen.get(category) ?? 0) + 1;
      seen.set(category, n);
      out.push({ key: { [categoryColumn.id]: n > 1 ? `${category} (${n})` : category }, value, prior: value });
    }
    const readMeta = rows.some((r) => r[i]!.getIsAggregated()) ? aggregateMeta(meta!, agg) : meta!;
    const label = meta!.computed ? `${meta!.label} (calculated)` : meta!.label;
    return { columnId: cell.column.id, label, data: { ...widgetFormat(readMeta), asOf, rows: out, ordinalDim: true } };
  });
  const title = `${series.map((s) => s.label).join(', ')} by ${categoryLabel}`;
  return { ok: true, request: { type: 'bar@1', title, category: { columnId: categoryColumn.id, label: categoryLabel }, series } };
}

/** A one-line reading of a request, for the panel's caption and the tests. */
export function describeChart(request: ChartRequest): string {
  const bars = request.series[0]?.data.rows.length ?? 0;
  return `${request.title} · ${bars} bar${bars === 1 ? '' : 's'} · ${request.series.map((s) => `${s.label}: ${s.data.rows.map((r) => formatValue(r.value, { label: s.label, kind: 'measure' })).length}`).length} series`;
}
