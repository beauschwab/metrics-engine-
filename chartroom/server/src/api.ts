/**
 * The HTTP surface — a pure function from request to response, in the
 * registry's idiom (ADR-3): testable without a port, errors mapped once.
 *
 * The server lints on every save with contracts fetched fresh — the studio
 * also lints locally for live UX, but the stored report is *this* one, because
 * "what did review see" must not depend on how stale one author's browser
 * cache was.
 */

import {
  diffSpecs, lint, parseSpec,
  type DashboardSpec, type LintContext,
} from 'chartroom-spec';
import { CATALOG, CATALOG_BY_REF } from 'chartroom-widgets/contracts';
import { PATTERNS, PATTERNS_BY_REF, RULE_GUIDE } from 'chartroom-patterns';
import { runDesignCritic } from 'chartroom-critics';
import { deriveContracts, fetchRegistryState, type ContractSet } from './keel';
import { registerDocument, submitBlockers, validateProposal, type ProposalEvidence } from './proposals';
import { QueryRefused, QueryUnresolved, QueryService, type QueryRequest } from './query';
import { upgradeNotices } from './upgrades';
import { ChartroomRepository, Conflict, Forbidden, Invalid, NotFound, isAgent } from './repository';

export interface ApiRequest {
  method: string;
  path: string;
  query?: Record<string, string>;
  body?: unknown;
  /** Asserted by whatever fronts the process — never chosen by the client. */
  identity?: string | null;
  /**
   * The human an agent session acts for (`x-principal`). The *actor* in the
   * audit trail is always the identity; the principal is attribution — the
   * SR 11-7 pairing of "which agent session" with "on whose behalf".
   */
  principal?: string | null;
}

export interface ApiResponse {
  status: number;
  body: unknown;
}

const json = (status: number, body: unknown): ApiResponse => ({ status, body });

/**
 * Contracts are re-derived when the registry moves and cached against its
 * workspace identity, so a save's lint always sees current governance state
 * without paying a re-derivation per keystroke.
 */
export class ContractCache {
  private set: ContractSet | null = null;
  private key = '';
  private fetchedAt = 0;
  constructor(private readonly ttlMs = 5_000) {}

  async current(): Promise<ContractSet> {
    if (this.set && Date.now() - this.fetchedAt < this.ttlMs) return this.set;
    const state = await fetchRegistryState();
    const key = state.docs.map((d) => `${d.name}@${d.revision}`).join(',') + '|' + state.source
      + '|' + [...state.production.entries()].map(([n, r]) => `${n}@${r}`).join(',');
    if (!this.set || key !== this.key) {
      this.set = deriveContracts(state);
      this.key = key;
    }
    this.fetchedAt = Date.now();
    return this.set;
  }
}

export interface ApiDeps {
  repo: ChartroomRepository;
  contracts: ContractCache;
  queries: QueryService;
}

const lintCtx = (set: ContractSet): LintContext => ({
  contracts: set.byRef,
  widgets: CATALOG_BY_REF,
});

const truncate = (set: ContractSet) =>
  set.contracts.map((c) => ({
    ref: c.ref, doc: c.doc, measure: c.measure, version: c.version, status: c.status,
    grain: c.grain, unit: c.unit, precision: c.precision, format: c.format,
    denominator_of: c.denominator_of ?? null,
    dims: c.dims.map((d) => ({ name: d.name, type: d.type, ordinal: d.ordinal ?? false })),
    owner: c.owner, description: c.description ?? null,
  }));

interface Requirement {
  id: string;
  label: string;
  met: boolean;
  detail?: string;
}

interface PromotionChecklist {
  status: string;
  next: 'team' | 'certified' | null;
  requirements: Requirement[];
  approvals: Record<string, { approver: string; decision: string; createdAt: string }>;
  lintAtTarget: import('chartroom-spec').LintReport | null;
  upgrades: { stale: number; weakens: number };
}

