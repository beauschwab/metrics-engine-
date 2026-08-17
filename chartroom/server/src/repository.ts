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

export type ProposalStatus = 'draft' | 'submitted' | 'approved' | 'rejected';

export interface ProposalRow {
  id: string;
  docName: string;
  yaml: string;
  rationale: string;
  status: ProposalStatus;
  evidence: unknown;
  author: string;
  dashboardId: string | null;
  steward: string | null;
  decisionComment: string | null;
  decidedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ApprovalRow {
  track: string;
  approver: string;
  decision: 'approve' | 'reject';
  comment: string;
  createdAt: string;
}

export interface ExposureRow {
  dashboardId: string;
  specHash: string;
  refreshSlo: string;
  registeredBy: string;
  registeredAt: string;
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

  // ---- proposals ----------------------------------------------------------

  /** Create or (while undecided) revise a proposal. Every touch re-validates. */
  async saveProposal(input: {
    id: string; docName: string; yaml: string; rationale: string;
    evidence: unknown; dashboardId: string | null; author: string; actor: string;
  }): Promise<ProposalRow> {
    const existing = await this.proposal(input.id);
    const at = now();
    if (existing) {
      if (existing.status === 'approved' || existing.status === 'rejected') {
        throw new Invalid(
          `proposal ${input.id} is ${existing.status} — a decided proposal is history; open a new one`,
        );
      }
      await this.db.transaction(async () => {
        await this.db.run(S.updateProposalDraft, [
          input.yaml, input.rationale, JSON.stringify(input.evidence), 'draft', at, input.id,
        ]);
        await this.audit(input.actor, 'proposal.revise', 'proposal', input.id, input.yaml);
      });
    } else {
      await this.db.transaction(async () => {
        await this.db.run(S.insertProposal, [
          input.id, input.docName, input.yaml, input.rationale, 'draft',
          JSON.stringify(input.evidence), input.author, input.dashboardId, at, at,
        ]);
        await this.audit(input.actor, 'proposal.create', 'proposal', input.id, input.yaml);
      });
    }
    return (await this.proposal(input.id))!;
  }

  async submitProposal(id: string, actor: string, blockers: string[]): Promise<ProposalRow> {
    const p = await this.proposal(id);
    if (!p) throw new NotFound(`no proposal called ${id}`);
    if (p.status !== 'draft') throw new Invalid(`proposal ${id} is ${p.status}, not submittable`);
    if (blockers.length) {
      throw new Invalid(
        'the validation evidence blocks submission — a steward should never be asked to '
        + 'approve a document the engine already rejects',
        blockers,
      );
    }
    await this.db.transaction(async () => {
      await this.db.run(S.updateProposalDraft, [
        p.yaml, p.rationale, JSON.stringify(p.evidence), 'submitted', now(), id,
      ]);
      await this.audit(actor, 'proposal.submit', 'proposal', id, p.yaml);
    });
    return (await this.proposal(id))!;
  }

  /** The steward's decision. Entitlement (human-only) is the API's job. */
  async decideProposal(input: {
    id: string; decision: 'approved' | 'rejected'; steward: string; comment: string;
    evidence: unknown;
  }): Promise<ProposalRow> {
    const p = await this.proposal(input.id);
    if (!p) throw new NotFound(`no proposal called ${input.id}`);
    if (p.status !== 'submitted') {
      throw new Invalid(`proposal ${input.id} is ${p.status} — only a submitted proposal can be decided`);
    }
    await this.db.transaction(async () => {
      await this.db.run(S.decideProposal, [
        input.decision, input.steward, input.comment, now(),
        JSON.stringify(input.evidence), now(), input.id,
      ]);
      await this.audit(input.steward, `proposal.${input.decision === 'approved' ? 'approve' : 'reject'}`,
        'proposal', input.id, input.comment);
    });
    return (await this.proposal(input.id))!;
  }

  async proposal(id: string): Promise<ProposalRow | null> {
    const rows = await this.db.all<Record<string, unknown>>(S.proposal, [id]);
    return rows.length ? mapProposal(rows[0]) : null;
  }

  async proposals(status?: string): Promise<ProposalRow[]> {
    const rows = await this.db.all<Record<string, unknown>>(S.proposals);
    const all = rows.map(mapProposal);
    return status ? all.filter((p) => p.status === status) : all;
  }

  // ---- approvals & promotion ---------------------------------------------

