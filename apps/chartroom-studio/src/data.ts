/**
 * The studio's data layer — plain fetch with a module-level cache (ADR-11).
 *
 * The one behaviour that had to survive dropping TanStack Query: two widgets
 * binding the same slice cost one request. `runQuery` keys on the resolved
 * request and keeps in-flight promises, mirroring the server cache — the
 * server's is the guarantee, this one just saves the wire.
 */

import type {
  DashboardSpec, LintReport, MetricContract, SpecDiff, WidgetContract,
} from 'chartroom-spec';
import type { QueryRequest, QueryResult } from './bindings';

const IDENTITY = 'studio-author';

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: {
      'content-type': 'application/json',
      'x-identity': IDENTITY,
      ...(init?.headers ?? {}),
    },
  });
  const body = (await res.json()) as T & { error?: string; problems?: string[] };
  if (!res.ok) {
    const detail = body.problems?.length ? ` — ${body.problems.join('; ')}` : '';
    throw new Error(`${body.error || res.statusText}${detail}`);
  }
  return body;
}

// ---- catalog ---------------------------------------------------------------

export interface ContractSummary {
  ref: string;
  doc: string;
  measure: string;
  version: number;
  status: 'draft' | 'approved' | 'deprecated';
  grain: string;
  unit: string;
  precision: number;
  format: string;
  denominator_of: string | null;
  dims: Array<{ name: string; type: string; ordinal: boolean }>;
  owner: string;
  description: string | null;
}

export const loadContracts = () =>
  api<{ source: string; contracts: ContractSummary[] }>('/api/contracts');

export const loadContract = (ref: string) =>
  api<{ contract: MetricContract }>(`/api/contracts/${encodeURIComponent(ref)}`);

/** The as-of dates the engine can actually evaluate, and the bases. */
export interface Calendar {
  dates: string[];
  latest: string;
  bases: Array<'prior_day' | 'prior_week' | 'month_end'>;
}

export const loadCalendar = () => api<Calendar>('/api/calendar');

/** The catalog patterns, as the composer's `#` references. */
export interface PatternSummary {
  pattern: string;
  version: number;
  title: string;
  serves: string;
}

export const loadPatterns = () =>
  api<{ patterns: PatternSummary[] }>('/api/patterns');

/** Variance-monitor breaches at one as-of — the strip's value-level rows. */
export interface MonitorException {
  monitor: string;
  threshold: string;
  severity: 'error' | 'warn' | 'info';
  key: string;
  date: string;
  message: string;
}

export const loadExceptions = (asOf: string | null) =>
  api<{ exceptions: MonitorException[] }>(
    `/api/exceptions${asOf ? `?as_of=${encodeURIComponent(asOf)}` : ''}`,
  );

export const loadWidgets = () =>
  api<{ widgets: WidgetContract[]; unrenderable?: string[] }>('/api/widgets');

// ---- queries ---------------------------------------------------------------

const inflight = new Map<string, Promise<QueryResult>>();
const cache = new Map<string, QueryResult>();

export function runQuery(req: QueryRequest): Promise<QueryResult> {
  const key = JSON.stringify(req);
  const hit = cache.get(key);
  if (hit) return Promise.resolve(hit);
  const running = inflight.get(key);
  if (running) return running;
  const p = api<QueryResult>('/api/query', { method: 'POST', body: JSON.stringify(req) })
    .then((r) => {
      cache.set(key, r);
      if (cache.size > 200) cache.delete(cache.keys().next().value as string);
      return r;
    })
    .finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}

/** Editing changed the workspace's meaning for nobody — but a save may have. */
export function dropQueryCache(): void {
  cache.clear();
}

// ---- dashboards ------------------------------------------------------------

export interface DashboardSummary {
  id: string;
  title: string;
  status: string;
  owner: string;
  createdAt: string;
}

export interface VersionPayload {
  version: number;
  spec: DashboardSpec;
  specHash: string;
  author: string;
  lintReport: LintReport;
  createdAt: string;
}

export const loadDashboards = () =>
  api<{ dashboards: DashboardSummary[] }>('/api/dashboards');

export const loadDashboard = (id: string) =>
  api<{ dashboard: DashboardSummary; latest: VersionPayload | null }>(`/api/dashboards/${id}`);

export const saveVersion = (id: string, spec: DashboardSpec, expectedVersion: number | null) =>
  api<{ version: number; specHash: string; lintReport: LintReport }>(
    `/api/dashboards/${id}/versions`,
    { method: 'POST', body: JSON.stringify({ spec, expectedVersion }) },
  );

export const createDashboard = (id: string, title: string) =>
  api<{ dashboard: DashboardSummary }>('/api/dashboards', {
    method: 'POST', body: JSON.stringify({ id, title }),
  });

export const loadDiff = (id: string, a: number, b: number) =>
  api<{ diff: SpecDiff }>(`/api/dashboards/${id}/diff?a=${a}&b=${b}`);
