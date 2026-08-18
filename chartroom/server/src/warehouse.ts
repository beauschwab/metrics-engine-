/**
 * The warehouse manifest — everything the Python query executor needs to
 * serve the same numbers the fixture path serves (E8.2, ADR-40).
 *
 * The engine stays the single source of measure SQL: `stage()` orders the
 * derived chain and `aggregate()` renders each simple measure, exactly as
 * the published semantic views do. One deliberate difference: the views
 * ROUND simple aggregates to 2dp for BI consumption; the manifest strips
 * that wrapper so the warehouse path can match the Evaluator (which never
 * rounds) to parity tolerance — the fixture path is the oracle (ADR-39).
 *
 * The manifest also ships the nominal fixture tables themselves. In dev the
 * Python side loads them into DuckDB, which is what makes the parity harness
 * possible: same rows, two engines, numbers must agree.
 */

import { createHash } from 'node:crypto';
import { rowStageSql } from 'keel-engine/compile';
import { TABLES, DATES } from 'keel-engine/fixtures';
import { parseDoc, type Graph } from 'keel-engine/parse';
import { buildRegistry } from 'keel-engine/registry';
import { aggregate, expressionToSql, stage } from 'keel-engine/semantic';
import type { RegistryState } from './keel';

export interface ManifestMeasure {
  name: string;
  kind: 'simple' | 'derived';
  /** SQL for the agg CTE (simple) or the derived chain (derived). Unrounded. */
  sql: string;
  format: string;
}

export interface ManifestDoc {
  name: string;
  revision: number;
  source: string;
  /**
   * Row-stage columns the measures may reference (`days_to_maturity`,
   * `product_id`, …), as SQL steps in dependency order — the engine's own
   * derivation emitter, so classifications and rate lookups resolve to the
   * same CASE chains the pipeline compilers publish. The warehouse chains
   * one CTE per step under the source before aggregating.
   */
  row_stage: Array<{ name: string; sql: string }>;
  /** Simple first, then derived in dependency order — the CTE chain order. */
  measures: ManifestMeasure[];
  unsupported: Array<{ name: string; reason: string }>;
}

export interface ManifestTable {
  name: string;
  columns: Array<{ name: string; type: 'date' | 'text' | 'number' | 'boolean' }>;
  rows: unknown[][];
}

export interface WarehouseManifest {
  workspace: string;
  asOf: string;
  dates: string[];
  tables: ManifestTable[];
  docs: ManifestDoc[];
}

/** `ROUND(x, 2)` → `x` — the BI-facing rounding the parity oracle must not see. */
const unround = (sql: string): string => {
  const m = /^ROUND\((.*), 2\)$/.exec(sql);
  return m ? m[1] : sql;
};

const columnType = (value: unknown, name: string): ManifestTable['columns'][number]['type'] => {
  // Date columns by convention (`maturity_date` holds nulls for open
  // positions, so the value alone cannot decide) — the engine's own
  // derivations do date arithmetic on them, and a VARCHAR would refuse it.
  if (name === 'as_of_date' || name.endsWith('_date')) return 'date';
  if (typeof value === 'boolean') return 'boolean';
  if (typeof value === 'number') return 'number';
  return 'text';
};

function fixtureTables(): ManifestTable[] {
  const nominal = (TABLES as Record<string, Record<string, Record<string, Array<Record<string, unknown>>>>>)
    .nominal;
  return Object.entries(nominal).map(([name, byDate]) => {
    const all = Object.values(byDate).flat();
    // Type from the first non-null value per column — first rows hold nulls.
    const columns = Object.keys(all[0]).map((c) => {
      const sample = all.find((r) => r[c] !== null && r[c] !== undefined)?.[c];
      return { name: c, type: columnType(sample, c) };
    });
    return {
      name,
      columns,
      // An open position's maturity is '' in the fixtures; as a DATE it is
      // NULL — which is what the engine's derivations already treat it as
      // (`COALESCE(DATE_DIFF(...), 0)`, the null-first bucket arm).
      rows: all.map((r) => columns.map((c) => {
        const v = r[c.name];
        return v === undefined || v === null || (c.type === 'date' && v === '') ? null : v;
      })),
    };
  });
}

export function buildManifest(state: RegistryState): WarehouseManifest {
  // Classifications and parameter sets live in their own documents; the row
  // stage needs the whole registry to resolve them into CASE chains.
  const registry = buildRegistry(Object.fromEntries(state.docs.map((d) => [d.name, d.body])));

  const docs: ManifestDoc[] = [];
  for (const doc of state.docs) {
    let graph: Graph;
    try {
      graph = parseDoc(doc.body);
    } catch {
      continue;
    }
    if (graph.kind !== 'metrics_view') continue;

    const staged = stage(graph);
    const measures: ManifestMeasure[] = [];
    const unsupported = staged.issues.map((i) => ({ name: i.measure, reason: i.reason }));

    for (const m of staged.simple) {
      const agg = aggregate(m);
      if (agg.reason) {
        unsupported.push({ name: m.name, reason: agg.reason });
        continue;
      }
      measures.push({
        name: m.name, kind: 'simple', sql: unround(agg.sql),
        format: (m.f.format || 'number').trim(),
      });
    }
    for (const m of staged.derived) {
      const expr = expressionToSql(m.f.expression || '');
      if (expr.reason) {
        unsupported.push({ name: m.name, reason: expr.reason });
        continue;
      }
      measures.push({
        name: m.name, kind: 'derived', sql: expr.sql,
        format: (m.f.format || 'number').trim(),
      });
    }

    docs.push({
      name: doc.name,
      revision: doc.revision,
      source: (graph.view.source || '').trim(),
      row_stage: rowStageSql(graph, registry),
      measures,
      unsupported,
    });
  }

  const workspace = createHash('sha256')
    .update(state.docs.map((d) => `${d.name}@${d.revision}`).sort().join('|'))
    .digest('hex')
    .slice(0, 16);

  return {
    workspace,
    asOf: DATES[DATES.length - 1],
    dates: [...DATES],
    tables: fixtureTables(),
    docs,
  };
}
