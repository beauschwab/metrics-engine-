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

export interface ApiRequest {
  method: string;
  path: string;
  query?: Record<string, string>;
  body?: unknown;
}

export interface ApiResponse {
  status: number;
  body: unknown;
}

const json = (status: number, body: unknown): ApiResponse => ({ status, body });

function asString(v: unknown): string | null {
  return typeof v === 'string' ? v : null;
}

export async function handle(repo: Repository, req: ApiRequest): Promise<ApiResponse> {
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
        const author = asString(body.author) || 'unknown';
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

    return json(404, { error: `no route for ${method} ${path}` });
  } catch (err) {
    if (err instanceof Conflict) return json(409, { error: err.message });
    return json(500, { error: err instanceof Error ? err.message : String(err) });
  }
}
