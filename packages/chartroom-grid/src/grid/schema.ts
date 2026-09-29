/**
 * The grid's schema (ADR-82): the columns a source serves, their meta, and
 * the column that identifies a row. Phase 0 declared one fixed book of
 * treasury positions; the schema makes that one instance of many, so the
 * same grid — the same view contract, the same SQL compiler, the same agent
 * tools — can sit over a registry metric's groups in the dashboard builder
 * as over a position book in the harness. Every function that used to read
 * the treasury columns reads a schema now, and the treasury schema is the
 * default so nothing that spoke to the grid before has to change.
 */

import type { ColumnMeta } from './meta';

/** A row the grid renders: fields by column id. */
export type GridRecord = Record<string, unknown>;

export interface GridSchema {
  /** Meta by column id — the single source of every column's behaviour (ADR-64). */
  columns: Record<string, ColumnMeta>;
  /** Display order: the dimensions a reader scans by, then the measures. */
  order: string[];
  /** The column whose value identifies a row. */
  rowId: string;
}

/** A schema from a source's description: columns in the order described. */
export function schemaFromColumns(columns: ReadonlyArray<{ id: string; meta: ColumnMeta }>, rowId: string): GridSchema {
  const out: Record<string, ColumnMeta> = {};
  for (const c of columns) out[c.id] = c.meta;
  if (!(rowId in out)) throw new RangeError(`schema: rowId names no column: ${rowId}`);
  return { columns: out, order: columns.map((c) => c.id), rowId };
}

/** A schema from what a source describes (ADR-82): its columns, and the row id it names or the first column. */
export function schemaFromDescription(about: { columns: ReadonlyArray<{ id: string; meta: ColumnMeta }>; rowId?: string }): GridSchema {
  return schemaFromColumns(about.columns, about.rowId ?? about.columns[0]?.id ?? '');
}

/** The measures of a schema, in order. */
export const measuresOf = (schema: GridSchema): string[] => schema.order.filter((id) => schema.columns[id]?.kind === 'measure');

/** The ids a schema declares, as a set for the checks that must refuse anything else. */
const idSets = new WeakMap<GridSchema, ReadonlySet<string>>();
export function idsOf(schema: GridSchema): ReadonlySet<string> {
  let s = idSets.get(schema);
  if (!s) { s = new Set(schema.order); idSets.set(schema, s); }
  return s;
}
