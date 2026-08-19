/**
 * Query resolution — a binding becomes numbers, through one path.
 *
 * The aggregates-only boundary is structural: every response is either a
 * per-date series or a per-group scalar table, both produced by the engine's
 * own `Evaluator`. Row-level data has no representation in the response types,
 * so it cannot leak by accident.
 *
 * Grouping works by handing each group's membership predicate to the
 * Evaluator's `rowFilter` seam — the grouped value is computed by the same
 * code that computes the headline value. That is the drift-prevention story:
 * there is no "grouped evaluator" to disagree with the real one.
 *
 * The cache is keyed on (request, workspace-identity) and is single-flight:
 * two widgets binding the same slice — the common case, a tile and a trend on
 * one metric — cost one evaluation. Asserted by test with an injected counter.
 */

import { sha256Hex } from 'chartroom-spec';
import type { FilterExpr } from 'chartroom-spec';
import { Evaluator } from 'keel-engine/evaluate';
import { DATES, LAST, type Row } from 'keel-engine/fixtures';
import { buildRegistry } from 'keel-engine/registry';
import { compare as comparePred } from 'keel-engine/predicate';
import { resolveRef, type RegistryState } from './keel';

/** The index of the requested as-of date, or the latest close. */
function atIndex(asOf: string | undefined): number {
  if (!asOf) return LAST;
  const i = DATES.indexOf(asOf);
  return i === -1 ? LAST : i;
}

/**
 * The index `prior` reads from. Clamped at 0 rather than wrapping: at the
 * start of the fixture window there is no prior month to compare against, and
 * a delta of zero is the honest answer there — a negative index would silently
 * read `undefined` and render NaN.
 */
function priorIndex(at: number, basis: Basis | undefined): number {
  if (at === 0) return 0;
  if (basis === 'prior_week') return Math.max(0, at - 7);
  if (basis === 'month_end') {
    const month = DATES[at].slice(0, 7);
    for (let i = at - 1; i >= 0; i--) if (DATES[i].slice(0, 7) !== month) return i;
    return 0;
  }
  return at - 1;
}

/**
 * The dates the fixture range actually carries, plus the bases a delta can be
 * read against — the as-of picker's options. Served rather than hardcoded in
 * the studio, because a picker offering a date the engine cannot evaluate is
 * a control that fails on click.
 */
export function calendar(): { dates: string[]; latest: string; bases: readonly Basis[] } {
  return { dates: DATES, latest: DATES[LAST], bases: BASES };
}

export class QueryRefused extends Error {}
export class QueryUnresolved extends Error {}

export interface QueryRequest {
  metric: string;
  dims?: string[];
  filters?: FilterExpr[];
  /** `{ trailing: '60d' }` — series responses only. */
  window?: { trailing: string };
  /** Context params already resolved to values by the caller. */
  params?: Record<string, string>;
  /**
   * The date the reader is standing on. Absent means the latest close, which
   * is what every caller meant before the analyst surface could ask for
   * anything else. An unknown date resolves to the latest close rather than
   * erroring: a stale bookmark should show today's number, not a stack trace.
   */
  asOf?: string;
  /** What `prior` compares against — the delta every tile draws. */
  basis?: Basis;
  max_cells?: number;
}

/**
 * The comparison bases the analyst bar offers. `prior_day` is the historical
 * behaviour and stays the default, so an absent basis is not a behaviour
 * change for any caller that predates this.
 */
export const BASES = ['prior_day', 'prior_week', 'month_end'] as const;
export type Basis = (typeof BASES)[number];

export interface SeriesPoint { date: string; value: number }
export interface SeriesResult {
  kind: 'series';
  unit: string;
  format: string;
  series: Array<{ key: Record<string, string>; points: SeriesPoint[] }>;
  asOf: string;
  cost: Cost;
}
export interface GroupRow {
  key: Record<string, string>;
  value: number;
  /** The previous date's value — delta tables read it, nobody re-queries. */
  prior: number;
}
export interface GroupResult {
  kind: 'groups';
  unit: string;
  format: string;
  rows: GroupRow[];
  asOf: string;
  cost: Cost;
}
export interface ScalarResult {
  kind: 'scalar';
  unit: string;
  format: string;
  value: number;
  prior: number;
  asOf: string;
  cost: Cost;
}
export type QueryResult = SeriesResult | GroupResult | ScalarResult;

