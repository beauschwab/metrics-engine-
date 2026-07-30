/**
 * What the registry does with its storage.
 *
 * One rule shapes everything here: **a revision is never modified.** Saving is
 * an append. That is not a nicety for auditors — it is what makes the registry
 * able to answer the only question that really matters about a filed number,
 * which is "what were the rules when we filed it". An `UPDATE` destroys the
 * answer, and no amount of logging afterwards recovers it.
 *
 * Two consequences worth stating up front. Saving the same body twice is not an
 * error but it is not a revision either — a no-op save would otherwise fill the
 * history with entries nobody made a decision in. And two authors saving at once
 * do not merge: the second one loses the race and is told so, because silently
 * picking a winner is how a rule change disappears.
 */

import { createHash } from 'node:crypto';
import { isUniqueViolation, type Db } from './db';
import { SQL } from './dialect';

export interface Revision {
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

export interface SaveResult {
  /** The revision that now holds this body — new, or the existing identical one. */
  revision: number;
  /** False when the body was byte-identical to the current one. */
  changed: boolean;
}

export class Conflict extends Error {}
export class NotFound extends Error {}

export function contentHash(body: string): string {
  return createHash('sha256').update(body, 'utf8').digest('hex');
}

/** ISO-8601 UTC to the millisecond — sortable as text, which is how it is stored. */
function now(): string {
  return new Date().toISOString();
}

interface Row {
  name: string;
  kind: string;
  revision_no: number;
  body: string;
  content_hash: string;
  author: string;
  message: string;
  created_at: string;
}

const toRevision = (r: Row): Revision => ({
  name: r.name,
  kind: r.kind,
  revision: Number(r.revision_no),
  body: r.body,
  contentHash: r.content_hash,
  author: r.author,
  message: r.message,
  createdAt: r.created_at,
});

export class Repository {
  constructor(private readonly db: Db) {}

  /** Every artifact at its newest revision — the workspace the editor opens. */
  async workspace(): Promise<Revision[]> {
    const rows = await this.db.all<Row>(SQL.latestAll);
    return rows.map(toRevision);
  }

  /**
   * The workspace as it stood at a transaction time.
   *
   * The documents already carry valid time in `effective.from/to` — when a rule
   * applies. This is the other axis: when the registry knew it. A submission is
   * only reproducible with both, and before there was a database the second one
   * existed nowhere but git.
   */
  async workspaceAsOf(at: string): Promise<Revision[]> {
    const rows = await this.db.all<Row>(SQL.asOfAll, [at, at]);
    return rows.map(toRevision);
  }

  async latest(name: string): Promise<Revision | null> {
    const rows = await this.db.all<Row>(SQL.latestOne, [name]);
    return rows.length ? toRevision(rows[0]) : null;
  }

  async history(name: string): Promise<HistoryEntry[]> {
    const rows = await this.db.all<{
      revision_no: number; content_hash: string; author: string;
      message: string; created_at: string; body_length: number;
    }>(SQL.history, [name]);

    return rows.map((r) => ({
      revision: Number(r.revision_no),
      contentHash: r.content_hash,
      author: r.author,
      message: r.message,
      createdAt: r.created_at,
      bodyLength: Number(r.body_length),
    }));
  }

  async revision(name: string, revision: number): Promise<Revision | null> {
    const rows = await this.db.all<Row>(SQL.revision, [name, revision]);
    if (!rows.length) return null;
    return toRevision({ ...rows[0], name, kind: '' });
  }

  /**
   * Append a revision.
   *
   * `expectedRevision` is optimistic concurrency: the caller says which revision
   * it edited, and a mismatch means someone else saved in between. Without it,
   * the last writer wins and the loser never finds out — which for a governed
   * rule set means a change that was reviewed, approved and then quietly
   * reverted by a stale browser tab.
   */
  async save(input: {
    name: string;
    kind: string;
    body: string;
    author: string;
    message: string;
    expectedRevision?: number;
  }): Promise<SaveResult> {
    const { name, kind, body, author, message, expectedRevision } = input;
    const hash = contentHash(body);

    return this.db.transaction(async () => {
      const existing = await this.db.all<{ artifact_id: number }>(SQL.artifactByName, [name]);
      if (!existing.length) {
        await this.db.run(SQL.insertArtifact, [name, kind, now()]);
      }

      const current = await this.latest(name);

      if (current && expectedRevision !== undefined && current.revision !== expectedRevision) {
        throw new Conflict(
          `${name} is at revision ${current.revision}, not ${expectedRevision} — ` +
          `${current.author} saved at ${current.createdAt}`,
        );
      }

      // A save that changes nothing is not a revision. Recording it would put
      // entries in the history that no one made a decision in, and the history
      // is the thing an auditor reads.
      if (current && current.contentHash === hash) {
        return { revision: current.revision, changed: false };
      }

      try {
        await this.db.run(SQL.insertRevision, [body, hash, author, message, now(), name]);
      } catch (err) {
        // Two writers computed the same next revision number. The constraint
        // caught it, which is the point of the constraint.
        if (isUniqueViolation(err)) {
          throw new Conflict(`${name} was saved concurrently — reload and reapply`);
        }
        throw err;
      }

      const saved = await this.latest(name);
      if (!saved) throw new Error(`${name} vanished immediately after being written`);
      return { revision: saved.revision, changed: true };
    });
  }

  /**
   * Put the shipped documents in as revision 1, once.
   *
   * Idempotent by construction: `save` is a no-op when the body already matches,
   * so a restart neither duplicates nor overwrites. An artifact an author has
   * since edited is left alone rather than reset to the shipped text — the seed
   * is a starting point, not a source of truth that keeps reasserting itself.
   */
  async seed(docs: Array<{ name: string; kind: string; body: string }>): Promise<number> {
    let created = 0;
    for (const doc of docs) {
      const current = await this.latest(doc.name);
      if (current) continue;
      await this.save({
        ...doc,
        author: 'system',
        message: 'Shipped with the registry',
      });
      created++;
    }
    return created;
  }
}
