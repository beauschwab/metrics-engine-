/**
 * Tree mode (ADR-93): grouped rows read as one hierarchy in one column — the
 * group at every level, indented by depth, with its toggle and its count —
 * and the grouped dimensions leave the screen, since every value they would
 * show is already a node of the tree. AG Grid calls this the single group
 * column; the view calls it `groupDisplay: 'tree'`.
 *
 * The tree column is chrome, like the selection column: the table owns it,
 * the view never names it, and it carries no meta — so filters, formats,
 * aggregations and the header menu, which all key off meta, pass it by. What
 * reads a cell's text (copy, the chart, the export) asks `treeKey` instead.
 */

import type { ViewState } from './viewState';

export const TREE_ID = '__tree';

/** The tree column shows when the view asks for it and there is something to nest. */
export const treeShown = (view: Pick<ViewState, 'groupDisplay' | 'grouping'>): boolean =>
  view.groupDisplay === 'tree' && view.grouping.length > 0;

/** What a row is, structurally — a client group, a source's group node, or a leaf. */
export interface TreeRow {
  groupingColumnId?: string;
  groupingValue?: unknown;
  original?: unknown;
}

/**
 * The node a row is in the tree: the dimension it groups by and its value,
 * for a group the table made or one the source served (ADR-70); nothing for
 * a leaf, whose place in the tree is its parents'.
 */
export function treeKey(row: TreeRow): { column: string; value: string } | undefined {
  const node = (row.original as { __group?: { column: string; value: string } } | undefined)?.__group;
  if (node) return { column: node.column, value: node.value };
  if (row.groupingColumnId) return { column: row.groupingColumnId, value: String(row.groupingValue ?? '') };
  return undefined;
}

/**
 * The grouped dimensions hidden while the tree shows them: layered over the
 * view's own visibility, never written back into it — leaving tree mode
 * brings every column back exactly as the reader had it.
 */
export function treeVisibility(view: Pick<ViewState, 'groupDisplay' | 'grouping' | 'columnVisibility'>): Record<string, boolean> {
  if (!treeShown(view)) return view.columnVisibility;
  return { ...view.columnVisibility, ...Object.fromEntries(view.grouping.map((id) => [id, false])) };
}

/**
 * A visibility update from the table, back in the view's terms: the tree's
 * own hiding and the tree column are taken out, so a grouped dimension keeps
 * whatever visibility the reader gave it before the tree hid it.
 */
export function untreeVisibility(next: Record<string, boolean>, prev: ViewState): Record<string, boolean> {
  const out = { ...next };
  delete out[TREE_ID];
  if (!treeShown(prev)) return out;
  for (const id of prev.grouping) {
    if (id in prev.columnVisibility) out[id] = prev.columnVisibility[id]!;
    else delete out[id];
  }
  return out;
}

/** Width of the tree column: room for the deepest level's indent and a label. */
export const treeWidth = (levels: number): number => 200 + Math.max(0, levels - 1) * 14;

type Sorting = ViewState['sorting'];

/** How the tree header reads the sort: every grouped level one way, or none. */
export function treeSortDirection(sorting: Sorting, grouping: readonly string[]): 'asc' | 'desc' | false {
  const levels = grouping.map((id) => sorting.find((s) => s.id === id));
  if (levels.length === 0 || levels.some((s) => !s)) return false;
  const desc = levels[0]!.desc;
  return levels.every((s) => s!.desc === desc) ? (desc ? 'desc' : 'asc') : false;
}

/**
 * The tree header's click: every level ascending, then descending, then
 * unsorted — the groups at every depth by their own values, ahead of any
 * measure sort the reader already has, which keeps its place after them.
 */
export function toggleTreeSort(sorting: Sorting, grouping: readonly string[]): Sorting {
  const rest = sorting.filter((s) => !grouping.includes(s.id));
  const now = treeSortDirection(sorting, grouping);
  if (now === 'desc') return rest;
  return [...grouping.map((id) => ({ id, desc: now === 'asc' })), ...rest];
}
