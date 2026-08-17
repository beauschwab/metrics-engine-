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
  canonicalize, parseBrief, parseSpec, sha256Hex, specHash,
  type Brief, type BriefStatus, type DashboardSpec, type LintReport,
} from 'chartroom-spec';
import { isUniqueViolation, type Db } from '../../../server/db';
import { STATEMENTS as S } from './dialect';

export class Conflict extends Error {}
export class NotFound extends Error {}
export class Forbidden extends Error {}

/** The SR 11-7 line: an agent proposes; named humans approve and compose freely. */
export const isAgent = (actor: string): boolean => actor.startsWith('agent:');
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

export interface BriefRow {
  version: number;
  brief: Brief;
  status: BriefStatus;
  author: string;
  approvedBy: string | null;
  approvedAt: string | null;
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

    // The Phase-2 composition gate: an agent may not compose until a human
    // has approved the brief. Plan before pixels is a product promise, and a
    // promise the agent could skip by just calling save is a prompt, not a
    // gate. Humans compose freely — they are the approvers.
    if (isAgent(input.actor)) {
      const brief = await this.latestBrief(input.dashboardId);
      if (!brief || brief.status !== 'approved') {
        throw new Forbidden(
          brief
            ? `the brief for ${input.dashboardId} is ${brief.status} — composition waits for a `
              + 'human approval (create_brief → a person approves in the studio → save_dashboard)'
            : `no brief exists for ${input.dashboardId} — the flow is create_brief, human `
              + 'approval, then composition',
        );
      }
    }

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

  // ---- briefs -------------------------------------------------------------

  /**
   * Append a brief version. The schema *is* the grilling protocol: an intake
   * missing a slot fails here with the slot named, whoever — human or agent —
   * sent it. A new version supersedes every earlier one, approved included:
   * a brief edited after approval is a different brief, and pretending the
   * old approval covers it is how "approved" stops meaning anything.
   */
  async saveBrief(input: {
    dashboardId: string; content: unknown; author: string; actor: string;
  }): Promise<BriefRow> {
    const parsed = parseBrief(input.content);
    if (!parsed.ok) {
      throw new Invalid(
        'the brief cannot be created until every intake slot is resolved',
        parsed.problems,
      );
    }
    if (parsed.brief.dashboard_id !== input.dashboardId) {
      throw new Invalid(
        `the brief says it is for ${parsed.brief.dashboard_id}, not ${input.dashboardId}`,
      );
    }
    const dash = await this.dashboard(input.dashboardId);
    if (!dash) throw new NotFound(`no dashboard called ${input.dashboardId}`);

    const maxRows = await this.db.all<{ v: number | null }>(S.maxBrief, [input.dashboardId]);
    const version = (maxRows[0]?.v ?? 0) + 1;
    const row: BriefRow = {
      version, brief: parsed.brief, status: 'draft', author: input.author,
      approvedBy: null, approvedAt: null, createdAt: now(),
    };
    try {
      await this.db.transaction(async () => {
        await this.db.run(S.supersedeBriefs, [input.dashboardId]);
        await this.db.run(S.insertBrief, [
          input.dashboardId, version, JSON.stringify(parsed.brief), 'draft',
          input.author, row.createdAt,
        ]);
        await this.audit(input.actor, 'brief.save', 'dashboard', input.dashboardId, `v${version}`);
      });
    } catch (e) {
      if (isUniqueViolation(e)) throw new Conflict('someone else briefed at the same moment — reload');
      throw e;
    }
    return row;
  }

  async latestBrief(dashboardId: string): Promise<BriefRow | null> {
    const rows = await this.db.all<Record<string, unknown>>(
      S.latestBrief, [dashboardId, dashboardId],
    );
    return rows.length ? mapBrief(rows[0]) : null;
  }

  async briefs(dashboardId: string): Promise<BriefRow[]> {
    const rows = await this.db.all<Record<string, unknown>>(S.briefsOf, [dashboardId]);
    return rows.map(mapBrief);
  }

  /**
   * Approve the current brief. Actor entitlement is the API's job (an agent
   * identity is refused before this is reached); this layer guarantees the
   * mechanics — only a draft can be approved, and the approval stamps who.
   */
  async approveBrief(dashboardId: string, approver: string): Promise<BriefRow> {
    const current = await this.latestBrief(dashboardId);
    if (!current) throw new NotFound(`no brief exists for ${dashboardId}`);
    if (current.status === 'approved') return current;
    if (current.status !== 'draft') {
      throw new Invalid(`brief v${current.version} is ${current.status}, not approvable`);
    }
    await this.db.transaction(async () => {
      await this.db.run(S.approveBrief, [approver, now(), dashboardId, current.version]);
      await this.audit(approver, 'brief.approve', 'dashboard', dashboardId, `v${current.version}`);
    });
    return (await this.latestBrief(dashboardId))!;
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

function mapBrief(r: Record<string, unknown>): BriefRow {
  return {
    version: Number(r.version_no),
    brief: JSON.parse(String(r.content)) as Brief,
    status: String(r.status) as BriefStatus,
    author: String(r.author),
    approvedBy: r.approved_by === null ? null : String(r.approved_by),
    approvedAt: r.approved_at === null ? null : String(r.approved_at),
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
