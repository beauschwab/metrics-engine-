/**
 * The in-memory source: the whole book, served as-is.
 *
 * It applies nothing — filtering, sorting and grouping are the client row
 * models' — and says so in `applied`, which is the honest shape: a source
 * that claimed to filter and did not would leave the table showing rows the
 * view excluded. The one thing it does serve is `groupPath`, so lazy group
 * expansion has a reference implementation to test the remote one against.
 */

import { applyEdits, type CellEdit } from '../grid/edit';
import { distinctValues } from '../grid/pivot';
import type { ViewState } from '../grid/viewState';
import type { GridRecord, GridSchema } from '../grid/schema';
import { TREASURY_SCHEMA } from './treasury';
import type { DataSource, QueryOptions, QueryResult, SourceDescription } from './source';

export function inMemorySource<R extends GridRecord>(initial: R[], name = 'in-memory', schema: GridSchema = TREASURY_SCHEMA): DataSource<R> {
  // An edit (ADR-87) replaces the rows it names, so the next answer is a new
  // array and a reader of the previous one sees nothing change under it.
  let rows = initial;
  const first = rows[0];
  const description: SourceDescription = {
    name,
    asOf: typeof first?.asOf === 'string' ? first.asOf : null,
    rowCount: rows.length,
    columns: schema.order.map((id) => ({ id, meta: schema.columns[id]! })),
    rowId: schema.rowId,
    serves: { filter: false, sort: false, group: false, groupPath: true, window: false },
  };

  return {
    async describe() {
      return description;
    },
    // The in-memory source serves no filter: the client's facets already scope a set filter's list.
    async distinct(column: string) {
      return distinctValues(rows, column);
    },
    async update(edits: CellEdit[]) {
      for (const e of edits) {
        if (!schema.columns[e.columnId]) throw new RangeError(`inMemorySource: unknown column ${JSON.stringify(e.columnId)}`);
      }
      rows = applyEdits(rows, edits, schema.rowId);
    },
    async query(view: ViewState, { groupPath }: QueryOptions = {}): Promise<QueryResult<R>> {
      let out = rows;
      if (groupPath && groupPath.length) {
        if (groupPath.length > view.grouping.length) {
          throw new RangeError(
            `groupPath has ${groupPath.length} values but the view groups by ${view.grouping.length} column(s)`,
          );
        }
        const dims = view.grouping.slice(0, groupPath.length);
        out = rows.filter((r) => dims.every((dim, i) => String(r[dim]) === groupPath[i]));
      }
      return { rows: out, total: out.length, applied: { filter: false, sort: false, group: false } };
    },
  };
}
