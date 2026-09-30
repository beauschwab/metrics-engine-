/**
 * Ordinal dimensions (ADR-84): a string column whose values carry an
 * implied order — tenor buckets, maturity ladders, ratings — that a lexical
 * sort scrambles ("10Y+" before "1M"). The meta declares the order once,
 * as `order: [...]`, and every reader of the column follows it: the sort,
 * the SQL the source runs, the set filter's list, the pivot's columns.
 *
 * A value the list does not name is not an error: it sorts after every
 * named value, alphanumerically among its kind, so a new bucket the data
 * grew appears at the end rather than nowhere.
 */

import { sortFn_alphanumeric, type Row } from '@tanstack/table-core';

const text = (v: unknown): string => (v === undefined || v === null ? '' : String(v));

/** The value's position in the order, or the list's length when it is not named. */
export function ordinalRank(order: readonly string[], value: unknown): number {
  const i = order.indexOf(text(value));
  return i < 0 ? order.length : i;
}

/** A comparator over the order: named values by position, the rest after, alphanumerically. */
export function compareByOrder(order: readonly string[]): (a: unknown, b: unknown) => number {
  return (a, b) => {
    const ra = ordinalRank(order, a);
    const rb = ordinalRank(order, b);
    if (ra !== rb) return ra - rb;
    return ra < order.length ? 0 : text(a).localeCompare(text(b), 'en', { numeric: true });
  };
}

/** The values in the order, unnamed ones last; without an order, as given. */
export function sortByOrder(values: readonly string[], order?: readonly string[]): string[] {
  if (!order) return [...values];
  return [...values].sort(compareByOrder(order));
}

/** The values a column's rows hold, in the order the rows first show them — a served ladder's own order. */
export function orderFromRows(rows: ReadonlyArray<Record<string, unknown>>, column: string): string[] {
  const seen = new Set<string>();
  for (const r of rows) {
    const v = r[column];
    if (v !== undefined && v !== null && v !== '') seen.add(String(v));
  }
  return [...seen];
}

/**
 * The table's `ordinal` sort: reads the column's `meta.order` from the row's
 * own table, so the column definition stays a name, not a closure, and a
 * column without an order falls back to the alphanumeric sort.
 */
export function ordinalSortFn(rowA: Row<any, any>, rowB: Row<any, any>, columnId: string): number {
  const order = (rowA.table.getColumn(columnId)?.columnDef.meta as { order?: readonly string[] } | undefined)?.order;
  if (!order) return sortFn_alphanumeric(rowA, rowB, columnId);
  return compareByOrder(order)(rowA.getValue(columnId), rowB.getValue(columnId));
}
