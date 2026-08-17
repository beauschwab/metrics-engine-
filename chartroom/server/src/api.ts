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
import { deriveContracts, fetchRegistryState, type ContractSet } from './keel';
import { QueryRefused, QueryUnresolved, QueryService, type QueryRequest } from './query';
import { ChartroomRepository, Conflict, Invalid, NotFound } from './repository';

export interface ApiRequest {
  method: string;
  path: string;
  query?: Record<string, string>;
  body?: unknown;
  /** Asserted by whatever fronts the process — never chosen by the client. */
  identity?: string | null;
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

export async function handle(req: ApiRequest, deps: ApiDeps): Promise<ApiResponse> {
  const { method, path } = req;
  const body = (req.body ?? {}) as Record<string, unknown>;
  const identity = req.identity || 'anonymous';

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
        author: identity,
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

    const auditPath = /^\/api\/dashboards\/([a-z][a-z0-9-]*)\/audit$/.exec(path);
    if (method === 'GET' && auditPath) {
      return json(200, { audit: await deps.repo.auditLog('dashboard', auditPath[1]) });
    }

    return json(404, { error: `no route ${method} ${path}` });
  } catch (e) {
    if (e instanceof Invalid) return json(422, { error: e.message, problems: e.problems });
    if (e instanceof Conflict) return json(409, { error: e.message });
    if (e instanceof NotFound) return json(404, { error: e.message });
    if (e instanceof QueryUnresolved) return json(404, { error: e.message });
    if (e instanceof QueryRefused) return json(422, { error: e.message });
    return json(500, { error: e instanceof Error ? e.message : 'unknown error' });
  }
}