/**
 * The gate matrix, computed — one function so the studio's checklist and the
 * promote route cannot disagree about what "promotable" means. The latest
 * spec is linted *at the target status*, which is what arms GOV-01/GOV-02:
 * a derived expression or an ungoverned metric that is fine in a draft is a
 * BLOCK the moment the target is team.
 */
async function promotionChecklist(
  deps: ApiDeps,
  dashboardId: string,
): Promise<PromotionChecklist | null> {
  const dash = await deps.repo.dashboard(dashboardId);
  if (!dash) return null;
  const next = dash.status === 'draft' ? 'team' : dash.status === 'team' ? 'certified' : null;

  const latest = await deps.repo.latest(dashboardId);
  const brief = await deps.repo.latestBrief(dashboardId);
  const approvals = await deps.repo.approvalState(dashboardId);
  const requirements: Requirement[] = [];
  let lintAtTarget: import('chartroom-spec').LintReport | null = null;
  let upgrades = { stale: 0, weakens: 0 };

  if (next && latest) {
    const set = await deps.contracts.current();
    const targetSpec: DashboardSpec = {
      ...latest.spec,
      dashboard: { ...latest.spec.dashboard, status: next },
    };
    lintAtTarget = lint(targetSpec, lintCtx(set));
    const notices = await upgradeNotices(latest.spec as DashboardSpec, set.state);
    upgrades = {
      stale: notices.length,
      weakens: notices.filter((n) => n.weakens).length,
    };

    requirements.push({
      id: 'versions', label: 'the dashboard has at least one saved version', met: true,
    });
    requirements.push({
      id: 'brief',
      label: 'the design brief is approved',
      met: brief?.status === 'approved',
      detail: brief ? `brief v${brief.version} is ${brief.status}` : 'no brief exists',
    });
    requirements.push({
      id: 'lint',
      label: `zero lint BLOCKs at ${next} status (GOV rules armed)`,
      met: lintAtTarget.counts.block === 0,
      detail: lintAtTarget.counts.block
        ? lintAtTarget.findings.filter((f) => f.severity === 'BLOCK').map((f) => f.rule).join(', ')
        : undefined,
    });
    const peer = approvals['peer'];
    requirements.push({
      id: 'peer',
      label: 'a peer approval is on record',
      met: peer?.decision === 'approve',
      detail: peer ? `${peer.decision} by ${peer.approver}` : 'none yet',
    });
    if (next === 'certified') {
      for (const track of ['design', 'data-owner'] as const) {
        const a = approvals[track];
        requirements.push({
          id: track,
          label: track === 'design' ? 'the design steward signed off' : 'the data owner signed off',
          met: a?.decision === 'approve',
          detail: a ? `${a.decision} by ${a.approver}` : 'none yet',
        });
      }
      requirements.push({
        id: 'upgrades',
        label: 'no pinned document is behind a revision that weakens a control',
        met: upgrades.weakens === 0,
        detail: upgrades.weakens ? `${upgrades.weakens} weakening upgrade(s) pending review` : undefined,
      });
    }
  } else if (next && !latest) {
    requirements.push({
      id: 'versions', label: 'the dashboard has at least one saved version', met: false,
    });
  }

  return {
    status: dash.status,
    next,
    requirements,
    approvals: Object.fromEntries(Object.entries(approvals).map(([k, v]) => [
      k, { approver: v.approver, decision: v.decision, createdAt: v.createdAt },
    ])),
    lintAtTarget,
    upgrades,
  };
}

