/**
 * What each document is *for*, and what feeds what.
 *
 * The registry has always known its documents by what they *contain* — rules,
 * rates, measures, thresholds. That is a syntactic taxonomy, and it puts two
 * very different things in the same drawer: `liquidity_pit` holds `lcr_pct`, a
 * ratio a dashboard evaluates at query time, and `fr2052a_outflows` holds the
 * classification and weighting the nightly pipeline folds into a filed table.
 * Same `kind:`, same glyph, adjacent rows — and nothing on the surface said
 * which was which.
 *
 * This module derives the other taxonomy, the one an author actually reasons
 * about:
 *
 *   **Prepare** — what is this record?      rules, rates, row derivations
 *   **File**    — what goes on the form?    the report and its grain
 *   **Publish** — what does it mean?        ratios that are read directly
 *   **Watch**   — should anyone look?       monitors and limits
 *
 * Prepare → File → Publish is a chain; each consumes the last. Watch is not a
 * fourth link, it *points at* the chain — which is exactly why a monitor sitting
 * as a peer of the report it watches reads wrong.
 *
 * Every edge here is read off fields the documents already carry (`source:`,
 * `using:`, `view:`, `materialize.table`, `report:`). Nothing is hardcoded and
 * nothing is a guess, so the picture cannot drift from the workspace: add a
 * report and its view becomes Prepare, delete it and the view is Publish again.
 */

import { parseDoc, type DocKind, type Graph } from './parse';
import { derivationsOf } from './rows';

export type Stage = 'prepare' | 'file' | 'publish' | 'watch';

/** Reading order, and the order the tree groups in. */
export const STAGE_ORDER: Stage[] = ['prepare', 'file', 'publish', 'watch'];

export const STAGE_LABEL: Record<Stage, string> = {
  prepare: 'Prepare',
  file: 'File',
  publish: 'Publish',
  watch: 'Watch',
};

/**
 * The question each stage answers, in the author's words rather than the
 * system's. A group header that only names itself teaches nothing the first
 * time someone opens the panel.
 */
export const STAGE_CAPTION: Record<Stage, string> = {
  prepare: 'what each record is',
  file: 'what gets submitted',
  publish: 'what people read',
  watch: 'what checks it',
};

export interface Node {
  /** How other documents refer to this one. */
  name: string;
  /** The workspace file it lives in. */
  file: string;
  kind: DocKind;
  stage: Stage;
  /** The physical table it reads, if it names one. */
  reads: string;
  /** The physical table it writes. Only a report writes. */
  writes: string;
  /** Other documents it folds in — rule sets, rate tables, the view it files. */
  uses: string[];
  /**
   * Where and when this runs, short enough to sit in a 30px strip beside the
   * chain without stealing its width. The chain is the primary content; this is
   * a caption on it.
   */
  runtime: string;
  /** The same fact, said fully, for the tooltip and for anywhere with room. */
  runtimeDetail: string;
  /** Governance tier, 0 when the document declares none. */
  tier: number;
  owner: string;
}

export interface LineageGraph {
  nodes: Node[];
  byName: Record<string, Node>;
  byFile: Record<string, Node>;
}

// ---------------------------------------------------------------------------

const head = (g: Graph, key: string): string => (g.view[key] || '').trim();

/**
 * Where a document sits in the chain.
 *
 * Four of the five kinds map straight through. A `metrics_view` is the one that
 * has to be *derived*: it is Prepare when something files from it and Publish
 * when nothing does. That is a structural fact rather than a heuristic — a view
 * no report consumes is a view whose numbers are read directly, which is what
 * Publish means.
 */
function stageOf(g: Graph, filedViews: Set<string>): Stage {
  if (g.kind === 'report') return 'file';
  if (g.kind === 'variance_monitor') return 'watch';
  // A binding is about where records come from, which is Prepare's question.
  if (g.kind === 'source_binding') return 'prepare';
  // A rule set or a rate table is never the number anyone reads; it is always
  // an input to something that is.
  if (g.kind === 'classification' || g.kind === 'parameter_set') return 'prepare';
  return filedViews.has(g.docName) ? 'prepare' : 'publish';
}

