/**
 * Running a definition against real data.
 *
 * The surface has always been able to show what a definition produces on a
 * fixture. This is the other half: the same compiled plan, executed on the
 * warehouse the pipeline reads, so an author signs off on a number drawn from
 * their own book rather than from 240 generated positions.
 *
 * Three reads are offered, and the set is deliberately small.
 *
 * **The filed table** — the report's own compiled plan. This is the artifact:
 * what would be submitted, from real positions, today.
 *
 * **Coverage** — the same plan regrouped to the classification's emitted column.
 * It answers the question the fixture can only gesture at: *are there records in
 * production my rules do not classify?* Unmapped records arrive as a group with
 * a blank key, because the compiler emits no `ELSE`. This is the single most
 * valuable thing a real connection buys, and it is an aggregate, so it needs no
 * position-level data to leave the warehouse.
 *
 * **A sample** — rows, and therefore gated. See `samplingAllowed`.
 *
 * Everything here builds on `compileReport` rather than emitting its own SQL. A
 * second SQL generator would be a second thing to keep conformant, and the whole
 * point of the compiler is that there is one.
 */

import { compileReport, readReport, type ReportSpec } from 'keel-engine/compile';
import { parseDoc, sectionBlocks, type Graph } from 'keel-engine/parse';
import { buildRegistry } from 'keel-engine/registry';
import { derivationsFor } from 'keel-engine/rows';
import { compilePredicate } from 'keel-engine/predicate';
import { AS_OF } from 'keel-engine/fixtures';
import { splitPlan } from 'keel-engine/conformance';
import {
  query, samplingAllowed, stratifiedSample, type DremioConfig, type QueryResult,
} from './query';

export interface Workspace {
  /** Artifact name → body, as the registry currently holds them. */
  docs: Record<string, string>;
}

export class NotFound extends Error {}
export class Refused extends Error {}

function graphs(docs: Record<string, string>): Graph[] {
  return Object.values(docs).map((d) => {
    try {
      return parseDoc(d);
    } catch {
      return null;
    }
  }).filter((g): g is Graph => !!g);
}

function findReport(docs: Record<string, string>, name: string): { spec: ReportSpec; view: Graph } {
  const all = graphs(docs);
  const reportGraph = all.find((g) => g.kind === 'report' && g.docName === name);
  if (!reportGraph) throw new NotFound(`no report called ${name}`);

  const spec = readReport(reportGraph);
  const view = all.find((g) => g.kind === 'metrics_view' && (g.view.view || '').trim() === spec.view);
  if (!view) throw new NotFound(`${name} names a view that does not exist: ${spec.view}`);
  return { spec, view };
}

function findView(docs: Record<string, string>, name: string): Graph {
  const view = graphs(docs).find(
    (g) => g.kind === 'metrics_view' && (g.view.view || '').trim() === name,
  );
  if (!view) throw new NotFound(`no view called ${name}`);
  return view;
}

/** The read half of a compiled plan — the write is never sent to Dremio. */
function readablePlan(spec: ReportSpec, view: Graph, docs: Record<string, string>): string {
  const registry = buildRegistry(docs);
  return splitPlan(compileReport(spec, view, registry, 'sql')).query;
}

/**
 * What the report would file, from real data.
 *
 * The materialize step is stripped rather than executed. The registry is a
 * read-only client of the warehouse — writing the submission is the pipeline's
 * job, and a definition surface that could write one is a definition surface
 * that can be wrong in production.
 */
export async function liveReport(
  config: DremioConfig,
  workspace: Workspace,
  name: string,
): Promise<QueryResult & { spec: ReportSpec }> {
  const { spec, view } = findReport(workspace.docs, name);
  const result = await query(config, readablePlan(spec, view, workspace.docs));
  return { ...result, spec };
}

/**
 * Coverage of a classification, on real data, as an aggregate.
 *
 * Built by regrouping the view's own compiled plan to the classified column. A
 * record no rule matched arrives with a blank key — the compiler emits no `ELSE`
 * precisely so that unmapped is visible rather than swept into a bucket nobody
 * chose — which makes the top row of this result the answer to "is my rule set
 * complete against production".
 */
