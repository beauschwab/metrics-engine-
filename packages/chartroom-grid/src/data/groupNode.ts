/**
 * A group node — a row a source made for one grouping level (ADR-70) — in
 * a module of its own, so the column builders and the pivot can ask "is
 * this a node" without importing the SQL source that makes them.
 */

import type { GridRecord } from '../grid/schema';

export interface GroupNode extends GridRecord {
  __group: {
    column: string;
    value: string;
    /** The values of every grouping column down to this node, outermost first. */
    path: string[];
    depth: number;
    count: number;
  };
}

export const isGroupNode = (row: unknown): row is GroupNode => typeof row === 'object' && row !== null && '__group' in row;
