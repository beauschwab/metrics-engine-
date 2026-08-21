/**
 * The HTTP surface, as a function from request to response.
 *
 * No framework, and more to the point no `http.Server` — `handle` takes a method,
 * a path, a query and a body and returns a status and a value. That is what lets
 * the API be tested at the same level it is written, without a port, a socket or
 * a teardown that leaks a listener into the next test file.
 *
 * Errors are mapped once, here. A conflict is a `409` and not a `500` because
 * "someone else saved first" is a thing the client can act on, and telling it
 * apart from a broken server is the difference between a retry and a page.
 */

import { Conflict, Repository } from './repository';
import {
  RuntimeNotFound, RuntimeRefused, cutRelease, promoteRelease, runtimeManifest,
  runtimePlan, runtimeRules,
} from './runtime';
import { NotFound as LiveNotFound, Refused, liveCoverage, liveReport, liveSample } from './live';
import { QueryFailed, QueryRefused, type DremioConfig } from './query';

export interface ApiRequest {
  method: string;
  path: string;
  query?: Record<string, string>;
  body?: unknown;
  /**
   * Who the request is from, as established by whatever sits in front of this.
   *
   * There is no identity provider yet, so this is whatever the reverse proxy or
   * SSO layer asserts — and the point of taking it here rather than from the
   * request body is that the client cannot choose it. An author attribution a
   * caller can set to any string is not an attribution, and under SR 11-7 the
   * name against a rule change is part of the control rather than a label.
   */
  identity?: string | null;
}

export interface ApiResponse {
  status: number;
  body: unknown;
}

const json = (status: number, body: unknown): ApiResponse => ({ status, body });

function asString(v: unknown): string | null {
  return typeof v === 'string' ? v : null;
}

/**
 * Everything the API needs beyond the registry itself.
 *
 * `dremio` is null when no warehouse is configured, which is the default and a
 * perfectly good way to run this — the surface falls back to fixtures and says
 * so, exactly as it does with no registry.
 */
export interface ApiDeps {
  dremio?: DremioConfig | null;
}

