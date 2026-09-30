/**
 * Saved views (ADR-69): a name over a view. The store is an interface so
 * the studio can keep views in the browser today and the governed API can
 * hold them tomorrow — a saved view is a document a steward could review,
 * which is why it is the validated JSON and nothing else. Every read
 * re-validates: a view saved by an older build that no longer parses is
 * dropped and counted, never rendered half-right (ADR-44).
 */

import { safeParseView, type ViewState } from '../grid/viewState';

export interface SavedView {
  id: string;
  name: string;
  view: ViewState;
  savedAt: string;
}

export interface ViewStore {
  list(): Promise<SavedView[]>;
  /** Save under a name; with `id`, replace that saved view. */
  save(name: string, view: ViewState, id?: string): Promise<SavedView>;
  remove(id: string): Promise<void>;
}

const newId = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `v_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

export function memoryViewStore(seed: SavedView[] = []): ViewStore {
  let views = [...seed];
  return {
    async list() { return views.map((v) => ({ ...v })); },
    async save(name, view, id) {
      const saved: SavedView = { id: id ?? newId(), name, view, savedAt: new Date().toISOString() };
      views = [...views.filter((v) => v.id !== saved.id), saved];
      return saved;
    },
    async remove(id) { views = views.filter((v) => v.id !== id); },
  };
}

/** A minimal `Storage`: what localStorage has and a test can fake. */
export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export const VIEW_STORE_KEY = 'chartroom-grid.views';

export interface StorageViewStore extends ViewStore {
  /** Views the last read dropped because they no longer parse. */
  dropped(): number;
}

export function storageViewStore(storage: KeyValueStorage, key = VIEW_STORE_KEY): StorageViewStore {
  let droppedCount = 0;
  const read = (): SavedView[] => {
    let raw: unknown;
    try {
      raw = JSON.parse(storage.getItem(key) ?? '[]');
    } catch {
      raw = [];
    }
    if (!Array.isArray(raw)) return [];
    const out: SavedView[] = [];
    droppedCount = 0;
    for (const item of raw) {
      const r = item as Partial<SavedView>;
      const parsed = safeParseView(r?.view);
      if (typeof r?.id === 'string' && typeof r?.name === 'string' && parsed.ok) {
        out.push({ id: r.id, name: r.name, view: parsed.view, savedAt: typeof r.savedAt === 'string' ? r.savedAt : '' });
      } else {
        droppedCount++;
      }
    }
    return out;
  };
  const write = (views: SavedView[]) => storage.setItem(key, JSON.stringify(views));
  return {
    async list() { return read(); },
    async save(name, view, id) {
      const saved: SavedView = { id: id ?? newId(), name, view, savedAt: new Date().toISOString() };
      write([...read().filter((v) => v.id !== saved.id), saved]);
      return saved;
    },
    async remove(id) { write(read().filter((v) => v.id !== id)); },
    dropped: () => droppedCount,
  };
}

/** The browser's store, when there is a browser. */
export function localStorageViewStore(key = VIEW_STORE_KEY): StorageViewStore | null {
  try {
    return typeof localStorage === 'undefined' ? null : storageViewStore(localStorage, key);
  } catch {
    return null;
  }
}