export interface Cost {
  rowsScanned: number;
  groups: number;
  cache: 'hit' | 'miss';
}

const MAX_CELLS_DEFAULT = 50_000;

// ---------------------------------------------------------------------------

function filterFn(filters: FilterExpr[], params: Record<string, string>): (r: Row) => boolean {
  const resolved = filters.map((f) => {
    if ('param' in f) {
      const v = params[f.param];
      if (v === undefined) {
        throw new QueryRefused(`filter on ${f.dim} reads param "${f.param}", which was not supplied`);
      }
      return { dim: f.dim, op: '=' as const, value: v };
    }
    return f;
  });
  return (row) =>
    resolved.every((f) => {
      const have = row[f.dim];
      if (f.op === 'in') return (f.value as Array<string | number>).some((v) => comparePred(have, '=', v));
      return comparePred(have, f.op, f.value as string | number | boolean);
    });
}

const keyOf = (dims: string[], row: Row): Record<string, string> =>
  Object.fromEntries(dims.map((d) => [d, String(row[d])]));

const keyId = (key: Record<string, string>) =>
  Object.keys(key).sort().map((k) => `${k}=${key[k]}`).join('');

function windowDays(w?: { trailing: string }): number | null {
  if (!w) return null;
  const m = /^(\d+)d$/.exec(w.trailing);
  if (!m) throw new QueryRefused(`bad window ${w.trailing} — day counts only, like 60d`);
  return Number(m[1]);
}

// ---------------------------------------------------------------------------

export interface EvalDeps {
  state: RegistryState;
  /** Test seam: counts real evaluations under the cache. */
  onEvaluate?: () => void;
}

/**
 * The executor seam (E8.1, ADR-39): the cache and refusal vocabulary above
 * stay put; what computes a result is pluggable. `FixtureExecutor` is the
 * in-process Evaluator path — kept forever, because it is the test oracle
 * every other backend must agree with. `WarehouseExecutor` (below) delegates
 * to the Python service. A streaming backend slots in here later (ADR-30)
 * without touching widgets.
 */
export interface QueryExecutor {
  name: string;
  run(req: QueryRequest): Promise<QueryResult>;
}

