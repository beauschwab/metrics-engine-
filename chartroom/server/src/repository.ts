/**
 * Dashboard persistence — versions are the storage model, not a feature.
 *
 * A save is an INSERT of the next version_no; the UNIQUE constraint turns two
 * concurrent saves into one success and one conflict the caller can act on,
 * exactly as the registry's revisions do. `expectedVersion` is the optimistic
 * seam: the studio says which version it edited, and a save on top of someone
 * else's newer version is refused rather than silently woven in.
 *
 * Every mutation writes the audit log in the same transaction, with the actor
 * split the SR 11-7 posture requires: `agent:<session>` when an agent drove
 * the change, and the authenticated human it acted for. A mutation without an
 * audit row cannot be merged — `api.test.ts` fails on it.
 */

import {
  canonicalize, parseSpec, sha256Hex, specHash,
  type DashboardSpec, type LintReport,
} from 'chartroom-spec';
import { isUniqueViolation, type Db } from '../../../server/db';
import { STATEMENTS as S } from './dialect';

export class Conflict extends Error {}
export class NotFound extends Error {}
export class Invalid extends Error {
  constructor(message: string, public problems: string[] = []) {
    super(message);
  }
}

export interface DashboardRow {
  id: string;
  title: string;
  status: 'draft' | 'team' | 'certified';
  owner: string;
  createdAt: string;
}

export interface VersionRow {
  version: number;
  spec: DashboardSpec;
  specHash: string;
  parent: number | null;
  author: string;
  lintReport: LintReport;
  createdAt: string;
}

export interface VersionSummary {
  version: number;
  specHash: string;
  parent: number | null;
  author: string;
  createdAt: string;
}

export interface AuditRow {
  actor: string;
  action: string;
  artifactType: string;
  artifactId: string;
  payloadHash: string;
  createdAt: string;
}

const now = () => new Date().toISOString();

export class ChartroomRepository {
  constructor(private db: Db) {}

  private async audit(
    actor: string, action: string, artifactType: string, artifactId: string, payload: string,
  ): Promise<void> {
    await this.db.run(S.insertAudit, [
      actor, action, artifactType, artifactId, sha256Hex(payload), now(),
    ]);
  }

  async create(input: {
    id: string; title: string; owner: string; actor: string;
  }): Promise<DashboardRow> {
    const row: DashboardRow = {
      id: input.id, title: input.title, status: 'draft', owner: input.owner, createdAt: now(),
    };
    try {
      await this.db.transaction(async () => {
        await this.db.run(S.insertDashboard, [row.id, row.title, row.status, row.owner, row.createdAt]);
        await this.audit(input.actor, 'dashboard.create', 'dashboard', row.id, row.id);
      });
    } catch (e) {
      if (isUniqueViolation(e)) throw new Conflict(`a dashboard called ${input.id} already exists`);
      throw e;
    }
    return row;
  }

  async dashboards(): Promise<DashboardRow[]> {
    const rows = await this.db.all<Record<string, unknown>>(S.dashboards);
    return rows.map(mapDashboard);
  }

  async dashboard(id: string): Promise<DashboardRow | null> {
    const rows = await this.db.all<Record<string, unknown>>(S.dashboard, [id]);
    return rows.length ? mapDashboard(rows[0]) : null;
  }

