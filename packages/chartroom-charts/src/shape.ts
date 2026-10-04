/**
 * Widget data in the shapes Evil Charts reads (ADR-92). Pure, so the shaping
 * is tested without a renderer.
 *
 * Two things are decided here rather than in the components. Keys: an Evil
 * chart names a series's colour `--color-<key>-0`, and a group's value — `10Y+`,
 * `O/N`, `WF-US` — is not a CSS identifier, so every series and part is keyed
 * `s0`, `s1`, … and carries its value as its label. Colour: series take the
 * studio's series tokens in order (`--cr-s0` …), as every other chart on the
 * board does — the library's own palette never reaches the page (COL-03,
 * ADR-48).
 */

import type { WidgetInstance } from 'chartroom-spec';
import type { GroupRow, SeriesLine, WidgetData } from 'chartroom-widgets';

/** Evil Charts' `ChartConfig`, restated structurally so this module stays React-free. */
export type SeriesConfig = Record<string, { label: string; colors: { light: string[] } }>;

/** The studio's series token for the i-th series. */
export const seriesColor = (i: number) => `var(--cr-s${i % 8})`;

export interface Series {
  key: string;
  label: string;
}

/** An Evil Charts config for a list of series: one token each, the value as the label. */
export function configFor(series: Series[]): SeriesConfig {
  return Object.fromEntries(series.map((s, i) => [s.key, { label: s.label, colors: { light: [seriesColor(i)] } }]));
}

const distinct = (xs: string[]) => [...new Set(xs)];

/** A refusal the frame shows in place of a chart (ADR-44/45). */
export interface Refusal { refused: string }
export const isRefusal = (x: unknown): x is Refusal => typeof x === 'object' && x !== null && 'refused' in x;

/** The category name the rows are keyed by: the binding's first non-time dim. */
const categoryDims = (instance: WidgetInstance) => (instance.bind.dims ?? []).filter((d) => d !== 'as_of_date');

export interface CategoryTable {
  /** One row per category: `category` is its label, each series key its value. */
  rows: Array<Record<string, string | number>>;
  series: Series[];
  /** The category's raw key per row, for a pick. */
  keys: Array<Record<string, string>>;
}

/**
 * Rows keyed by one or two dims as a table across the first: one series, or
 * one per value of the second. Ordered as BAR-02 says — by the total, biggest
 * first, unless the binding sorts by the dimension, which keeps the order the
 * engine served (an ordinal ladder's own order).
 */
export function categoryTable(instance: WidgetInstance, data: WidgetData, across?: string, by?: string): CategoryTable {
  const dims = categoryDims(instance);
  const x = across ?? dims[0]!;
  const s = by ?? (dims.length > 1 ? dims.find((d) => d !== x) : undefined);
  const rows = data.rows ?? [];
  const cats = distinct(rows.map((r) => r.key[x] ?? ''));
  const seriesValues = s ? distinct(rows.map((r) => r.key[s] ?? '')) : [''];
  const series = seriesValues.map((v, i): Series => ({ key: `s${i}`, label: s ? v : (instance.title ?? 'value') }));
  const table = cats.map((c) => {
    const row: Record<string, string | number> = { category: c };
    for (const [i, v] of seriesValues.entries()) {
      const hit = rows.filter((r) => (r.key[x] ?? '') === c && (!s || (r.key[s] ?? '') === v));
      row[`s${i}`] = hit.reduce((t, r) => t + r.value, 0);
    }
    return row;
  });
  const sort = instance.bind.sort ?? (data.ordinalDim ? 'dim' : 'value');
  const total = (row: Record<string, string | number>) => series.reduce((t, k) => t + (row[k.key] as number), 0);
  const ordered = sort === 'dim' ? table : table.slice().sort((a, b) => total(b) - total(a));
  return { rows: ordered, series, keys: ordered.map((r) => ({ [x]: String(r.category) })) };
}

/** Today against the prior close per category, for the bar-and-line. */
export function priorTable(instance: WidgetInstance, data: WidgetData) {
  const x = categoryDims(instance)[0]!;
  const rows: GroupRow[] = data.rows ?? [];
  const sort = instance.bind.sort ?? (data.ordinalDim ? 'dim' : 'value');
  const ordered = sort === 'dim' ? rows.slice() : rows.slice().sort((a, b) => b.value - a.value);
  return ordered.map((r) => ({ category: r.key[x] ?? '', value: r.value, prior: r.prior }));
}

