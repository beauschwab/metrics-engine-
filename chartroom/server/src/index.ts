/**
 * The Chartroom server process — :8788, next door to the registry on :8787.
 *
 * Same posture as the registry's entry point: SQLite by default so a colleague
 * who clones this gets a working studio with nothing to configure, MSSQL by
 * explicit env, a bounded request body, and identity taken from a header the
 * proxy asserts — never from the payload.
 */

import { createServer } from 'node:http';
import { migrate, openMssql, openSqlite, type Db } from '../../../server/db';
import { handle, ContractCache, type ApiRequest } from './api';
import { chartroomDialect } from './dialect';
import { fetchRegistryState } from './keel';
import { QueryService } from './query';
import { ChartroomRepository } from './repository';
import { seedDogfood } from './seed';

const PORT = Number(process.env.CHARTROOM_PORT || 8788);
const MAX_BODY = Number(process.env.CHARTROOM_MAX_BODY || 1_048_576);

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is required when CHARTROOM_DB=mssql`);
  return v;
}

export async function connect(): Promise<Db> {
  const which = process.env.CHARTROOM_DB === 'mssql' ? 'mssql' : 'sqlite';
  const dialect = chartroomDialect(which);
  if (which === 'mssql') {
    return openMssql(
      {
        server: required('CHARTROOM_MSSQL_SERVER'),
        database: required('CHARTROOM_MSSQL_DATABASE'),
        user: process.env.CHARTROOM_MSSQL_USER,
        password: process.env.CHARTROOM_MSSQL_PASSWORD,
        encrypt: process.env.CHARTROOM_MSSQL_ENCRYPT !== 'false',
        trustServerCertificate: process.env.CHARTROOM_MSSQL_TRUST_CERT === 'true',
      },
      dialect,
    );
  }
  return openSqlite(process.env.CHARTROOM_SQLITE_FILE || 'chartroom.db', dialect);
}

function readBody(req: import('node:http').IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(Object.assign(new Error('payload too large'), { tooLarge: true }));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve(undefined);
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        reject(new Error('body is not JSON'));
      }
    });
    req.on('error', reject);
  });
}

async function main(): Promise<void> {
  const db = await connect();
  await migrate(db);

  const state = await fetchRegistryState();
  const deps = {
    repo: new ChartroomRepository(db),
    contracts: new ContractCache(),
    queries: new QueryService({ state }),
  };

  const seeded = await seedDogfood(deps.repo, state);
  if (seeded.length) console.log(`seeded dogfood dashboards: ${seeded.join(', ')}`);

  // The query cache keys on workspace identity; refresh it as the registry
  // moves so pinned-latest queries follow saves within a few seconds.
  setInterval(() => {
    void fetchRegistryState().then((s) => deps.queries.setState(s));
  }, 5_000).unref();

  const server = createServer(async (req, res) => {
    const cors: Record<string, string> = {
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'GET, POST, OPTIONS',
      'access-control-allow-headers': 'content-type, x-identity, x-principal',
    };
    if (req.method === 'OPTIONS') {
      res.writeHead(204, cors);
      res.end();
      return;
    }

    let body: unknown;
    try {
      body = await readBody(req);
    } catch (e) {
      const tooLarge = !!(e as { tooLarge?: boolean }).tooLarge;
      res.writeHead(tooLarge ? 413 : 400, { 'content-type': 'application/json', ...cors });
      res.end(JSON.stringify({ error: (e as Error).message }));
      return;
    }

    const url = new URL(req.url || '/', 'http://localhost');
    const request: ApiRequest = {
      method: req.method || 'GET',
      path: url.pathname,
      query: Object.fromEntries(url.searchParams),
      body,
      identity: (req.headers['x-identity'] as string | undefined) || null,
      principal: (req.headers['x-principal'] as string | undefined) || null,
    };

    const out = await handle(request, deps);
    res.writeHead(out.status, { 'content-type': 'application/json', ...cors });
    res.end(JSON.stringify(out.body));
  });

  server.listen(PORT, () => {
    console.log(`chartroom-server on :${PORT} (db: ${db.dialect.name}, registry: ${state.source})`);
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