export async function handle(req: ApiRequest, deps: ApiDeps): Promise<ApiResponse> {
  const { method, path } = req;
  const body = (req.body ?? {}) as Record<string, unknown>;
  const identity = req.identity || 'anonymous';
  const author = req.principal || identity;

  try {
    if (method === 'GET' && path === '/api/health') {
      const set = await deps.contracts.current();
      return json(200, {
        ok: true,
        registry: set.state.source,
        contracts: set.contracts.length,
      });
    }

    // ---- catalog ---------------------------------------------------------
    if (method === 'GET' && path === '/api/contracts') {
      const set = await deps.contracts.current();
      const all = truncate(set);
      const certifiedOnly = req.query?.certified_only === 'true';
      return json(200, {
        source: set.state.source,
        contracts: certifiedOnly ? all.filter((c) => c.status === 'approved') : all,
      });
    }

    const contractPath = /^\/api\/contracts\/(.+)$/.exec(path);
    if (method === 'GET' && contractPath) {
      const ref = decodeURIComponent(contractPath[1]);
      const set = await deps.contracts.current();
      const c = set.byRef.get(ref);
      if (!c) return json(404, { error: `${ref} is not in the registry` });
      return json(200, { contract: c });
    }

    if (method === 'GET' && path === '/api/widgets') {
      return json(200, { widgets: CATALOG });
    }

    if (method === 'GET' && path === '/api/patterns') {
      return json(200, { patterns: PATTERNS });
    }

    const patternPath = /^\/api\/patterns\/([a-z0-9@.-]+)$/.exec(path);
    if (method === 'GET' && patternPath) {
      const p = PATTERNS_BY_REF.get(patternPath[1]);
      if (!p) return json(404, { error: `no pattern called ${patternPath[1]} in the catalog` });
      return json(200, { pattern: p });
    }

    if (method === 'GET' && path === '/api/design-rules') {
      return json(200, { rules: RULE_GUIDE });
    }

    // The design critic, run server-side against the dashboard's latest brief.
    // It degrades to a WARN "unavailable" finding without a model — the
    // deterministic linter is the hard gate, so this route never 500s on a
    // model failure.
    if (method === 'POST' && path === '/api/critique') {
      const parsed = parseSpec(body.spec);
      if (!parsed.ok) return json(422, { error: 'schema', problems: parsed.problems });
      const brief = typeof body.dashboard_id === 'string'
        ? await deps.repo.latestBrief(body.dashboard_id)
        : null;
      const findings = await runDesignCritic(parsed.spec, brief?.brief ?? null);
      return json(200, { findings, brief_version: brief?.version ?? null });
    }

    // ---- queries ---------------------------------------------------------
    if (method === 'POST' && path === '/api/query') {
      const result = await deps.queries.run(body as unknown as QueryRequest);
      return json(200, result);
    }

    // ---- lint ------------------------------------------------------------
    if (method === 'POST' && path === '/api/lint') {
      const parsed = parseSpec(body.spec);
      if (!parsed.ok) return json(422, { error: 'schema', problems: parsed.problems });
      const set = await deps.contracts.current();
      return json(200, { report: lint(parsed.spec, lintCtx(set)) });
    }

    // ---- dashboards ------------------------------------------------------
    if (method === 'GET' && path === '/api/dashboards') {
      return json(200, { dashboards: await deps.repo.dashboards() });
    }

    if (method === 'POST' && path === '/api/dashboards') {
      const id = String(body.id ?? '');
      const title = String(body.title ?? '');
      if (!/^[a-z][a-z0-9-]*$/.test(id) || !title) {
        return json(400, { error: 'a dashboard needs a slug id and a title' });
      }
      const row = await deps.repo.create({ id, title, owner: identity, actor: identity });
      return json(201, { dashboard: row });
    }

    const dashPath = /^\/api\/dashboards\/([a-z][a-z0-9-]*)$/.exec(path);
    if (method === 'GET' && dashPath) {
      const dash = await deps.repo.dashboard(dashPath[1]);
      if (!dash) return json(404, { error: `no dashboard called ${dashPath[1]}` });
      const latest = await deps.repo.latest(dashPath[1]);
      return json(200, { dashboard: dash, latest });
    }

    const versionsPath = /^\/api\/dashboards\/([a-z][a-z0-9-]*)\/versions$/.exec(path);
    if (method === 'GET' && versionsPath) {
      return json(200, { versions: await deps.repo.versions(versionsPath[1]) });
    }

    if (method === 'POST' && versionsPath) {
      const parsed = parseSpec(body.spec);
      if (!parsed.ok) return json(422, { error: 'schema', problems: parsed.problems });
      const set = await deps.contracts.current();
      const report = lint(parsed.spec, lintCtx(set));
      const row = await deps.repo.saveVersion({
        dashboardId: versionsPath[1],
        spec: parsed.spec,
        lintReport: report,
        author,
        actor: identity,
        expectedVersion: body.expectedVersion === undefined || body.expectedVersion === null
          ? null
          : Number(body.expectedVersion),
      });
      return json(201, { version: row.version, specHash: row.specHash, lintReport: report });
    }

    const versionPath = /^\/api\/dashboards\/([a-z][a-z0-9-]*)\/versions\/(\d+)$/.exec(path);
    if (method === 'GET' && versionPath) {
      const row = await deps.repo.version(versionPath[1], Number(versionPath[2]));
      if (!row) return json(404, { error: `no v${versionPath[2]} of ${versionPath[1]}` });
      return json(200, row);
    }

    const diffPath = /^\/api\/dashboards\/([a-z][a-z0-9-]*)\/diff$/.exec(path);
    if (method === 'GET' && diffPath) {
      const a = Number(req.query?.a);
      const b = Number(req.query?.b);
      const va = await deps.repo.version(diffPath[1], a);
      const vb = await deps.repo.version(diffPath[1], b);
      if (!va || !vb) return json(404, { error: 'both versions must exist' });
      return json(200, { diff: diffSpecs(va.spec as DashboardSpec, vb.spec as DashboardSpec) });
    }

    // ---- briefs ----------------------------------------------------------
    const briefPath = /^\/api\/dashboards\/([a-z][a-z0-9-]*)\/brief$/.exec(path);
    if (method === 'GET' && briefPath) {
      const brief = await deps.repo.latestBrief(briefPath[1]);
      if (!brief) return json(404, { error: `no brief exists for ${briefPath[1]}` });
      return json(200, { brief });
    }

    if (method === 'POST' && briefPath) {
      const row = await deps.repo.saveBrief({
        dashboardId: briefPath[1],
        content: body.brief,
        author,
        actor: identity,
      });
      return json(201, { brief: row });
    }

    const approvePath = /^\/api\/dashboards\/([a-z][a-z0-9-]*)\/brief\/approve$/.exec(path);
    if (method === 'POST' && approvePath) {
      // The entitlement, at the boundary: approval is a human act. The agent
      // holds no approver rights whatever headers it sends, because identity
      // is asserted by what fronts the process, not chosen by the caller.
      if (isAgent(identity)) {
        return json(403, {
          error: 'an agent session cannot approve a brief — approval is the human half '
            + 'of the maker-checker seam. Ask the requester to approve it in the studio.',
        });
      }
      const row = await deps.repo.approveBrief(approvePath[1], identity);
      return json(200, { brief: row });
    }

    // ---- proposals (E3.1) ------------------------------------------------
    if (method === 'POST' && path === '/api/proposals') {
      const id = String(body.id ?? '');
      const yaml = String(body.yaml ?? '');
      const rationale = String(body.rationale ?? '');
      if (!/^[a-z][a-z0-9-]*$/.test(id) || !yaml || rationale.length < 20) {
        return json(400, {
          error: 'a proposal needs a slug id, the KEEL YAML, and a rationale a steward can read '
            + '(at least 20 characters)',
        });
      }
      const set = await deps.contracts.current();
      const evidence = validateProposal(yaml, set.state);
      // The document names itself; the caller does not get to. A proposal for
      // an unparseable document still records, so the draft can be fixed.
      const row = await deps.repo.saveProposal({
        id,
        docName: evidence.docName ?? id,
        yaml,
        rationale,
        evidence,
        dashboardId: typeof body.dashboard_id === 'string' ? body.dashboard_id : null,
        author,
        actor: identity,
      });
      return json(201, { proposal: row, blockers: submitBlockers(evidence) });
    }

    if (method === 'GET' && path === '/api/proposals') {
      return json(200, { proposals: await deps.repo.proposals(req.query?.status) });
    }

    const proposalPath = /^\/api\/proposals\/([a-z][a-z0-9-]*)$/.exec(path);
    if (method === 'GET' && proposalPath) {
      const p = await deps.repo.proposal(proposalPath[1]);
      if (!p) return json(404, { error: `no proposal called ${proposalPath[1]}` });
      return json(200, { proposal: p, blockers: submitBlockers(p.evidence as ProposalEvidence) });
    }

    const submitPath = /^\/api\/proposals\/([a-z][a-z0-9-]*)\/submit$/.exec(path);
    if (method === 'POST' && submitPath) {
      const p = await deps.repo.proposal(submitPath[1]);
      if (!p) return json(404, { error: `no proposal called ${submitPath[1]}` });
      // Re-validate at submission: the workspace may have moved since drafting,
      // and the steward must see evidence for the world as it is now.
      const set = await deps.contracts.current();
      const evidence = validateProposal(p.yaml, set.state);
      await deps.repo.saveProposal({
        id: p.id, docName: p.docName, yaml: p.yaml, rationale: p.rationale,
        evidence, dashboardId: p.dashboardId, author: p.author, actor: identity,
      });
      const row = await deps.repo.submitProposal(p.id, identity, submitBlockers(evidence));
      return json(200, { proposal: row });
    }

    const decidePath = /^\/api\/proposals\/([a-z][a-z0-9-]*)\/decide$/.exec(path);
    if (method === 'POST' && decidePath) {
      // The steward is a human. Same boundary as brief approval: the agent
      // proposes and validates; a named person decides.
      if (isAgent(identity)) {
        return json(403, {
          error: 'an agent session cannot decide a proposal — steward review is the human half '
            + 'of the metric-governance seam. Ask the steward to decide it in the studio.',
        });
      }
      const decision = body.decision === 'approve' ? 'approved' : body.decision === 'reject' ? 'rejected' : null;
      const comment = String(body.comment ?? '');
      if (!decision || comment.length < 5) {
        return json(400, { error: 'a decision needs decision: approve|reject and a comment' });
      }
      const p = await deps.repo.proposal(decidePath[1]);
      if (!p) return json(404, { error: `no proposal called ${decidePath[1]}` });

      let evidence = p.evidence as ProposalEvidence;
      if (decision === 'approved') {
        // Approval's real act: the document enters the registry, authored by
        // the steward. If that write cannot happen, neither can the approval.
        const revision = await registerDocument(
          p.docName, p.yaml, identity,
          `Approved metric proposal ${p.id}: ${comment}`,
        );
        evidence = { ...evidence, registered: { name: p.docName, revision } };
      }
      const row = await deps.repo.decideProposal({
        id: p.id, decision, steward: identity, comment, evidence,
      });
      return json(200, { proposal: row });
    }

    // ---- approvals & promotion (E3.2) ------------------------------------
    const approvalsPath = /^\/api\/dashboards\/([a-z][a-z0-9-]*)\/approvals$/.exec(path);
    if (method === 'POST' && approvalsPath) {
      if (isAgent(identity)) {
        return json(403, { error: 'an agent session cannot approve — approvals are human acts' });
      }
      const track = String(body.track ?? '');
      const decision = body.decision === 'reject' ? 'reject' : 'approve';
      if (!['peer', 'design', 'data-owner'].includes(track)) {
        return json(400, { error: 'track must be peer, design, or data-owner' });
      }
      const dash = await deps.repo.dashboard(approvalsPath[1]);
      if (!dash) return json(404, { error: `no dashboard called ${approvalsPath[1]}` });
      await deps.repo.addApproval({
        dashboardId: approvalsPath[1], track, approver: identity,
        decision, comment: String(body.comment ?? ''),
      });
      return json(201, { approvals: await deps.repo.approvalState(approvalsPath[1]) });
    }

    const promotionPath = /^\/api\/dashboards\/([a-z][a-z0-9-]*)\/promotion$/.exec(path);
    if (method === 'GET' && promotionPath) {
      const checklist = await promotionChecklist(deps, promotionPath[1]);
      if (!checklist) return json(404, { error: `no dashboard called ${promotionPath[1]}` });
      return json(200, checklist);
    }

    const promotePath = /^\/api\/dashboards\/([a-z][a-z0-9-]*)\/promote$/.exec(path);
    if (method === 'POST' && promotePath) {
      // Promotion is a deployment decision — human-only, like every approval.
      if (isAgent(identity)) {
        return json(403, {
          error: 'an agent session cannot promote — promotion changes who a dashboard is for, '
            + 'and that is a human decision with human approvals behind it.',
        });
      }
      const checklist = await promotionChecklist(deps, promotePath[1]);
      if (!checklist) return json(404, { error: `no dashboard called ${promotePath[1]}` });
      const to = String(body.to ?? '');
      if (to !== checklist.next) {
        return json(422, {
          error: checklist.next
            ? `${promotePath[1]} is ${checklist.status}; the next stage is ${checklist.next}, not ${to || '(none)'}`
            : `${promotePath[1]} is already certified — there is no further stage`,
        });
      }
      const unmet = checklist.requirements.filter((r) => !r.met);
      // The refresh SLO is supplied at the moment of certification.
      const refreshSlo = String(body.refresh_slo ?? '');
      if (to === 'certified' && !refreshSlo) {
        unmet.push({ id: 'refresh-slo', label: 'a refresh SLO is declared', met: false });
      }
      if (unmet.length) {
        return json(422, {
          error: `not promotable to ${to} — the gate matrix is enforced here, whatever the studio showed`,
          unmet: unmet.map((r) => r.label),
        });
      }
      const row = await deps.repo.promote({
        dashboardId: promotePath[1],
        to: to as 'team' | 'certified',
        actor: identity,
        lintReport: checklist.lintAtTarget!,
      });
      if (to === 'certified') {
        await deps.repo.addExposure({
          dashboardId: promotePath[1], specHash: row.specHash,
          refreshSlo, registeredBy: identity,
        });
      }
      return json(200, {
        dashboard: await deps.repo.dashboard(promotePath[1]),
        version: row.version,
        exposures: to === 'certified' ? await deps.repo.exposures(promotePath[1]) : [],
      });
    }

    // ---- upgrade notifications (E3.4) ------------------------------------
    const upgradesPath = /^\/api\/dashboards\/([a-z][a-z0-9-]*)\/upgrades$/.exec(path);
    if (method === 'GET' && upgradesPath) {
      const latest = await deps.repo.latest(upgradesPath[1]);
      if (!latest) return json(404, { error: `no versions of ${upgradesPath[1]}` });
      const set = await deps.contracts.current();
      const notices = await upgradeNotices(latest.spec as DashboardSpec, set.state);
      return json(200, { upgrades: notices });
    }

    const auditPath = /^\/api\/dashboards\/([a-z][a-z0-9-]*)\/audit$/.exec(path);
    if (method === 'GET' && auditPath) {
      return json(200, { audit: await deps.repo.auditLog('dashboard', auditPath[1]) });
    }

    return json(404, { error: `no route ${method} ${path}` });
  } catch (e) {
    if (e instanceof Invalid) return json(422, { error: e.message, problems: e.problems });
    if (e instanceof Forbidden) return json(403, { error: e.message });
    if (e instanceof Conflict) return json(409, { error: e.message });
    if (e instanceof NotFound) return json(404, { error: e.message });
    if (e instanceof QueryUnresolved) return json(404, { error: e.message });
    if (e instanceof QueryRefused) return json(422, { error: e.message });
    return json(500, { error: e instanceof Error ? e.message : 'unknown error' });
  }
}