async function evaluate(req: QueryRequest, deps: EvalDeps): Promise<QueryResult> {
  deps.onEvaluate?.();
  const resolved = await resolveRef(req.metric, deps.state);
  if (!resolved) {
    throw new QueryUnresolved(
      `${req.metric} does not resolve — check the name and pinned revision`
      + (deps.state.source === 'shipped'
        ? ' (running against shipped documents: only the current revision exists)'
        : ''),
    );
  }
  const { graph, docs, measure } = resolved;
  const registry = buildRegistry(docs);
  const m = graph.byName[measure];
  const format = (m.f.format || 'number').trim();
  const unit = format.startsWith('percent') ? 'percent' : format.startsWith('currency') ? 'USD' : 'number';

  const base = filterFn(req.filters ?? [], req.params ?? {});
  const dims = req.dims ?? [];
  const timeDims = dims.filter((d) => d === 'as_of_date');
  const catDims = dims.filter((d) => d !== 'as_of_date');

  // Group membership comes from the *derived* rows at the as-of date, so a
  // classification's emitted column groups exactly like a source column.
  const at = atIndex(req.asOf);
  const priorAt = priorIndex(at, req.basis);

  const probe = new Evaluator(graph, 'nominal', registry, base);
  const derivedRows = probe.rowsFor(DATES[at]).rows;
  const scanned = derivedRows.length;

  const groups = new Map<string, Record<string, string>>();
  if (catDims.length) {
    for (const row of derivedRows) {
      const key = keyOf(catDims, row);
      groups.set(keyId(key), key);
    }
  }

  const cap = req.max_cells ?? MAX_CELLS_DEFAULT;
  if (groups.size > cap) {
    throw new QueryRefused(
      `${groups.size.toLocaleString('en-US')} groups exceeds the ${cap.toLocaleString('en-US')} cell guard`,
    );
  }

  // Every group shares the probe's row stage: derivations and classification
  // run once per date, and a group evaluator differs only in its filter. The
  // probe already applied `base`, so group filters are the group key alone.
  const rowSource = (date: string) => probe.rowsFor(date);
  const evaluatorFor = (key: Record<string, string> | null) =>
    key
      ? new Evaluator(graph, 'nominal', registry,
        (row) => catDims.every((d) => String(row[d]) === key[d]), rowSource)
      : probe;

  const asOf = DATES[at];
  const cost: Cost = { rowsScanned: scanned, groups: groups.size || 1, cache: 'miss' };

  // Series request: the widget plots time.
  if (timeDims.length) {
    const days = windowDays(req.window);
    // The window ends at the as-of date, not at the end of the fixture range:
    // standing on an earlier date must not draw a line into its future.
    const end = at + 1;
    const from = days === null ? 0 : Math.max(0, end - days);
    const sliced = (s: number[]): SeriesPoint[] =>
      DATES.slice(from, end).map((date, i) => ({ date, value: s[from + i] }));

    const series = catDims.length
      ? [...groups.values()].map((key) => ({
        key, points: sliced(evaluatorFor(key).series(measure).s),
      }))
      : [{ key: {}, points: sliced(evaluatorFor(null).series(measure).s) }];
    return { kind: 'series', unit, format, series, asOf, cost };
  }

  // Grouped scalar request: the widget compares categories.
  if (catDims.length) {
    const rows: GroupRow[] = [...groups.values()].map((key) => {
      const s = evaluatorFor(key).series(measure).s;
      return { key, value: s[at], prior: s[priorAt] };
    });
    return { kind: 'groups', unit, format, rows, asOf, cost };
  }

  // No dims: the headline number.
  const s = evaluatorFor(null).series(measure).s;
  return { kind: 'scalar', unit, format, value: s[at], prior: s[priorAt], asOf, cost };
}

// ---------------------------------------------------------------------------
// The cache: keyed on request + workspace identity, single-flight, small LRU.
// ---------------------------------------------------------------------------

export class QueryService {
  private inflight = new Map<string, Promise<QueryResult>>();
  private cache = new Map<string, QueryResult>();
  private readonly capacity = 256;

  constructor(private deps: EvalDeps, private executor?: QueryExecutor) {}

  /** Which backend answers queries — surfaced in health, never guessed. */
  backend(): string {
    return this.executor?.name ?? 'fixtures';
  }

  /** Workspace identity: any revision moves, every key moves. */
  private stateKey(): string {
    return this.deps.state.docs.map((d) => `${d.name}@${d.revision}`).join(',');
  }

  setState(state: RegistryState): void {
    this.deps = { ...this.deps, state };
    // Keys embed the workspace identity, so stale entries are unreachable
    // rather than wrong; clearing keeps the map from accumulating dead epochs.
    this.cache.clear();
    this.inflight.clear();
  }

  async run(req: QueryRequest): Promise<QueryResult> {
    const key = sha256Hex(this.stateKey() + '' + JSON.stringify({
      metric: req.metric,
      dims: req.dims ?? [],
      filters: req.filters ?? [],
      window: req.window ?? null,
      params: req.params ?? {},
      // Part of the key, not decoration: two reads of one metric that differ
      // only by as-of are different numbers, and an allow-list that omitted
      // them would serve the first answer for every date the analyst picked.
      asOf: req.asOf ?? null,
      basis: req.basis ?? null,
      max_cells: req.max_cells ?? null,
    }));

    const hit = this.cache.get(key);
    if (hit) {
      // Refresh LRU position.
      this.cache.delete(key);
      this.cache.set(key, hit);
      return { ...hit, cost: { ...hit.cost, cache: 'hit' } };
    }

    const running = this.inflight.get(key);
    if (running) return running;

    const p = (this.executor ? this.executor.run(req) : evaluate(req, this.deps))
      .then((r) => {
        this.cache.set(key, r);
        if (this.cache.size > this.capacity) {
          const oldest = this.cache.keys().next().value as string;
          this.cache.delete(oldest);
        }
        return r;
      })
      .finally(() => this.inflight.delete(key));
    this.inflight.set(key, p);
    return p;
  }
}
