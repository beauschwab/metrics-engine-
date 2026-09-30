/**
 * The data seam — the one boundary a query crosses (ADR-64, ADR-66).
 *
 * A source describes itself and answers a view. No SQL crosses this line:
 * the caller hands over the validated view state, and the source decides
 * how to serve it — an in-memory source returns everything and lets the
 * client row models do the work; a DuckDB or Dremio source compiles the
 * view and returns what the view asked for. `applied` says which of the
 * three the source already did, so the table can flip its `manual*` modes
 * from the answer rather than from configuration — TODO(grid-phase-5).
 *
 * `groupPath` is the lazy-expansion hook: the rows under one group node,
 * addressed by the values of the view's grouping columns in order.
 */

import type { CellEdit } from '../grid/edit';
import type { ColumnMeta } from '../grid/meta';
import type { ViewState } from '../grid/viewState';

export interface SourceColumn {
  id: string;
  meta: ColumnMeta;
}

export interface SourceDescription {
  /** A name for the status bar and the agent's `describe_view` (Phase 4). */
  name: string;
  /** The book's as-of date, or null when the source has no single one. */
  asOf: string | null;
  rowCount: number;
  columns: SourceColumn[];
  /**
   * What this source will do server-side when asked. `window`: it answers a
   * leaf query one window of rows at a time, with the total and the grand
   * totals over everything the view matches (ADR-85).
   */
  serves: { filter: boolean; sort: boolean; group: boolean; groupPath: boolean; window?: boolean };
  /** The column whose value identifies a row (ADR-82); `tradeId` for a position book. */
  rowId?: string;
}

export interface QueryOptions {
  /** The rows under one group node: values for `view.grouping[0..n]`, in order. */
  groupPath?: string[];
  /** A window of the leaf rows the view matches, in the view's order (ADR-85); a source that serves it answers only these. */
  window?: { offset: number; limit: number };
  /** Also answer the grand totals over every row the view matches — each measure by its aggregation, pivot buckets included. */
  totals?: boolean;
}

export interface QueryResult<Row> {
  rows: Row[];
  /** Rows the view matches in total, whether or not all of them were returned. */
  total: number;
  /** Which stages the source already applied; the rest are the client's. */
  applied: { filter: boolean; sort: boolean; group: boolean; window?: boolean };
  /** Where the answered rows start in the view's order, when a window was served. */
  offset?: number;
  /** The grand totals asked for, keyed by column id — a measure's aggregate, a pivot column's within its bucket. */
  totals?: Record<string, number>;
}

export interface DataSource<Row> {
  describe(): Promise<SourceDescription>;
  query(view: ViewState, options?: QueryOptions): Promise<QueryResult<Row>>;
  /** The distinct values of a dimension over the whole source, in reading order — the pivot's columns (ADR-80). */
  distinct?(column: string): Promise<string[]>;
  /** Write committed edits back (ADR-87): a host that grants editing may hand the grid's commits straight here. */
  update?(edits: CellEdit[]): Promise<void>;
}