/**
 * Where a document runs, stated plainly.
 *
 * This is the difference the old surface could not express, and it is not the
 * `targets:` list — that says which engines *could* run a plan. What an author
 * needs is whether a thing writes a table on a schedule or is evaluated when
 * somebody opens a dashboard, because the blast radius of an edit is entirely
 * different.
 *
 * The compiler is the authority here, and it is worth being exact: `compileReport`
 * inlines a view's derivations, which inline its rule sets and rate tables, into
 * one plan. So only the report writes. Saying a classification "runs nightly"
 * would be a comfortable lie.
 */
function runtimeOf(g: Graph, stage: Stage): { runtime: string; runtimeDetail: string } {
  switch (g.kind) {
    case 'classification':
      return {
        runtime: 'Compiled in · writes nothing',
        runtimeDetail: 'Compiled into every view that classifies with it — writes nothing itself',
      };
    case 'parameter_set':
      return {
        runtime: 'Compiled in · writes nothing',
        runtimeDetail: 'Compiled into every view that looks up against it — writes nothing itself',
      };
    case 'report': {
      const table = head(g, 'materialize.table');
      const by = head(g, 'materialize.partition_by').replace(/[[\]]/g, '').trim();
      if (!table) {
        return {
          runtime: 'Pipeline · no target declared',
          runtimeDetail: 'Runs in the pipeline — no materialize target is declared',
        };
      }
      return {
        runtime: `Pipeline · writes ${table}`,
        runtimeDetail: `Runs in the pipeline; writes ${table}${by ? ` partitioned by ${by}` : ''}`,
      };
    }
    case 'source_binding':
      return {
        runtime: 'Client adapter · writes nothing',
        runtimeDetail: 'Generates the adapter view a client system runs the canonical plan on',
      };
    case 'variance_monitor': {
      const report = head(g, 'report');
      return {
        runtime: 'After the report · raises breaches',
        runtimeDetail: `Runs after ${report || 'its report'}; raises breaches, writes nothing`,
      };
    }
    default:
      return stage === 'prepare'
        ? {
          runtime: 'Folded into the report',
          runtimeDetail: 'Folded into the plan of the report that files from it',
        }
        : {
          runtime: 'Query time · writes nothing',
          runtimeDetail: 'Evaluated at query time — no table is written',
        };
  }
}

/** The documents a document folds in, in the order a reader meets them. */
function usesOf(g: Graph): string[] {
  const out: string[] = [];
  const add = (n: string) => {
    if (n && !out.includes(n)) out.push(n);
  };

  if (g.kind === 'metrics_view') derivationsOf(g).forEach((d) => add(d.using));
  if (g.kind === 'report') add(head(g, 'view'));
  if (g.kind === 'variance_monitor') add(head(g, 'report'));
  return out;
}

export function buildLineage(docs: Record<string, string>): LineageGraph {
  const parsed: Array<{ file: string; g: Graph }> = [];
  Object.entries(docs).forEach(([file, text]) => {
    try {
      parsed.push({ file, g: parseDoc(text) });
    } catch {
      // A document that will not parse has no place in the chain, and the
      // diagnostics layer is already saying so far more usefully than a
      // half-drawn arrow would.
    }
  });

  // Which views something files from — the one fact `stageOf` cannot get from
  // a document in isolation.
  const filedViews = new Set(
    parsed.filter(({ g }) => g.kind === 'report').map(({ g }) => head(g, 'view')),
  );

  const nodes = parsed.map(({ file, g }) => {
    const stage = stageOf(g, filedViews);
    return {
      name: g.docName || file,
      file,
      kind: g.kind,
      stage,
      reads: head(g, 'source'),
      writes: g.kind === 'report' ? head(g, 'materialize.table') : '',
      uses: usesOf(g),
      ...runtimeOf(g, stage),
      tier: parseInt(head(g, 'governance.sr_11_7_tier') || '0', 10) || 0,
      owner: head(g, 'governance.owner'),
    } satisfies Node;
  });

  const byName: Record<string, Node> = {};
  const byFile: Record<string, Node> = {};
  nodes.forEach((n) => {
    byName[n.name] = n;
    byFile[n.file] = n;
  });
  return { nodes, byName, byFile };
}

// ---------------------------------------------------------------------------
// The chain
// ---------------------------------------------------------------------------

