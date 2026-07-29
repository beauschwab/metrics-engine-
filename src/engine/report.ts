/**
 * Running a report: the grouped table that actually gets filed.
 *
 * A measure answers "what is this number?". A report answers "what are we
 * submitting?" — rows at the grain of the form, which is the artifact a
 * regulator receives and an auditor reconciles against. Verification here is
 * seeing the table, not seeing a scalar.
 *
 * Derived measures are evaluated per group from that group's simple
 * aggregates. That is correct for ratios but not for anything with a
 * portfolio-level cap in it, so the linter says so rather than letting the
 * arithmetic quietly mean something else.
 */

import { evalExpression } from './expression';
import { compilePredicate } from './predicate';
import { aggregate } from './evaluate';
import { deriveRows, type Coverage } from './rows';
import { exprNames, type Graph, type Measure } from './parse';
import type { Registry } from './registry';
import { TABLES, type Row } from './fixtures';
import { isReferenceName, type FixtureName } from './vocab';
import type { ReportSpec } from './compile';

export interface ReportRow {
  /** Grouping values, in declared order. */
  key: string[];
  records: number;
  values: Record<string, number>;
}

export interface ReportResult {
  columns: string[];
  measures: string[];
  rows: ReportRow[];
  totals: Record<string, number>;
  records: number;
  /** Coverage from any classification the view applies, for the header. */
  coverage: Coverage | null;
  /** Measures the report names that the view does not define. */
  missing: string[];
}

export function runReport(
  report: ReportSpec,
  view: Graph,
  registry: Registry,
  fixture: FixtureName,
  asOf: string,
): ReportResult {
  const table = (TABLES[fixture] || {})[view.view.source] || {};
  const derived = deriveRows(view, registry, table[asOf] || [], asOf, {});

  const measures = report.measures
    .map((n) => view.byName[n])
    .filter((m): m is Measure => !!m);
  const missing = report.measures.filter((n) => !view.byName[n]);

  const simple = measures.filter((m) => (m.f.type || '').trim() === 'simple');
  const composed = measures.filter((m) => (m.f.type || '').trim() === 'derived');

  // One pass, bucketing rows by their grouping key.
  const buckets: Record<string, { key: string[]; rows: Row[] }> = {};
  derived.rows.forEach((row) => {
    const key = report.grouping.map((c) => String(row[c] ?? ''));
    const id = key.join('');
    (buckets[id] ||= { key, rows: [] }).rows.push(row);
  });

  const preds = simple.map((m) => ({ m, pred: compilePredicate(m.f.where || '') }));

  const rows: ReportRow[] = Object.keys(buckets).map((id) => {
    const bucket = buckets[id];
    const values: Record<string, number> = {};

    preds.forEach(({ m, pred }) => {
      const field = (m.f.field || '').trim();
      const vals: number[] = [];
      bucket.rows.forEach((r) => {
        if (!pred.fn(r)) return;
        const v = r[field];
        if (typeof v === 'number' && !Number.isNaN(v)) vals.push(v);
      });
      values[m.name] = aggregate((m.f.agg || 'sum').trim(), vals);
    });

    composed.forEach((m) => {
      values[m.name] = evalExpression(m.f.expression || '', (n) =>
        values[n] === undefined ? NaN : values[n]).value;
    });

    return { key: bucket.key, records: bucket.rows.length, values };
  });

  const first = measures[0]?.name;
  rows.sort((a, b) =>
    first ? (b.values[first] || 0) - (a.values[first] || 0) : a.key.join().localeCompare(b.key.join()));

  const totals: Record<string, number> = {};
  measures.forEach((m) => {
    totals[m.name] = rows.reduce((acc, r) => acc + (Number.isFinite(r.values[m.name]) ? r.values[m.name] : 0), 0);
  });

  const coverage = Object.values(derived.coverage)[0] || null;

  return {
    columns: report.grouping,
    measures: measures.map((m) => m.name),
    rows,
    totals,
    records: derived.rows.length,
    coverage,
    missing,
  };
}

/**
 * Measures whose arithmetic stops meaning the same thing once it is evaluated
 * per group — anything referencing a measure that is itself capped or floored
 * against a portfolio-level total.
 */
export function grainRisky(report: ReportSpec, view: Graph | null): string[] {
  if (!view) return [];
  return report.measures.filter((name) => {
    const m = view.byName[name];
    if (!m || (m.f.type || '').trim() !== 'derived') return false;
    // A cap or floor over another measure is a total-level rule; applying it
    // inside each group silently changes what it means.
    return exprNames(m).some((n) => n === 'least' || n === 'greatest') &&
      exprNames(m).filter(isReferenceName).length > 0;
  });
}
