/**
 * The KEEL adapters — how Chartroom sees the registry.
 *
 * Two rules from the implementation spec hold everything here together:
 * integration contracts live in one adapter (never forked into widgets), and
 * the registry is the only data API. The adapter reads the registry over HTTP
 * exactly as any other client would (`clients/README.md` is the contract), and
 * falls back to the shipped documents when no registry is running — the same
 * offline posture the authoring surface itself takes.
 *
 * A `MetricContract` is *derived*, not stored: unit and precision from the
 * measure's declared format, dimensions from the actual derived rows (so a
 * classification's emitted column is as bindable as a source column), and
 * governance status from the release/channel system (ADR-12). Deriving beats
 * duplicating: there is no second copy of the truth to fall out of date.
 */

import type { DimContract, MetricContract, MetricRef } from 'chartroom-spec';
import { parseMetricRef } from 'chartroom-spec';
import { INITIAL_DOCS } from 'keel-engine/documents';
import { Evaluator } from 'keel-engine/evaluate';
import { AS_OF, TABLES } from 'keel-engine/fixtures';
import { parseDoc, type Graph, type Measure } from 'keel-engine/parse';
import { buildRegistry, type Registry } from 'keel-engine/registry';

export interface RegistryDoc {
  name: string;
  kind: string;
  revision: number;
  body: string;
}

export interface RegistryState {
  docs: RegistryDoc[];
  /** name → revision the production channel serves; empty when none promoted. */
  production: Map<string, number>;
  /** Where this state came from — surfaced to the user, never silent. */
  source: 'registry' | 'shipped';
}

// Read per call, not at import: the process (and the tests) may point the
// adapter at a registry after this module loads.
const API = () => process.env.KEEL_API || 'http://127.0.0.1:8787';

/**
 * Read the workspace and the production manifest.
 *
 * Falling back to the shipped documents keeps every downstream feature working
 * with no registry process — but the fallback is *labelled*, because a
 * dashboard author should never mistake demo documents for the governed
 * workspace.
 */
export async function fetchRegistryState(): Promise<RegistryState> {
  try {
    const res = await fetch(`${API()}/api/artifacts`, { signal: AbortSignal.timeout(3000) });
    if (!res.ok) throw new Error(`registry said ${res.status}`);
    const data = (await res.json()) as {
      artifacts: Array<{ name: string; kind: string; revision: number; body: string }>;
    };

    const production = new Map<string, number>();
    try {
      // /api/runtime/<channel> — the manifest the runtime clients poll. (The
      // Phase-3 governance tests caught this path being wrong, which meant
      // ADR-12's "approved" could never fire against a live registry.)
      const man = await fetch(`${API()}/api/runtime/production`, { signal: AbortSignal.timeout(3000) });
      if (man.ok) {
        const m = (await man.json()) as { artifacts: Array<{ name: string; revision: number }> };
        m.artifacts.forEach((a) => production.set(a.name, a.revision));
      }
      // A 404 means nothing has been promoted — an ordinary state, not an error.
    } catch { /* no manifest, no approvals */ }

    return {
      docs: data.artifacts.map((a) => ({
        name: a.name, kind: a.kind, revision: a.revision, body: a.body,
      })),
      production,
      source: 'registry',
    };
  } catch {
    return {
      docs: Object.entries(INITIAL_DOCS).map(([name, body]) => ({
        name,
        kind: (parseSafe(body)?.kind as string) || 'metrics_view',
        revision: 1,
        body,
      })),
      production: new Map(),
      source: 'shipped',
    };
  }
}

/** A document body at a pinned revision, for reproducible pinned queries. */
export async function fetchRevision(name: string, revision: number): Promise<string | null> {
  try {
    const res = await fetch(
      `${API()}/api/artifacts/${encodeURIComponent(name)}?revision=${revision}`,
      { signal: AbortSignal.timeout(3000) },
    );
    if (!res.ok) return null;
    const data = (await res.json()) as { artifact?: { body?: string }; body?: string };
    return data.artifact?.body ?? data.body ?? null;
  } catch {
    return null;
  }
}