export async function handle(
  repo: Repository,
  req: ApiRequest,
  deps: ApiDeps = {},
): Promise<ApiResponse> {
  const { method, path } = req;
  const query = req.query || {};

  try {
    if (method === 'GET' && path === '/api/health') {
      return json(200, { ok: true });
    }

    // The workspace, optionally as it stood at a transaction time.
    if (method === 'GET' && path === '/api/artifacts') {
      const at = query.at;
      const rows = at ? await repo.workspaceAsOf(at) : await repo.workspace();
      return json(200, { asOf: at ?? null, artifacts: rows });
    }

    const one = /^\/api\/artifacts\/([A-Za-z0-9_.-]+)$/.exec(path);
    if (one) {
      const name = one[1];
      if (method === 'GET') {
        // `?revision=` reads a specific one; without it, the newest.
        const rev = query.revision;
        const found = rev
          ? await repo.revision(name, Number(rev))
          : await repo.latest(name);
        return found ? json(200, found) : json(404, { error: `no such artifact: ${name}` });
      }

      if (method === 'PUT') {
        const body = (req.body || {}) as Record<string, unknown>;
        const text = asString(body.body);
        if (text === null) return json(400, { error: 'body is required and must be a string' });

        const kind = asString(body.kind) || 'metrics_view';
        // The proxy's assertion wins over anything the body claims. `unknown` is
        // deliberately not a friendly default: an unattributed rule change should
        // read as unattributed in the history, not as somebody plausible.
        const author = req.identity || asString(body.author) || 'unknown';
        const message = asString(body.message) || 'Edited in the authoring surface';
        const expected = body.expectedRevision;

        const result = await repo.save({
          name,
          kind,
          body: text,
          author,
          message,
          ...(typeof expected === 'number' ? { expectedRevision: expected } : {}),
        });
        // 200 rather than 201 even when a revision is created: the resource is
        // the artifact, and it already existed at this URL.
        return json(200, { name, ...result });
      }
    }

    const hist = /^\/api\/artifacts\/([A-Za-z0-9_.-]+)\/history$/.exec(path);
    if (hist && method === 'GET') {
      const entries = await repo.history(hist[1]);
      return entries.length
        ? json(200, { name: hist[1], history: entries })
        : json(404, { error: `no such artifact: ${hist[1]}` });
    }

    // --- releases, channels, and the runtime read path ----------------------

    if (method === 'GET' && path === '/api/releases') {
      return json(200, { releases: await repo.releases() });
    }

    if (method === 'POST' && path === '/api/releases') {
      const body = (req.body || {}) as Record<string, unknown>;
      const message = asString(body.message);
      if (!message) return json(400, { error: 'message is required — a release with no reason is not a record' });
      const release = await cutRelease(repo, {
        ...(asString(body.name) ? { name: asString(body.name)! } : {}),
        message,
        author: req.identity || 'unknown',
      });
      // 201: unlike a save, a release genuinely creates a new resource.
      return json(201, release);
    }

    const oneRelease = /^\/api\/releases\/(\d+)$/.exec(path);
    if (oneRelease && method === 'GET') {
      const found = await repo.release(Number(oneRelease[1]));
      return found ? json(200, found) : json(404, { error: `no release r${oneRelease[1]}` });
    }

    if (method === 'GET' && path === '/api/channels') {
      return json(200, { channels: await repo.channels() });
    }

    const oneChannel = /^\/api\/channels\/([A-Za-z0-9_-]+)$/.exec(path);
    if (oneChannel) {
      if (method === 'GET') {
        const channel = await repo.channel(oneChannel[1]);
        if (!channel) return json(404, { error: `no channel called ${oneChannel[1]}` });
        return json(200, { ...channel, history: await repo.promotions(oneChannel[1]) });
      }
      if (method === 'PUT') {
        const body = (req.body || {}) as Record<string, unknown>;
        if (typeof body.version !== 'number') {
          return json(400, { error: 'version is required — a promotion names the release it deploys' });
        }
        const out = await promoteRelease(repo, {
          channel: oneChannel[1],
          version: body.version,
          actor: req.identity || 'unknown',
          message: asString(body.message) || 'Promoted',
          acknowledgeReview: body.acknowledgeReview === true,
        });
        return json(200, out);
      }
    }

    const rtManifest = /^\/api\/runtime\/([A-Za-z0-9_-]+)$/.exec(path);
    if (rtManifest && method === 'GET') {
      return json(200, await runtimeManifest(repo, rtManifest[1]));
    }

    const rtPlan = /^\/api\/runtime\/([A-Za-z0-9_-]+)\/plan\/([A-Za-z0-9_.-]+)$/.exec(path);
    if (rtPlan && method === 'GET') {
      const target = (query.target || 'sql') as 'sql' | 'polars' | 'pyspark';
      if (!['sql', 'polars', 'pyspark'].includes(target)) {
        return json(400, { error: `unknown target ${target} — one of sql, polars, pyspark` });
      }
      return json(200, await runtimePlan(repo, rtPlan[1], rtPlan[2], target, query.binding || undefined));
    }

    const rtRules = /^\/api\/runtime\/([A-Za-z0-9_-]+)\/rules\/([A-Za-z0-9_.-]+)$/.exec(path);
    if (rtRules && method === 'GET') {
      return json(200, await runtimeRules(repo, rtRules[1], rtRules[2], query.asOf || undefined));
    }

    // --- reading real data -------------------------------------------------

    if (path.startsWith('/api/live/')) {
      if (!deps.dremio) {
        return json(503, {
          error: 'no warehouse is configured — set KEEL_DREMIO_URI to read real data',
        });
      }
      const live = await handleLive(repo, req, deps.dremio);
      if (live) return live;
    }

    return json(404, { error: `no route for ${method} ${path}` });
  } catch (err) {
    if (err instanceof Conflict) return json(409, { error: err.message });
    // A refused statement and a refused sample are the caller asking for
    // something the registry will not do — distinct from the warehouse failing,
    // and distinct again from the registry being broken.
    if (err instanceof QueryRefused) return json(400, { error: err.message });
    // A refused promotion or adapter carries its findings so the caller can act
    // — or acknowledge — rather than re-deriving them.
    if (err instanceof RuntimeRefused) {
      return json(400, { error: err.message, issues: err.issues });
    }
    if (err instanceof RuntimeNotFound) return json(404, { error: err.message });
    if (err instanceof Refused) return json(403, { error: err.message });
    if (err instanceof LiveNotFound) return json(404, { error: err.message });
    // The warehouse's own words, at a status that says "not our fault".
    if (err instanceof QueryFailed) return json(502, { error: err.message });
    return json(500, { error: err instanceof Error ? err.message : String(err) });
  }
}

/**
 * The live-data routes.
 *
 * Split out because they share one thing the registry routes do not: they all
 * need the current workspace as text, and none of them may write.
 */
async function handleLive(
  repo: Repository,
  req: ApiRequest,
  dremio: DremioConfig,
): Promise<ApiResponse | null> {
  const { method, path } = req;
  const query = req.query || {};

  if (method === 'GET' && path === '/api/live/status') {
    return json(200, {
      configured: true,
      uri: dremio.uri,
      rowCap: dremio.rowCap,
      timeoutSeconds: dremio.timeoutSeconds,
      // Whether rows may leave the warehouse is worth stating plainly, so a
      // client can say "aggregates only" rather than discovering it via a 403.
      sampling: dremio.sampling,
      sampleViews: dremio.sampleAllowlist,
    });
  }

  const workspace = { docs: Object.fromEntries((await repo.workspace()).map((a) => [a.name, a.body])) };

  const report = /^\/api\/live\/report\/([A-Za-z0-9_.-]+)$/.exec(path);
  if (report && method === 'POST') {
    const result = await liveReport(dremio, workspace, report[1]);
    return json(200, result);
  }

  const coverage = /^\/api\/live\/coverage\/([A-Za-z0-9_.-]+)$/.exec(path);
  if (coverage && method === 'POST') {
    return json(200, await liveCoverage(dremio, workspace, coverage[1]));
  }

  const sample = /^\/api\/live\/sample\/([A-Za-z0-9_.-]+)$/.exec(path);
  if (sample && method === 'POST') {
    const body = (req.body || {}) as Record<string, unknown>;
    return json(200, await liveSample(dremio, workspace, sample[1], {
      asOf: typeof body.asOf === 'string' ? body.asOf : String(query.asOf || ''),
      ...(typeof body.perStratum === 'number' ? { perStratum: body.perStratum } : {}),
    }));
  }

  return null;
}