  /**
   * Append a version. The spec must parse — a version that cannot render is
   * not a draft, it is a corrupt row — but lint BLOCKs are *allowed* at draft
   * status and recorded with the version, per the promotion matrix: the gate
   * that refuses imperfect drafts is a gate people learn to route around.
   */
  async saveVersion(input: {
    dashboardId: string;
    spec: unknown;
    lintReport: LintReport;
    author: string;
    actor: string;
    expectedVersion: number | null;
  }): Promise<VersionRow> {
    const parsed = parseSpec(input.spec);
    if (!parsed.ok) {
      throw new Invalid('the spec does not validate against the schema', parsed.problems);
    }
    const spec = parsed.spec;

    const dash = await this.dashboard(input.dashboardId);
    if (!dash) throw new NotFound(`no dashboard called ${input.dashboardId}`);
    if (spec.dashboard.id !== input.dashboardId) {
      throw new Invalid(`the spec says its id is ${spec.dashboard.id}, not ${input.dashboardId}`);
    }
    if (spec.dashboard.status !== dash.status) {
      // Status moves through the promotion path (Phase 3), never through an
      // ordinary save — otherwise "edit the yaml" quietly bypasses every gate.
      throw new Invalid(
        `this dashboard is ${dash.status}; a save cannot change status to ${spec.dashboard.status}`,
      );
    }
    if (dash.status !== 'draft' && input.lintReport.counts.block > 0) {
      throw new Invalid(
        `a ${dash.status} dashboard cannot carry lint BLOCKs — resolve them or work in a draft`,
      );
    }

    const maxRows = await this.db.all<{ v: number | null }>(S.maxVersion, [input.dashboardId]);
    const current = maxRows[0]?.v ?? 0;
    if (input.expectedVersion !== null && input.expectedVersion !== current) {
      throw new Conflict(
        `you edited v${input.expectedVersion} but the dashboard is at v${current} — `
        + 'reload and reapply your change',
      );
    }

    const row: VersionRow = {
      version: current + 1,
      spec,
      specHash: specHash(spec),
      parent: current || null,
      author: input.author,
      lintReport: input.lintReport,
      createdAt: now(),
    };

    try {
      await this.db.transaction(async () => {
        await this.db.run(S.insertVersion, [
          input.dashboardId, row.version, canonicalize(spec), row.specHash,
          row.parent, row.author, JSON.stringify(row.lintReport), row.createdAt,
        ]);
        await this.audit(input.actor, 'dashboard.save', 'dashboard', input.dashboardId, row.specHash);
      });
    } catch (e) {
      if (isUniqueViolation(e)) {
        throw new Conflict('someone else saved while you were editing — reload and reapply');
      }
      throw e;
    }
    return row;
  }

  async latest(id: string): Promise<VersionRow | null> {
    const rows = await this.db.all<Record<string, unknown>>(S.latestVersion, [id, id]);
    return rows.length ? mapVersion(rows[0]) : null;
  }

  async version(id: string, no: number): Promise<VersionRow | null> {
    const rows = await this.db.all<Record<string, unknown>>(S.version, [id, no]);
    return rows.length ? mapVersion(rows[0]) : null;
  }

  async versions(id: string): Promise<VersionSummary[]> {
    const rows = await this.db.all<Record<string, unknown>>(S.versions, [id]);
    return rows.map((r) => ({
      version: Number(r.version_no),
      specHash: String(r.spec_hash),
      parent: r.parent_no === null ? null : Number(r.parent_no),
      author: String(r.author),
      createdAt: String(r.created_at),
    }));
  }

  async auditLog(artifactType: string, artifactId: string): Promise<AuditRow[]> {
    const rows = await this.db.all<Record<string, unknown>>(S.auditOf, [artifactType, artifactId]);
    return rows.map((r) => ({
      actor: String(r.actor),
      action: String(r.action),
      artifactType: String(r.artifact_type),
      artifactId: String(r.artifact_id),
      payloadHash: String(r.payload_hash),
      createdAt: String(r.created_at),
    }));
  }
}

function mapDashboard(r: Record<string, unknown>): DashboardRow {
  return {
    id: String(r.id),
    title: String(r.title),
    status: String(r.status) as DashboardRow['status'],
    owner: String(r.owner),
    createdAt: String(r.created_at),
  };
}

function mapVersion(r: Record<string, unknown>): VersionRow {
  return {
    version: Number(r.version_no),
    spec: JSON.parse(String(r.spec)) as DashboardSpec,
    specHash: String(r.spec_hash),
    parent: r.parent_no === null ? null : Number(r.parent_no),
    author: String(r.author),
    lintReport: JSON.parse(String(r.lint_report)) as LintReport,
    createdAt: String(r.created_at),
  };
}
