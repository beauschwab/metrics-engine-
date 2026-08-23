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
  /**
   * True when this revision was saved with an acknowledged weakening (ADR-57):
   * the author said "I intend this", and a second person's review — recorded
   * separately, under their own name — is what clears it for release.
   */
  needsReview: boolean;
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
  needs_review: number;
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
  needsReview: Number(r.needs_review) === 1,
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
    /**
     * Mark the revision as carrying an acknowledged weakening (ADR-57). Set by
     * the caller that ran the impact assessment and saw the author acknowledge
     * it — a second person's review then clears it for release.
     */
    needsReview?: boolean;
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
        await this.db.run(SQL.insertRevision, [
          body, hash, author, message, now(), input.needsReview ? 1 : 0, name,
        ]);
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

  // --- releases and channels ------------------------------------------------

  /**
   * Cut a release: pin every artifact at its current revision.
   *
   * The release is the unit of deployment, and it is immutable — the surface's
   * debounced autosave keeps writing revisions afterwards without changing what
   * any client reads. `errors`/`warnings` are recorded rather than gated here:
   * whether a workspace with problems may be *deployed* is the promotion's
   * decision, made where the target channel is known.
   */
  async createRelease(input: {
    name?: string;
    message: string;
    author: string;
    errors: number;
    warnings: number;
  }): Promise<ReleaseSummary> {
    return this.db.transaction(async () => {
      const workspace = await this.workspace();
      if (!workspace.length) throw new NotFound('nothing to release — the registry is empty');

      const at = now();
      await this.db.run(SQL.insertRelease, [
        input.name || '', input.message, input.author,
        input.errors, input.warnings, at,
      ]);
      // Re-read rather than computing MAX+1 twice: the INSERT numbered it, and
      // inside the transaction this read sees our own write on both engines.
      const [row] = await this.db.all<{ version: number }>(SQL.newestReleaseVersion);
      const version = Number(row.version);

      for (const artifact of workspace) {
        await this.db.run(SQL.insertPin, [
          version, artifact.name, artifact.kind, artifact.revision, artifact.contentHash,
        ]);
      }

      return {
        version,
        name: input.name || '',
        message: input.message,
        author: input.author,
        errors: input.errors,
        warnings: input.warnings,
        createdAt: at,
        artifacts: workspace.length,
      };
    });
  }

  async releases(): Promise<ReleaseSummary[]> {
    const rows = await this.db.all<ReleaseRow>(SQL.releases);
    const counts = new Map<number, number>();
    for (const r of rows) {
      const pins = await this.db.all(SQL.pinsOf, [r.version]);
      counts.set(Number(r.version), pins.length);
    }
    return rows.map((r) => toRelease(r, counts.get(Number(r.version)) ?? 0));
  }

  async release(version: number): Promise<(ReleaseSummary & { pins: Pin[] }) | null> {
    const [row] = await this.db.all<ReleaseRow>(SQL.releaseByVersion, [version]);
    if (!row) return null;
    const pins = await this.db.all<PinRow>(SQL.pinsOf, [version]);
    return {
      ...toRelease(row, pins.length),
      pins: pins.map((p) => ({
        name: p.artifact_name,
        kind: p.kind,
        revision: Number(p.revision_no),
        contentHash: p.content_hash,
      })),
    };
  }

  /** The pinned bodies — the workspace a runtime client actually evaluates. */
  async releaseWorkspace(version: number): Promise<Revision[]> {
    const rows = await this.db.all<{
      name: string; kind: string; revision_no: number; body: string; content_hash: string;
    }>(SQL.releaseBodies, [version]);
    return rows.map((r) => ({
      name: r.name,
      kind: r.kind,
      revision: Number(r.revision_no),
      body: r.body,
      contentHash: r.content_hash,
      author: '',
      message: '',
      createdAt: '',
      needsReview: false,
    }));
  }

  // --- second-person review (ADR-57) ---------------------------------------

  /**
   * Record one person's sign-off on one thing: a revision of an artifact, or a
   * release. Deliberately dumb, like `promote` — who may review what is the
   * layer above's decision, made where the revision's author is known. The
   * UNIQUE constraint turns "signed it twice" into a no-op rather than a
   * duplicate row.
   */
  async addReview(input: {
    target: 'revision' | 'release';
    name: string;
    version: number;
    reviewer: string;
    note: string;
  }): Promise<Review> {
    const at = now();
    try {
      await this.db.run(SQL.insertReview, [
        input.target, input.name, input.version, input.reviewer, input.note, at,
      ]);
    } catch (err) {
      if (!isUniqueViolation(err)) throw err;
      // Signing the same thing twice changes nothing — the first signature is
      // the record, and re-recording it would put a decision in the history
      // that nobody made.
    }
    return { ...input, createdAt: at };
  }

  async reviewsOf(target: 'revision' | 'release', name: string, version: number): Promise<Review[]> {
    const rows = await this.db.all<{
      target: string; name: string; version: number; reviewer: string; note: string; created_at: string;
    }>(SQL.reviewsOf, [target, name, version]);
    return rows.map((r) => ({
      target: r.target as 'revision' | 'release',
      name: r.name,
      version: Number(r.version),
      reviewer: r.reviewer,
      note: r.note,
      createdAt: r.created_at,
    }));
  }

  /**
   * Point a channel at a release.
   *
   * Deliberately dumb: the governance — impact against what the channel
   * currently serves, acknowledgement of weakenings — happens in the layer
   * above, where the engine is available. This records the move and keeps every
   * prior move, so "what was production reading on the 14th" has an answer.
   */
  async promote(channel: string, version: number, actor: string, message: string): Promise<Channel> {
    const found = await this.release(version);
    if (!found) throw new NotFound(`no release r${version}`);

    return this.db.transaction(async () => {
      const at = now();
      await this.db.run(SQL.deleteChannel, [channel]);
      await this.db.run(SQL.insertChannel, [channel, version, at, actor]);
      await this.db.run(SQL.insertPromotion, [channel, version, actor, message, at]);
      return { name: channel, version, updatedAt: at, updatedBy: actor };
    });
  }

  async channel(name: string): Promise<Channel | null> {
    const [row] = await this.db.all<ChannelRow>(SQL.channelByName, [name]);
    return row
      ? { name: row.name, version: Number(row.version), updatedAt: row.updated_at, updatedBy: row.updated_by }
      : null;
  }

  async channels(): Promise<Channel[]> {
    const rows = await this.db.all<ChannelRow>(SQL.channels);
    return rows.map((r) => ({
      name: r.name, version: Number(r.version), updatedAt: r.updated_at, updatedBy: r.updated_by,
    }));
  }

  async promotions(channel: string): Promise<Promotion[]> {
    const rows = await this.db.all<PromotionRow>(SQL.promotionsOf, [channel]);
    return rows.map((r) => ({
      channel: r.channel, version: Number(r.version), actor: r.actor,
      message: r.message, createdAt: r.created_at,
    }));
  }
}

