/**
 * A group node — a row a source made for one grouping level (ADR-70) — in
 * a module of its own, so the column builders and the pivot can ask "is
 * this a node" without importing the SQL source that makes them.
 */

import type { Position } from './mock';

export interface GroupNode extends Position {
  __group: {
    column: keyof Position;
    value: string;
    /** The values of every grouping column down to this node, outermost first. */
    path: string[];
    depth: number;
    count: number;
  };
}

export const isGroupNode = (row: Position): row is GroupNode => '__group' in row;
