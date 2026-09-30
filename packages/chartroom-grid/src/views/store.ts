/**
 * Saved views (ADR-69): a name over a view. The store is an interface so
 * the studio can keep views in the browser today and the governed API can
 * hold them tomorrow — a saved view is a document a steward could review,
 * which is why it is the validated JSON and nothing else. Every read
 * re-validates: a view saved by an older build that no longer parses is
 * dropped and counted, never rendered half-right (ADR-44).
 */

import { safeParseView, type ViewState } from '../grid/viewState';
import type { GridSchema } from '../grid/schema';

export interface SavedView {
  id: string;
  name: string;
  view: ViewState;
  savedAt: string;
}

export interface ViewStore {
  /**
   * The saved views that parse against a grid's schema (ADR-82): the
   * treasury book's by default. A view saved for another schema is not
   * listed here, and not lost either — it stays for the grid it was saved for.
   */
  list(schema?: GridSchema): Promise<SavedView[]>;
  /** Save under a name; with `id`, replace that saved view. */
  save(name: string, view: ViewState, id?: string): Promise<SavedView>;
  remove(id: string): Promise<void>;
}

const newId = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `v_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

export function memoryViewStore(seed: SavedView[] = []): ViewStore {
  let views = [...seed];
  return {
    async list(schema) {
      return views.flatMap((v) => {
        const parsed = safeParseView(v.view, schema);
        return parsed.ok ? [{ ...v, view: parsed.view }] : [];
      });
    },
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
  // The stored entries as they are: a save or a delete rewrites only the
  // entry it names, so a view saved for another grid's schema — which this
  // grid cannot parse — is never lost by this grid's writes.
  const readRaw = (): unknown[] => {
    try {
      const raw: unknown = JSON.parse(storage.getItem(key) ?? '[]');
      return Array.isArray(raw) ? raw : [];
    } catch {
      return [];
    }
  };
  const idOf = (item: unknown) => (item && typeof item === 'object' ? (item as Partial<SavedView>).id : undefined);
  const write = (items: unknown[]) => storage.setItem(key, JSON.stringify(items));
  return {
    async list(schema) {
      const out: SavedView[] = [];
      droppedCount = 0;
      for (const item of readRaw()) {
        const r = item as Partial<SavedView>;
        const parsed = safeParseView(r?.view, schema);
        if (typeof r?.id === 'string' && typeof r?.name === 'string' && parsed.ok) {
          out.push({ id: r.id, name: r.name, view: parsed.view, savedAt: typeof r.savedAt === 'string' ? r.savedAt : '' });
        } else {
          droppedCount++;
        }
      }
      return out;
    },
    async save(name, view, id) {
      const saved: SavedView = { id: id ?? newId(), name, view, savedAt: new Date().toISOString() };
      write([...readRaw().filter((item) => idOf(item) !== saved.id), saved]);
      return saved;
    },
    async remove(id) { write(readRaw().filter((item) => idOf(item) !== id)); },
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