// --- release shapes ---------------------------------------------------------

export interface ReleaseSummary {
  version: number;
  name: string;
  message: string;
  author: string;
  /** Diagnostic counts at cut time — recorded, and judged at promotion. */
  errors: number;
  warnings: number;
  createdAt: string;
  artifacts: number;
}

export interface Pin {
  name: string;
  kind: string;
  revision: number;
  contentHash: string;
}

export interface Channel {
  name: string;
  version: number;
  updatedAt: string;
  updatedBy: string;
}

export interface Promotion {
  channel: string;
  version: number;
  actor: string;
  message: string;
  createdAt: string;
}

export interface Review {
  target: 'revision' | 'release';
  /** Artifact name for a revision review; '' for a release. */
  name: string;
  /** Revision number, or release version. */
  version: number;
  reviewer: string;
  note: string;
  createdAt: string;
}

interface ReleaseRow {
  version: number; name: string; message: string; author: string;
  errors: number; warnings: number; created_at: string;
}
interface PinRow { artifact_name: string; kind: string; revision_no: number; content_hash: string }
interface ChannelRow { name: string; version: number; updated_at: string; updated_by: string }
interface PromotionRow {
  channel: string; version: number; actor: string; message: string; created_at: string;
}

function toRelease(r: ReleaseRow, artifacts: number): ReleaseSummary {
  return {
    version: Number(r.version), name: r.name, message: r.message, author: r.author,
    errors: Number(r.errors), warnings: Number(r.warnings), createdAt: r.created_at,
    artifacts,
  };
}