export interface TimeTable {
  rows: Array<Record<string, string | number | null>>;
  series: Series[];
}

/** Lines over the window as one row per date, a column per group; a missing day is a gap, not a zero. */
export function timeTable(instance: WidgetInstance, data: WidgetData): TimeTable {
  const lines: SeriesLine[] = data.series ?? [];
  const d = categoryDims(instance)[0];
  const series = lines.map((l, i): Series => ({ key: `s${i}`, label: d ? (l.key[d] ?? '') : (instance.title ?? 'value') }));
  const dates = [...new Set(lines.flatMap((l) => l.points.map((p) => p.date)))].sort();
  const at = lines.map((l) => new Map(l.points.map((p) => [p.date, p.value])));
  const rows = dates.map((date) => {
    const row: Record<string, string | number | null> = { date };
    at.forEach((m, i) => { row[`s${i}`] = m.get(date) ?? null; });
    return row;
  });
  return { rows, series };
}

/** A part cannot be negative: the first one that is, said, or nothing. */
function negativePart(parts: Array<{ label: string; value: number }>, what: string): Refusal | null {
  const neg = parts.find((p) => p.value < 0);
  return neg ? { refused: `${neg.label} is negative; a ${what} cannot draw a part below nothing` } : null;
}

export interface PartsTable {
  rows: Array<{ name: string; label: string; value: number }>;
  series: Series[];
}

/** Each category as a part, keyed safely, biggest first (pie, radial). */
export function partsTable(instance: WidgetInstance, data: WidgetData, what: string): PartsTable | Refusal {
  const x = categoryDims(instance)[0]!;
  const sums = new Map<string, number>();
  for (const r of data.rows ?? []) sums.set(r.key[x] ?? '', (sums.get(r.key[x] ?? '') ?? 0) + r.value);
  const parts = [...sums].map(([label, value]) => ({ label, value }));
  const neg = negativePart(parts, what);
  if (neg) return neg;
  const sort = instance.bind.sort ?? (data.ordinalDim ? 'dim' : 'value');
  const ordered = sort === 'dim' ? parts : parts.slice().sort((a, b) => b.value - a.value);
  const series = ordered.map((p, i): Series => ({ key: `s${i}`, label: p.label }));
  return { rows: ordered.map((p, i) => ({ name: `s${i}`, label: p.label, value: p.value })), series };
}

export interface FlowTable {
  nodes: Array<{ name: string }>;
  links: Array<{ source: number; target: number; value: number }>;
  series: Series[];
}

/**
 * From the first dim's values to the second's: a node per value on each side
 * that carries anything (keyed apart, so a value on both sides is two nodes),
 * a link per pair that does. A negative flow has no width to draw, so it refuses.
 */
export function flowTable(instance: WidgetInstance, data: WidgetData): FlowTable | Refusal {
  const [a, b] = categoryDims(instance) as [string, string | undefined];
  if (!b) return { refused: 'a flow runs between two dimensions; this binding has one' };
  const rows = data.rows ?? [];
  const neg = negativePart(rows.map((r) => ({ label: `${r.key[a]} → ${r.key[b]}`, value: r.value })), 'flow');
  if (neg) return neg;
  // Only pairs that carry something: a node with no flow has no height, and its label would sit on its neighbour's.
  const flowing = rows.filter((r) => r.value > 0);
  const from = distinct(flowing.map((r) => r.key[a] ?? ''));
  const to = distinct(flowing.map((r) => r.key[b] ?? ''));
  const series: Series[] = [
    ...from.map((v, i) => ({ key: `a${i}`, label: v })),
    ...to.map((v, i) => ({ key: `b${i}`, label: v })),
  ];
  const links = flowing
    .map((r) => ({ source: from.indexOf(r.key[a] ?? ''), target: from.length + to.indexOf(r.key[b] ?? ''), value: r.value }));
  return { nodes: series.map((s) => ({ name: s.key })), links, series };
}
