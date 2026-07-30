/**
 * Talking to the registry.
 *
 * Two things shape this module.
 *
 * It degrades rather than fails. The surface was a static prototype before there
 * was a server, and it still has to be one — a colleague opening the built bundle
 * with nothing running should get the shipped documents and a working editor, not
 * a spinner. So a failed load is a state (`offline`), not an error, and the
 * caller falls back to `INITIAL_DOCS`.
 *
 * It never resolves a conflict on its own. When a save comes back `409`, someone
 * else has written since this tab loaded, and the one thing this layer must not
 * do is pick a winner. It reports the conflict and lets the author decide, because
 * a governed rule change that gets silently reverted by a stale tab is exactly
 * the failure the revision history exists to prevent.
 */

import { INITIAL_DOCS, VIEW_FILES, type ViewFile } from './documents';

/** Where the API lives. Same origin in production, proxied in development. */
const BASE = '/api';

export interface StoredArtifact {
  name: string;
  kind: string;
  revision: number;
  body: string;
  contentHash: string;
  author: string;
  message: string;
  createdAt: string;
}

export interface HistoryEntry {
  revision: number;
  contentHash: string;
  author: string;
  message: string;
  createdAt: string;
  bodyLength: number;
}

export type Connection =
  /** The registry answered; edits are being persisted. */
  | { state: 'online'; revisions: Record<string, number> }
  /** No registry reachable. The shipped documents are loaded and edits are local. */
  | { state: 'offline'; reason: string };

export interface Workspace {
  docs: Record<ViewFile, string>;
  connection: Connection;
}

/**
 * Anything the registry does not know about still has to be there.
 *
 * The editor's tab strip and the registry tree are typed to the shipped set, and
 * a document missing from the API would render as an empty file rather than as an
 * error. Filling gaps from `INITIAL_DOCS` keeps the surface coherent whatever the
 * server holds.
 */
function withShippedDefaults(bodies: Record<string, string>): Record<ViewFile, string> {
  const out = { ...INITIAL_DOCS };
  VIEW_FILES.forEach((name) => {
    if (bodies[name] !== undefined) out[name] = bodies[name];
  });
  return out;
}

async function getJson(path: string, signal?: AbortSignal): Promise<unknown> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { accept: 'application/json' },
    ...(signal ? { signal } : {}),
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json();
}

/**
 * Load the workspace.
 *
 * `at` reads transaction time — the registry as it stood at an instant, which is
 * how a filed submission is reproduced rather than approximated.
 */
export async function loadWorkspace(opts: { at?: string; signal?: AbortSignal } = {}): Promise<Workspace> {
  try {
    const query = opts.at ? `?at=${encodeURIComponent(opts.at)}` : '';
    const data = (await getJson(`/artifacts${query}`, opts.signal)) as {
      artifacts: StoredArtifact[];
    };

    const bodies: Record<string, string> = {};
    const revisions: Record<string, number> = {};
    data.artifacts.forEach((a) => {
      bodies[a.name] = a.body;
      revisions[a.name] = a.revision;
    });

    return {
      docs: withShippedDefaults(bodies),
      connection: { state: 'online', revisions },
    };
  } catch (err) {
    // Not an error path. No registry is a legitimate way to run this.
    return {
      docs: { ...INITIAL_DOCS },
      connection: {
        state: 'offline',
        reason: err instanceof Error ? err.message : String(err),
      },
    };
  }
}

export async function loadHistory(name: string): Promise<HistoryEntry[]> {
  try {
    const data = (await getJson(`/artifacts/${encodeURIComponent(name)}/history`)) as {
      history: HistoryEntry[];
    };
    return data.history;
  } catch {
    return [];
  }
}

export type SaveOutcome =
  | { state: 'saved'; revision: number; changed: boolean }
  | { state: 'conflict'; message: string }
  | { state: 'offline'; message: string };

/**
 * Append a revision.
 *
 * `expectedRevision` is what makes this safe to call from more than one tab. Omit
 * it and the last writer wins; pass it and a save that would overwrite someone
 * else's comes back as a conflict for the author to resolve.
 */
export async function saveArtifact(input: {
  name: string;
  kind: string;
  body: string;
  author: string;
  message: string;
  expectedRevision?: number;
}): Promise<SaveOutcome> {
  try {
    const res = await fetch(`${BASE}/artifacts/${encodeURIComponent(input.name)}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        body: input.body,
        kind: input.kind,
        author: input.author,
        message: input.message,
        ...(input.expectedRevision !== undefined
          ? { expectedRevision: input.expectedRevision }
          : {}),
      }),
    });

    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;

    if (res.status === 409) {
      return { state: 'conflict', message: String(data.error || 'saved concurrently') };
    }
    if (!res.ok) {
      return { state: 'offline', message: String(data.error || `${res.status} ${res.statusText}`) };
    }

    return {
      state: 'saved',
      revision: Number(data.revision),
      changed: Boolean(data.changed),
    };
  } catch (err) {
    return { state: 'offline', message: err instanceof Error ? err.message : String(err) };
  }
}