function parseSafe(body: string): Graph | null {
  try {
    return parseDoc(body);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Contract derivation
// ---------------------------------------------------------------------------

/** unit + precision from the measure's declared format string. */
export function unitOf(format: string): { unit: MetricContract['unit']; precision: number } {
  const pct = /^percent_(\d)dp$/.exec(format);
  if (pct) return { unit: 'percent', precision: Number(pct[1]) };
  if (format.startsWith('currency_usd')) return { unit: 'USD', precision: 0 };
  if (format === 'bps') return { unit: 'number', precision: 0 };
  return { unit: 'number', precision: 0 };
}

/**
 * The denominator of a ratio measure, when the expression states one plainly.
 *
 * `a / b`, `a / nullif(b, 0)`, `100 * a / b` — the shapes governed ratio
 * measures actually take. Anything cleverer stays null: DEN-01 warns on
 * *known-different* denominators, and a wrong guess here would invent lineage.
 */
export function denominatorOf(expression: string): string | null {
  const m = /\/\s*(?:nullif\s*\(\s*)?([a-z_][a-z0-9_]*)/i.exec(expression);
  return m ? m[1] : null;
}

function aggsOf(m: Measure): string[] {
  const type = (m.f.type || '').trim();
  if (type === 'simple') {
    const agg = (m.f.agg || 'sum').trim();
    // Additive measures re-aggregate; everything else only means what it says.
    return agg === 'sum' || agg === 'count' ? [agg] : [agg === 'weighted_avg' ? 'weighted_avg' : agg];
  }
  // A derived or windowed measure is a formula — summing it across groups is
  // the "summing ratios" mistake the catalog exists to make uncheatable.
  return [];
}

/** Ordered-domain heuristic, stated: bucket ladders read in ladder order. */
const isOrdinal = (name: string) => name.endsWith('bucket') || name === 'bucket_code';

/**
 * Dimensions from the derived rows themselves — run the row stage once at the
 * as-of date and look at what a row actually has. A classification's emitted
 * column and a derivation's bucket both show up here without any special
 * casing, because they really are columns by the time a measure sees them.
 */
export function dimsOf(graph: Graph, registry: Registry): DimContract[] {
  const ev = new Evaluator(graph, 'nominal', registry);
  const rows = ev.rowsFor(AS_OF).rows;
  if (!rows.length) return [];

  const dims: DimContract[] = [];
  for (const key of Object.keys(rows[0])) {
    const sample = rows[0][key];
    if (key === 'as_of_date') {
      dims.push({ name: key, type: 'time' });
    } else if (typeof sample === 'boolean') {
      dims.push({ name: key, type: 'boolean', values: ['true', 'false'] });
    } else if (typeof sample === 'string') {
      const values = [...new Set(rows.map((r) => String(r[key])))];
      if (values.length <= 40) {
        if (!isOrdinal(key)) values.sort();
        dims.push({ name: key, type: 'categorical', ordinal: isOrdinal(key) || undefined, values });
      }
      // A string column with >40 distinct values is an identifier, not a
      // dimension — offering it would invite million-cell grids.
    }
  }
  return dims;
}

export interface ContractSet {
  contracts: MetricContract[];
  byRef: Map<string, MetricContract>;
  state: RegistryState;
}

/** Every measure of every metrics view, as a contract at its latest revision. */
export function deriveContracts(state: RegistryState): ContractSet {
  const docs = Object.fromEntries(state.docs.map((d) => [d.name, d.body]));
  const registry = buildRegistry(docs);
  const contracts: MetricContract[] = [];

  for (const doc of state.docs) {
    const graph = parseSafe(doc.body);
    if (!graph || graph.kind !== 'metrics_view') continue;
    const dims = dimsOf(graph, registry);
    const owner = (graph.view.owner || '').trim() || 'unassigned';
    const source = (graph.view.source || '').trim();

    for (const m of graph.measures) {
      const { unit, precision } = unitOf((m.f.format || 'number').trim());
      const ref = `keel://${doc.name}.${m.name}@${doc.revision}` as MetricRef;
      contracts.push({
        ref,
        doc: doc.name,
        measure: m.name,
        version: doc.revision,
        // ADR-12: approved means "the production channel serves exactly this
        // revision of this document". Not "some revision once did".
        status: state.production.get(doc.name) === doc.revision ? 'approved' : 'draft',
        grain: source,
        dims,
        unit,
        precision,
        format: (m.f.format || 'number').trim(),
        allowed_aggregations: aggsOf(m),
        denominator_of: (m.f.type || '').trim() === 'derived'
          ? denominatorOf(m.f.expression || '')
          : null,
        owner,
        lineage_urn: source,
        description: (m.f.description || '').trim() || undefined,
      });
    }
  }

  return {
    contracts,
    byRef: new Map(contracts.map((c) => [c.ref, c])),
    state,
  };
}

/**
 * Resolve a ref that may pin an older revision than the workspace holds.
 * Same-revision refs resolve locally; older pins go back to the registry's
 * history. Returns the parsed graph plus the doc set to build the registry
 * from (pinned body substituted in), or null when the ref cannot be honoured.
 */
export async function resolveRef(
  ref: string,
  state: RegistryState,
): Promise<{ graph: Graph; docs: Record<string, string>; measure: string } | null> {
  const parsed = parseMetricRef(ref);
  if (!parsed) return null;
  const current = state.docs.find((d) => d.name === parsed.doc);
  if (!current) return null;

  let body = current.body;
  if (current.revision !== parsed.version) {
    if (state.source === 'shipped') return null; // no history to reach for
    const pinned = await fetchRevision(parsed.doc, parsed.version);
    if (pinned === null) return null;
    body = pinned;
  }

  const graph = parseSafe(body);
  if (!graph || !graph.byName[parsed.measure]) return null;

  const docs = Object.fromEntries(state.docs.map((d) => [d.name, d.body]));
  docs[parsed.doc] = body;
  return { graph, docs, measure: parsed.measure };
}

/** The fixture tables back the queries; exported for the query layer's guards. */
export const SOURCE_TABLES = TABLES;
