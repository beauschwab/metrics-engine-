/**
 * The in-memory source: the whole book, served as-is.
 *
 * It applies nothing — filtering, sorting and grouping are the client row
 * models' — and says so in `applied`, which is the honest shape: a source
 * that claimed to filter and did not would leave the table showing rows the
 * view excluded. The one thing it does serve is `groupPath`, so lazy group
 * expansion has a reference implementation to test the remote one against.
 */

import { COLUMN_META, COLUMN_ORDER } from '../grid/columns';
import type { ViewState } from '../grid/viewState';
import type { Position } from './mock';
import type { DataSource, QueryOptions, QueryResult, SourceDescription } from './source';

export function inMemorySource(rows: Position[], name = 'in-memory'): DataSource<Position> {
  const description: SourceDescription = {
    name,
    asOf: rows[0]?.asOf ?? null,
    rowCount: rows.length,
    columns: COLUMN_ORDER.map((id) => ({ id, meta: COLUMN_META[id] })),
    serves: { filter: false, sort: false, group: false, groupPath: true },
  };

  return {
    async describe() {
      return description;
    },
    async query(view: ViewState, { groupPath }: QueryOptions = {}): Promise<QueryResult<Position>> {
      let out = rows;
      if (groupPath && groupPath.length) {
        if (groupPath.length > view.grouping.length) {
          throw new RangeError(
            `groupPath has ${groupPath.length} values but the view groups by ${view.grouping.length} column(s)`,
          );
        }
        const dims = view.grouping.slice(0, groupPath.length) as Array<keyof Position>;
        out = rows.filter((r) => dims.every((dim, i) => String(r[dim]) === groupPath[i]));
      }
      return { rows: out, total: out.length, applied: { filter: false, sort: false, group: false } };
    },
  };
}