  async addApproval(input: {
    dashboardId: string; track: string; approver: string;
    decision: 'approve' | 'reject'; comment: string;
  }): Promise<void> {
    await this.db.transaction(async () => {
      await this.db.run(S.insertApproval, [
        'dashboard', input.dashboardId, input.track, input.approver,
        input.decision, input.comment, now(),
      ]);
      await this.audit(input.approver, `approval.${input.decision}`, 'dashboard',
        input.dashboardId, `${input.track}: ${input.comment}`);
    });
  }

  /** The newest decision per track — a later rejection outdates an approval. */
  async approvalState(dashboardId: string): Promise<Record<string, ApprovalRow>> {
    const rows = await this.db.all<Record<string, unknown>>(
      S.approvalsOf, ['dashboard', dashboardId],
    );
    const out: Record<string, ApprovalRow> = {};
    for (const r of rows) {
      out[String(r.track)] = {
        track: String(r.track), approver: String(r.approver),
        decision: String(r.decision) as 'approve' | 'reject',
        comment: String(r.comment), createdAt: String(r.created_at),
      };
    }
    return out;
  }

  /**
   * Move a dashboard's status and append the version that carries it.
   *
   * The status column and the spec agree by construction: the promoted spec is
   * the latest version's spec with only its status changed, saved as the next
   * version with the promoter as author. Gates live in the API layer, where
   * the lint context is available; this is the mechanics.
   */
  async promote(input: {
    dashboardId: string; to: 'team' | 'certified'; actor: string;
    lintReport: LintReport;
  }): Promise<VersionRow> {
    const dash = await this.dashboard(input.dashboardId);
    if (!dash) throw new NotFound(`no dashboard called ${input.dashboardId}`);
    const latest = await this.latest(input.dashboardId);
    if (!latest) throw new Invalid('a dashboard with no versions cannot be promoted');

    const spec: DashboardSpec = {
      ...latest.spec,
      dashboard: { ...latest.spec.dashboard, status: input.to },
    };
    const row: VersionRow = {
      version: latest.version + 1,
      spec,
      specHash: specHash(spec),
      parent: latest.version,
      author: input.actor,
      lintReport: input.lintReport,
      createdAt: now(),
    };
    await this.db.transaction(async () => {
      await this.db.run(S.setStatus, [input.to, input.dashboardId]);
      await this.db.run(S.insertVersion, [
        input.dashboardId, row.version, canonicalize(spec), row.specHash,
        row.parent, row.author, JSON.stringify(row.lintReport), row.createdAt,
      ]);
      await this.audit(input.actor, `dashboard.promote.${input.to}`, 'dashboard',
        input.dashboardId, row.specHash);
    });
    return row;
  }

  async addExposure(input: {
    dashboardId: string; specHash: string; refreshSlo: string; registeredBy: string;
  }): Promise<void> {
    await this.db.transaction(async () => {
      await this.db.run(S.insertExposure, [
        input.dashboardId, input.specHash, input.refreshSlo, input.registeredBy, now(),
      ]);
      await this.audit(input.registeredBy, 'exposure.register', 'dashboard',
        input.dashboardId, `${input.specHash} · ${input.refreshSlo}`);
    });
  }

  async exposures(dashboardId: string): Promise<ExposureRow[]> {
    const rows = await this.db.all<Record<string, unknown>>(S.exposuresOf, [dashboardId]);
    return rows.map((r) => ({
      dashboardId: String(r.dashboard_id), specHash: String(r.spec_hash),
      refreshSlo: String(r.refresh_slo), registeredBy: String(r.registered_by),
      registeredAt: String(r.registered_at),
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

function mapProposal(r: Record<string, unknown>): ProposalRow {
  return {
    id: String(r.id),
    docName: String(r.doc_name),
    yaml: String(r.yaml),
    rationale: String(r.rationale),
    status: String(r.status) as ProposalStatus,
    evidence: JSON.parse(String(r.evidence)),
    author: String(r.author),
    dashboardId: r.dashboard_id === null ? null : String(r.dashboard_id),
    steward: r.steward === null ? null : String(r.steward),
    decisionComment: r.decision_comment === null ? null : String(r.decision_comment),
    decidedAt: r.decided_at === null ? null : String(r.decided_at),
    createdAt: String(r.created_at),
    updatedAt: String(r.updated_at),
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