export async function liveCoverage(
  config: DremioConfig,
  workspace: Workspace,
  viewName: string,
): Promise<QueryResult & { column: string; countColumn: string }> {
  const view = findView(workspace.docs, viewName);

  // The composed stage: the classify may be declared by the prepared source
  // this view reads rather than by the view itself, and coverage is coverage
  // either way.
  const classify = derivationsFor(view, buildRegistry(workspace.docs), AS_OF)
    .find((d) => d.op === 'classify');
  if (!classify) throw new NotFound(`${viewName} has no classification to measure coverage for`);

  // A simple measure to total by. Any one will do — the interesting number is
  // the record count per emitted value, and a sum makes the notional visible
  // alongside it.
  const measure = sectionBlocks(view, 'measures')
    .find((m) => (m.f.type || '').trim() === 'simple');
  if (!measure) throw new NotFound(`${viewName} defines no simple measure to total`);

  const spec: ReportSpec = {
    name: `${viewName}__coverage`,
    view: viewName,
    grouping: [classify.name],
    measures: [measure.name],
    // The count is the coverage signal, not the notional. A bucket holding
    // forty records that net to zero is invisible in a column of amounts, and
    // it is exactly the gap worth finding before a submission.
    countAs: 'records',
    // No materialize target: this is read, never written.
    target: '', table: '', partitionBy: [], mode: 'overwrite_partitions',
  };

  const result = await query(config, readablePlan(spec, view, workspace.docs));
  return { ...result, column: classify.name, countColumn: 'records' };
}

/**
 * A stratified sample of the source rows.
 *
 * Gated twice — the server has to have sampling switched on, *and* the view has
 * to be named in the allowlist — because this is the one call that moves
 * position-level data out of the warehouse. Both gates are checked here rather
 * than at the route, so there is no second path to the same rows.
 */
export async function liveSample(
  config: DremioConfig,
  workspace: Workspace,
  viewName: string,
  options: { perStratum?: number; asOf: string } = { asOf: '' },
): Promise<QueryResult & { strata: string[]; perStratum: number }> {
  const allowed = samplingAllowed(config, viewName);
  if (!allowed.ok) throw new Refused(allowed.reason || 'sampling is not permitted');

  const view = findView(workspace.docs, viewName);
  const source = (view.view.source || '').trim();
  if (!source) throw new NotFound(`${viewName} names no source table`);

  // Stratify by whatever the classification reads, so every combination a rule
  // can distinguish is represented — that is what makes the sample useful for
  // judging rules rather than for estimating totals.
  const classify = derivationsFor(view, buildRegistry(workspace.docs), AS_OF)
    .find((d) => d.op === 'classify');
  const strata = classify
    ? stratifyingColumns(workspace.docs, classify.using)
    : [];

  const perStratum = Math.max(1, Math.min(options.perStratum ?? 25, 500));
  const asOfField = (view.view['grain.as_of_field'] || 'as_of_date').trim();

  const sql = stratifiedSample(source, strata, perStratum, asOfField, options.asOf);
  const result = await query(config, sql);
  return { ...result, strata, perStratum };
}

/**
 * The columns a rule set actually branches on.
 *
 * Sampling uniformly over these is what keeps a rare combination — the segment
 * nobody mapped, the collateral class with three positions — in the sample. Those
 * are exactly the rows an author needs to see and exactly the ones a head-of-table
 * read never contains.
 */
function stratifyingColumns(docs: Record<string, string>, classification: string): string[] {
  const registry = buildRegistry(docs);
  const versions = registry.classifications[classification] || [];
  const rules = versions.flatMap((c) => c.rules);

  const seen: string[] = [];
  rules.forEach((r) => {
    // `compilePredicate` is already imported transitively by the registry; the
    // columns come off the parsed condition rather than off a regex.
    const cols = predicateColumns(r.when);
    cols.forEach((c) => {
      if (!seen.includes(c)) seen.push(c);
    });
  });
  // More than a handful of strata makes the sample enormous rather than
  // representative, so the widest-branching columns win.
  return seen.slice(0, 4);
}

function predicateColumns(when: string): string[] {
  const compiled = compilePredicate(when);
  return compiled.err ? [] : compiled.cols;
}
