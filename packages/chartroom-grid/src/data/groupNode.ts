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

/**
 * A group's id in the view contract — "column:value" per level joined by
 * ">", as the client's grouped rows are named (`desk:Rates>legalEntity:WF-US`).
 * An engine-made node is named by its path instead (`g:Rates/WF-US`); an
 * agent, an export and a link speak the contract's id, and these translate.
 */
export const contractGroupId = (grouping: readonly string[], path: readonly string[]): string =>
  path.map((v, i) => `${grouping[i]}:${v}`).join('>');

/** The path a contract group id names, level by level. */
export const contractGroupPath = (id: string): string[] =>
  id.split('>').map((level) => level.slice(level.indexOf(':') + 1));
