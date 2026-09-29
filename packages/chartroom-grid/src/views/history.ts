/**
 * Undo and redo over the view (ADR-76). The view is one JSON object and
 * every change to it — a sort, a group, a filter, a format, a saved view
 * loaded, a link followed — arrives as a new object, so history is a stack
 * of views and nothing else: no per-feature inverse operations, no
 * knowledge of what changed. Undo hands the previous view back through the
 * same `onViewChange` every other write uses.
 *
 * Two readings keep the stack honest. A change that leaves the view equal
 * is not a step. A run of column resizes — one write per pointer move — is
 * one step: a sizing-only change within the coalescing window replaces the
 * present instead of pushing it, so Ctrl+Z undoes the drag, not one pixel.
 */

export interface ViewHistory<V> {
  past: V[];
  present: V;
  future: V[];
  /** When the present was pushed, for coalescing. */
  at: number;
  /** Whether the present arrived as a sizing-only change. */
  sizingOnly: boolean;
}

export interface HistoryOptions {
  /** Steps kept behind the present. */
  limit?: number;
  /** Milliseconds within which consecutive sizing-only changes coalesce. */
  coalesceMs?: number;
}

const DEFAULTS: Required<HistoryOptions> = { limit: 100, coalesceMs: 600 };

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** Whether two views differ only in `columnSizing`. */
export function sizingOnlyChange(a: Record<string, unknown>, b: Record<string, unknown>): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  let differs = false;
  for (const k of keys) {
    if (same(a[k], b[k])) continue;
    if (k !== 'columnSizing') return false;
    differs = true;
  }
  return differs;
}

export function createHistory<V>(present: V, now = Date.now()): ViewHistory<V> {
  return { past: [], present, future: [], at: now, sizingOnly: false };
}

/** Record a new present; a no-op when nothing changed, a replacement when a resize continues. */
export function pushHistory<V extends Record<string, unknown>>(h: ViewHistory<V>, next: V, options: HistoryOptions = {}, now = Date.now()): ViewHistory<V> {
  const { limit, coalesceMs } = { ...DEFAULTS, ...options };
  if (same(h.present, next)) return h;
  const sizing = sizingOnlyChange(h.present, next);
  if (sizing && h.sizingOnly && now - h.at <= coalesceMs) {
    return { ...h, present: next, at: now, future: [] };
  }
  const past = [...h.past, h.present];
  if (past.length > limit) past.splice(0, past.length - limit);
  return { past, present: next, future: [], at: now, sizingOnly: sizing };
}

export const canUndo = <V>(h: ViewHistory<V>): boolean => h.past.length > 0;
export const canRedo = <V>(h: ViewHistory<V>): boolean => h.future.length > 0;

export function undoHistory<V>(h: ViewHistory<V>, now = Date.now()): ViewHistory<V> {
  if (h.past.length === 0) return h;
  const present = h.past[h.past.length - 1]!;
  return { past: h.past.slice(0, -1), present, future: [h.present, ...h.future], at: now, sizingOnly: false };
}

export function redoHistory<V>(h: ViewHistory<V>, now = Date.now()): ViewHistory<V> {
  if (h.future.length === 0) return h;
  const [present, ...future] = h.future as [V, ...V[]];
  return { past: [...h.past, h.present], present, future, at: now, sizingOnly: false };
}
