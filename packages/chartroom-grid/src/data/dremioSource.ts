/**
 * Dremio over its REST SQL API (ADR-70): submit, poll the job, page the
 * results. The API takes no parameters, so the Dremio dialect inlines
 * escaped literals and this executor refuses a statement that arrives with
 * parameters — a value that reached the wire unescaped would be the one
 * SQL-injection path this package has, and it is closed at compile time.
 *
 * `fetch` is injected so a test can be the transport, and so a host can
 * route through its own proxy. Arrow Flight is the faster wire; it is a
 * gRPC client, which a browser cannot be, so the Flight path belongs to a
 * server-side executor (the API's Python agent already speaks it) — the
 * seam is the same `SqlExecutor`.
 */

import { DREMIO } from './compileSql';
import type { Position } from './mock';
import type { DataSource } from './source';
import { sqlSource, type SqlExecutor } from './sqlSource';

export interface DremioOptions {
  /** e.g. https://dremio.example.com:9047 */
  baseUrl: string;
  /** A personal access token; sent as a Bearer token. */
  token: string;
  fetch?: typeof fetch;
  /** Milliseconds between job polls. */
  pollMs?: number;
  pageSize?: number;
  /** Give up on a job after this many polls. */
  maxPolls?: number;
}

interface JobStatus {
  jobState: 'NOT_SUBMITTED' | 'STARTING' | 'RUNNING' | 'COMPLETED' | 'CANCELED' | 'FAILED' | 'CANCELLATION_REQUESTED' | 'ENQUEUED' | 'PLANNING';
  rowCount?: number;
  errorMessage?: string;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function createDremioExecutor({
  baseUrl, token, fetch: doFetch = globalThis.fetch, pollMs = 250, pageSize = 500, maxPolls = 240,
}: DremioOptions): SqlExecutor {
  const base = baseUrl.replace(/\/+$/, '');
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  const call = async <T>(path: string, init?: RequestInit): Promise<T> => {
    const res = await doFetch(`${base}${path}`, { ...init, headers: { ...headers, ...(init?.headers ?? {}) } });
    if (!res.ok) throw new Error(`Dremio ${init?.method ?? 'GET'} ${path} answered ${res.status}`);
    return (await res.json()) as T;
  };
  return {
    async run(sql, params) {
      if (params.length) throw new RangeError('the Dremio executor takes no parameters; compile with the DREMIO dialect');
      const { id } = await call<{ id: string }>('/api/v3/sql', { method: 'POST', body: JSON.stringify({ sql }) });
      let status: JobStatus | undefined;
      for (let i = 0; i < maxPolls; i++) {
        status = await call<JobStatus>(`/api/v3/job/${encodeURIComponent(id)}`);
        if (status.jobState === 'COMPLETED') break;
        if (status.jobState === 'FAILED' || status.jobState === 'CANCELED') {
          throw new Error(`Dremio job ${id} ${status.jobState.toLowerCase()}${status.errorMessage ? `: ${status.errorMessage}` : ''}`);
        }
        await sleep(pollMs);
      }
      if (status?.jobState !== 'COMPLETED') throw new Error(`Dremio job ${id} did not complete in time`);
      const total = status.rowCount ?? 0;
      const rows: Array<Record<string, unknown>> = [];
      for (let offset = 0; offset < total; offset += pageSize) {
        const page = await call<{ rows: Array<Record<string, unknown>> }>(
          `/api/v3/job/${encodeURIComponent(id)}/results?offset=${offset}&limit=${pageSize}`,
        );
        rows.push(...page.rows);
        if (page.rows.length < pageSize) break;
      }
      return rows;
    },
  };
}

export function dremioSource(options: DremioOptions & { table: string; name?: string }): DataSource<Position> {
  return sqlSource({ executor: createDremioExecutor(options), table: options.table, dialect: DREMIO, name: options.name ?? 'Dremio' });
}
