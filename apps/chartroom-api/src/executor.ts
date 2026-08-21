/**
 * WarehouseExecutor (E8.2, ADR-40): queries answered by the Python service's
 * `/query/run` — DuckDB in dev, Dremio (Flight SQL, PAT) in prod — behind the
 * same QueryService cache and refusal vocabulary as the fixture path.
 *
 * One documented limit of the warehouse path in this phase (ADR-40): pinned
 * revisions older than the workspace's latest are refused — the warehouse
 * materializes the latest semantic definitions only. Derivation-emitted
 * columns (classifications, buckets, rate lookups) group and filter fine:
 * the manifest ships the engine's row stage as SQL.
 *
 * Context params resolve to literal filters *here*, before the wire — the
 * Python side never sees a param, so there is exactly one resolution path.
 */

import { parseMetricRef } from 'chartroom-spec';
import type { FilterExpr } from 'chartroom-spec';
import type { RegistryState } from './keel';
import {
  QueryRefused, QueryUnresolved,
  type QueryExecutor, type QueryRequest, type QueryResult,
} from './query';

export type WarehouseBackend = 'duckdb' | 'dremio';

const AGENT_URL = () => process.env.CHARTROOM_AGENT_URL || 'http://127.0.0.1:8789';

type LiteralFilter =
  | { dim: string; op: '=' | '!='; value: string | number | boolean }
  | { dim: string; op: 'in'; value: Array<string | number> };

function literalize(filters: FilterExpr[], params: Record<string, string>): LiteralFilter[] {
  return filters.map((f) => {
    if ('param' in f) {
      const v = params[f.param];
      if (v === undefined) {
        throw new QueryRefused(`filter on ${f.dim} reads param "${f.param}", which was not supplied`);
      }
      return { dim: f.dim, op: '=' as const, value: v };
    }
    return f as LiteralFilter;
  });
}

export class WarehouseExecutor implements QueryExecutor {
  constructor(
    public readonly name: WarehouseBackend,
    private state: () => RegistryState,
  ) {}

  async run(req: QueryRequest): Promise<QueryResult> {
    const ref = parseMetricRef(req.metric);
    if (!ref) throw new QueryUnresolved(`${req.metric} is not a keel:// metric ref`);
    const doc = this.state().docs.find((d) => d.name === ref.doc);
    if (!doc) throw new QueryUnresolved(`${ref.doc} is not in the workspace`);
    if (doc.revision !== ref.version) {
      throw new QueryUnresolved(
        `${req.metric} pins revision ${ref.version}, but the ${this.name} backend serves the `
        + `latest (${doc.revision}) — re-pin, or run with CHARTROOM_BACKEND=fixtures`,
      );
    }

    const days = req.window ? /^(\d+)d$/.exec(req.window.trailing)?.[1] : undefined;
    if (req.window && !days) {
      throw new QueryRefused(`bad window ${req.window.trailing} — day counts only, like 60d`);
    }

    let res: Response;
    try {
      res = await fetch(`${AGENT_URL()}/query/run`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          backend: this.name,
          doc: ref.doc,
          measure: ref.measure,
          dims: req.dims ?? [],
          filters: literalize(req.filters ?? [], req.params ?? {}),
          window_days: days ? Number(days) : null,
          max_cells: req.max_cells ?? null,
        }),
      });
    } catch {
      throw new QueryRefused(
        `the ${this.name} backend is unreachable (chartroom-agent, ${AGENT_URL()}) — `
        + 'start it, or run with CHARTROOM_BACKEND=fixtures',
      );
    }

    const body = await res.json() as QueryResult & { error?: string };
    if (res.status === 404) throw new QueryUnresolved(body.error ?? 'unresolved');
    if (!res.ok) throw new QueryRefused(body.error ?? `the ${this.name} backend said ${res.status}`);
    return body;
  }
}