export interface Step {
  /** A physical table, or one position in the chain holding one or more documents. */
  kind: 'table' | 'docs';
  label: string;
  /** Document names at this position. Empty for a table. */
  docs: string[];
  stage?: Stage;
  /** Rule sets and rate tables folded in at this step. */
  uses: string[];
}

export interface Chain {
  steps: Step[];
  /** Index of the step holding the open document, or -1. */
  at: number;
  /**
   * How the open document appears at that step: as the step itself, or as one
   * of the inputs folded into it. A rule set is not a link in the chain — it is
   * something a link is made of — and pretending otherwise would draw
   * `positions → product_id → outflows`, which is not what runs.
   */
  via: 'spine' | 'input' | 'none';
}

const EMPTY: Chain = { steps: [], at: -1, via: 'none' };

/**
 * The chain a document belongs to, as a line the eye can follow.
 *
 * Real lineage is a DAG, and drawing it as one produces a picture nobody reads.
 * The spine is the path the data actually travels — source table, the view that
 * shapes it, the report that files it, the table that lands, the monitors that
 * watch it — and everything else hangs off a step as an input.
 */
export function chainFor(lineage: LineageGraph, docName: string): Chain {
  const node = lineage.byName[docName];
  if (!node) return EMPTY;

  // Every chain is anchored on a view. Find the one this document belongs to,
  // whichever end it was approached from.
  const spineView = findSpineView(lineage, node);
  if (!spineView) return EMPTY;

  const steps: Step[] = [];
  if (spineView.reads) {
    steps.push({ kind: 'table', label: spineView.reads, docs: [], uses: [] });
  }
  steps.push({
    kind: 'docs',
    label: spineView.name,
    docs: [spineView.name],
    stage: spineView.stage,
    // Only the inputs that are documents in this workspace; a `using:` naming
    // something absent is a diagnostic, not a step.
    uses: spineView.uses.filter((u) => !!lineage.byName[u]),
  });

  const report = lineage.nodes.find(
    (n) => n.kind === 'report' && n.uses.includes(spineView.name),
  );
  if (report) {
    steps.push({ kind: 'docs', label: report.name, docs: [report.name], stage: 'file', uses: [] });
    if (report.writes) steps.push({ kind: 'table', label: report.writes, docs: [], uses: [] });

    // Monitors are parallel, not sequential — three of them do not make three
    // more links. They share the last position.
    const watchers = lineage.nodes.filter(
      (n) => n.kind === 'variance_monitor' && n.uses.includes(report.name),
    );
    if (watchers.length) {
      steps.push({
        kind: 'docs',
        label: watchers.length === 1 ? watchers[0].name : `${watchers.length} monitors`,
        docs: watchers.map((w) => w.name),
        stage: 'watch',
        uses: [],
      });
    }
  }

  const at = steps.findIndex((s) => s.docs.includes(docName) || s.uses.includes(docName));
  const via: Chain['via'] = at < 0
    ? 'none'
    : steps[at].docs.includes(docName) ? 'spine' : 'input';
  return { steps, at, via };
}

/** The view a document's chain is anchored on, from whichever end. */
function findSpineView(lineage: LineageGraph, node: Node): Node | null {
  if (node.kind === 'metrics_view') return node;

  if (node.kind === 'report') return lineage.byName[node.uses[0]] || null;

  if (node.kind === 'variance_monitor') {
    const report = lineage.byName[node.uses[0]];
    return report ? lineage.byName[report.uses[0]] || null : null;
  }

  // A rule set or rate table: the first view that folds it in. It can feed more
  // than one, and showing every chain at once would be a diagram rather than an
  // orientation — the panel already lists the others.
  return lineage.nodes.find(
    (n) => n.kind === 'metrics_view' && n.uses.includes(node.name),
  ) || null;
}

/**
 * Documents grouped for display, in stage order, empty stages dropped.
 *
 * Order within a stage follows the workspace order it was given, so the tree
 * does not reshuffle itself as documents are edited.
 */
export function groupByStage(
  lineage: LineageGraph,
  files: readonly string[],
): Array<{ stage: Stage; files: string[] }> {
  return STAGE_ORDER.map((stage) => ({
    stage,
    files: files.filter((f) => lineage.byFile[f]?.stage === stage),
  })).filter((g) => g.files.length > 0);
}
