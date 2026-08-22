/**
 * The server entry point.
 *
 * SQLite in development, SQL Server in production, chosen by `KEEL_DB` and
 * defaulting to SQLite. The default is deliberate: a colleague who clones this
 * and runs `npm run server` gets a working registry with no connection string
 * to find, and nothing that reaches the network.
 *
 * A production misconfiguration should not fall back to a file. `KEEL_DB=mssql`
 * with a missing `KEEL_MSSQL_SERVER` refuses to start rather than quietly
 * writing governed rule changes to a SQLite file nobody backs up.
 */

import { createServer } from 'node:http';
import { pathToFileURL } from 'node:url';
import { chatFrames } from './agent';
import { handle, type ApiRequest } from './api';
import { migrate, openMssql, openSqlite, type Db } from './db';
import { dialectFor, type DialectName } from './dialect';
import { dremioFromEnv } from './query';
import { Repository } from './repository';
import { INITIAL_DOCS, VIEW_FILES } from 'keel-engine/documents';
import { parseDoc } from 'keel-engine/parse';

const PORT = Number(process.env.KEEL_PORT || 8787);

/**
 * The most a request body may be.
 *
 * A document is a few kilobytes; a megabyte is already absurd. Without a bound,
 * one unauthenticated request can make the process allocate until it dies —
 * cheap to send, and the registry is the thing every author depends on.
 */
const MAX_BODY = Number(process.env.KEEL_MAX_BODY || 1_048_576);

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is required when KEEL_DB=mssql`);
  return v;
}

export async function connect(): Promise<Db> {
  const which = (process.env.KEEL_DB || 'sqlite') as DialectName;
  const dialect = dialectFor(which);

  if (which === 'mssql') {
    return openMssql(
      {
        server: required('KEEL_MSSQL_SERVER'),
        database: required('KEEL_MSSQL_DATABASE'),
        user: process.env.KEEL_MSSQL_USER,
        password: process.env.KEEL_MSSQL_PASSWORD,
        port: process.env.KEEL_MSSQL_PORT ? Number(process.env.KEEL_MSSQL_PORT) : undefined,
        encrypt: process.env.KEEL_MSSQL_ENCRYPT !== 'false',
        trustServerCertificate: process.env.KEEL_MSSQL_TRUST_CERT === 'true',
      },
      dialect,
    );
  }

  return openSqlite(process.env.KEEL_SQLITE_FILE || 'keel.db', dialect);
}

/** The shipped documents, with the kind read off each one rather than guessed. */
export function shippedDocuments(): Array<{ name: string; kind: string; body: string }> {
  return VIEW_FILES.map((name) => ({
    name,
    kind: parseDoc(INITIAL_DOCS[name]).kind,
    body: INITIAL_DOCS[name],
  }));
}

export class BodyTooLarge extends Error {}

export async function readBody(req: AsyncIterable<Buffer>): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    // Stop reading rather than finish and then complain — the point of the
    // limit is to not hold the bytes.
    if (size > MAX_BODY) throw new BodyTooLarge(`body exceeds ${MAX_BODY} bytes`);
    chunks.push(chunk as Buffer);
  }
  if (!chunks.length) return undefined;
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    return null;
  }
}

export async function main(): Promise<void> {
  const db = await connect();
  await migrate(db);
  const repo = new Repository(db);
  const seeded = await repo.seed(shippedDocuments());

  // Null unless KEEL_DREMIO_URI is set, which is the ordinary way to run this:
  // the surface falls back to fixtures and the live routes answer 503 saying
  // exactly which variable is missing.
  const dremio = dremioFromEnv(process.env as Record<string, string | undefined>);

  console.log(`keel registry on ${db.dialect.name}` + (seeded ? `, seeded ${seeded} artifacts` : ''));
  console.log(
    dremio
      ? `warehouse ${dremio.uri} — sampling ${dremio.sampling}, cap ${dremio.rowCap} rows`
      : 'no warehouse configured — set KEEL_DREMIO_URI to read real data',
  );

  const server = createServer(async (req, res) => {
    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    const query: Record<string, string> = {};
    url.searchParams.forEach((v, k) => {
      query[k] = v;
    });

    // The dev server and the API are separate origins under `vite dev`.
    res.setHeader('Access-Control-Allow-Origin', process.env.KEEL_CORS_ORIGIN || '*');
    res.setHeader('Access-Control-Allow-Headers', 'content-type');
    res.setHeader('Access-Control-Allow-Methods', 'GET,PUT,POST,OPTIONS');
    if (req.method === 'OPTIONS') {
      res.writeHead(204).end();
      return;
    }

    // Identity comes from a header the front door sets, never from the body.
    // `KEEL_IDENTITY_HEADER` names it; unset means nobody is asserting one, and
    // saves land as `unknown` rather than as a name the client picked.
    const identityHeader = (process.env.KEEL_IDENTITY_HEADER || '').toLowerCase();
    const asserted = identityHeader ? req.headers[identityHeader] : undefined;

    const method = req.method || 'GET';
    let body: unknown;
    try {
      body = method === 'PUT' || method === 'POST' ? await readBody(req) : undefined;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      res.writeHead(413, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: message }));
      return;
    }

    // The definition agent streams SSE — a transport the pure handle()
    // contract doesn't model, so it gets its own route here, exactly as the
    // studio's API does for its chat (ADR-56). Everything else stays JSON
    // through handle().
    if (method === 'POST' && url.pathname === '/api/chat') {
      res.writeHead(200, {
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache',
        connection: 'keep-alive',
      });
      const abort = new AbortController();
      req.on('close', () => abort.abort());
      for await (const chunk of chatFrames(body, abort.signal)) {
        res.write(chunk);
      }
      res.end();
      return;
    }

    const request: ApiRequest = {
      method,
      path: url.pathname,
      query,
      identity: Array.isArray(asserted) ? asserted[0] : asserted || null,
      body,
    };

    const { status, body: out } = await handle(repo, request, { dremio });
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(out));
  });

  server.listen(PORT, () => console.log(`listening on http://localhost:${PORT}`));

  const shutdown = async () => {
    server.close();
    await db.close();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

// Only when run directly, so the module can be imported by tests.
// Run directly, not imported. Compared as a resolved URL rather than matched
// against the path: this was a regex on the file's own location, which silently
// stopped matching the moment the file moved — `main()` never ran, the process
// exited 0, and the only symptom was a downstream suite waiting 60s for a
// server that was never going to listen.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}
