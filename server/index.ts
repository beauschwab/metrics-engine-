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
import { handle, type ApiRequest } from './api';
import { migrate, openMssql, openSqlite, type Db } from './db';
import { dialectFor, type DialectName } from './dialect';
import { Repository } from './repository';
import { INITIAL_DOCS, VIEW_FILES } from '../src/engine/documents';
import { parseDoc } from '../src/engine/parse';

const PORT = Number(process.env.KEEL_PORT || 8787);

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

async function readBody(req: import('node:http').IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
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

  console.log(`keel registry on ${db.dialect.name}` + (seeded ? `, seeded ${seeded} artifacts` : ''));

  const server = createServer(async (req, res) => {
    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    const query: Record<string, string> = {};
    url.searchParams.forEach((v, k) => {
      query[k] = v;
    });

    // The dev server and the API are separate origins under `vite dev`.
    res.setHeader('Access-Control-Allow-Origin', process.env.KEEL_CORS_ORIGIN || '*');
    res.setHeader('Access-Control-Allow-Headers', 'content-type');
    res.setHeader('Access-Control-Allow-Methods', 'GET,PUT,OPTIONS');
    if (req.method === 'OPTIONS') {
      res.writeHead(204).end();
      return;
    }

    const request: ApiRequest = {
      method: req.method || 'GET',
      path: url.pathname,
      query,
      body: req.method === 'PUT' ? await readBody(req) : undefined,
    };

    const { status, body } = await handle(repo, request);
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(body));
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
if (process.argv[1] && /server[/\\]index\.ts$/.test(process.argv[1])) {
  main().catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}
