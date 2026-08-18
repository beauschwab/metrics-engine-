/**
 * The registry, as tools an agent can call.
 *
 * Written as plain async functions over a `Repository` rather than as MCP
 * handlers, for the same reason `server/api.ts` is a function from request to
 * response: it is testable at the level it is written. `server.ts` is a thin
 * binding of these to the protocol, and everything worth asserting is asserted
 * here without a subprocess or a stdio pipe.
 *
 * Two things shape the design more than the protocol does.
 *
 * **An agent reads far more than it writes, and the reads are the point.** Most
 * of what an external agent wants is "what are the rules, exactly, and what
 * depends on them" — the ordered rule set with its conditions and citations, the
 * rate table in force on a date, the chain a document sits in. Those are cheap,
 * safe, and currently only obtainable by scraping YAML out of an HTTP body and
 * parsing it yourself.
 *
 * **Authoring is testing.** A tool that only saved would be a worse `PUT`. The
 * useful thing is the loop: propose a rule set, see which records it classifies
 * and which it strands, see what a proposed threshold silences — all without
 * writing anything. So `test_rules`, `preview_report` and `assess_change` take a
 * *body* rather than a name, and never touch the registry.
 *
 * Writes go through `Repository.save`, so append-only revisions, optimistic
 * concurrency and attribution are the same for an agent as for a browser. They
 * are also off by default; see `McpPolicy`.
 */

import type { Repository, Revision } from 'keel-registry/repository';
import { Conflict } from 'keel-registry/repository';
import {
  RuntimeNotFound, RuntimeRefused, cutRelease, promoteRelease, runtimeManifest,
} from 'keel-registry/runtime';
import { compileReport, readReport } from 'keel-engine/compile';
import { diagnose } from 'keel-engine/diagnostics';
import { Evaluator } from 'keel-engine/evaluate';
import { AS_OF, TABLES, type Row } from 'keel-engine/fixtures';
import { assessChange, type ImpactReport } from 'keel-engine/impact';
import { buildLineage, chainFor, type Stage } from 'keel-engine/lineage';
import { parseDoc, sectionBlocks, type Graph } from 'keel-engine/parse';
import {
  buildRegistry, resolveClassification, resolveParameterSet,
} from 'keel-engine/registry';
import { runReport } from 'keel-engine/report';
import { derivationsOf, runClassification } from 'keel-engine/rows';
import { emitSemantic, type SemanticTarget } from 'keel-engine/semantic';
import { DOMAINS, type FixtureName } from 'keel-engine/vocab';

export class ToolError extends Error {}

/**
 * What this connection is allowed to do.
 *
 * `canWrite` is false unless somebody set `KEEL_MCP_WRITE=1`. An agent that can
 * silently rewrite a governed rule set is not a feature you turn on by
 * forgetting to turn it off, and the read tools — which are most of the value —
 * are unaffected.
 *
 * `identity` is the agent's attribution and comes from the environment, never
 * from a tool argument. An author field the caller can set to any string is not
 * an attribution, and under SR 11-7 the name against a rule change is part of
 * the control rather than a label.
 */
export interface McpPolicy {
  canWrite: boolean;
  identity: string;
  fixture: FixtureName;
}

export function policyFromEnv(env: Record<string, string | undefined>): McpPolicy {
  const fixture = (env.KEEL_MCP_FIXTURE || 'nominal') as FixtureName;
  return {
    canWrite: env.KEEL_MCP_WRITE === '1',
    identity: env.KEEL_MCP_IDENTITY || 'mcp-agent',
    fixture: TABLES[fixture] ? fixture : 'nominal',
  };
}

// ---------------------------------------------------------------------------
// Reading the registry
// ---------------------------------------------------------------------------

async function workspace(repo: Repository): Promise<Record<string, string>> {
  const rows = await repo.workspace();
  return Object.fromEntries(rows.map((a) => [a.name, a.body]));
}

function parse(name: string, body: string): Graph {
  try {
    return parseDoc(body);
  } catch (err) {
    throw new ToolError(`${name} does not parse: ${err instanceof Error ? err.message : err}`);
  }
}

export interface ArtifactSummary {
  name: string;
  kind: string;
  stage: Stage | null;
  revision: number;
  author: string;
  updatedAt: string;
  tier: number;
  owner: string;
  runtime: string;
  reads: string;
  writes: string;
}

/**
 * Every artifact, with the things an agent needs to decide which one it wants.
 *
 * The stage and the runtime are included deliberately: without them an agent
 * sees seven `metrics_view`s and has no way to tell a dashboard ratio from a
 * pipeline enrichment stage — the same collision the surface had before the
 * tree was grouped.
 */
export async function listArtifacts(repo: Repository): Promise<ArtifactSummary[]> {
  const rows = await repo.workspace();
  const lineage = buildLineage(Object.fromEntries(rows.map((a) => [a.name, a.body])));

  return rows.map((a) => {
    const node = lineage.byFile[a.name];
    return {
      name: a.name,
      kind: a.kind,
      stage: node?.stage ?? null,
      revision: a.revision,
      author: a.author,
      updatedAt: a.createdAt,
      tier: node?.tier ?? 0,
      owner: node?.owner ?? '',
      runtime: node?.runtimeDetail ?? '',
      reads: node?.reads ?? '',
      writes: node?.writes ?? '',
    };
  });
}

export async function getArtifact(
  repo: Repository,
  name: string,
  revision?: number,
): Promise<Revision> {
  const found = revision === undefined
    ? await repo.latest(name)
    : await repo.revision(name, revision);
  if (!found) {
    throw new ToolError(
      revision === undefined ? `no artifact called ${name}` : `${name} has no revision ${revision}`,
    );
  }
  return found;
}

export async function getHistory(repo: Repository, name: string) {
  const entries = await repo.history(name);
  if (!entries.length) throw new ToolError(`no artifact called ${name}`);
  return entries;
}

/**
 * The rule set, resolved — which is what "registered rule details" means.
 *
 * Not the YAML. The rules in evaluation order, each with the condition that
 * selects it, the value it emits, the citation behind it, and how much of the
 * book it actually claims. An agent asking "what are the rules" wants the
 * ordered semantics, and reconstructing first-match precedence from a document
 * body is exactly the work it should not have to redo.
 */
export async function getRules(
  repo: Repository,
  name: string,
  policy: McpPolicy,
  asOf: string = AS_OF,
) {
  const docs = await workspace(repo);
  const registry = buildRegistry(docs);
  const classification = resolveClassification(registry, name, asOf);
  if (!classification) {
    throw new ToolError(`no classification called ${name} is in force at ${asOf}`);
  }

  const coverage = coverageFor(docs, name, policy.fixture);

  return {
    name: classification.name,
    column: classification.column,
    domain: classification.domain,
    notional: classification.notional,
    onNoMatch: classification.onNoMatch,
    effective: { from: classification.effectiveFrom, to: classification.effectiveTo },
    asOf,
    // Order is the semantics: the first matching rule wins, so a rule's position
    // is as much a part of its meaning as its condition.
    rules: classification.rules.map((r, i) => {
      const stat = coverage?.rules.find((x) => x.id === r.id);
      return {
        order: i + 1,
        id: r.id,
        emit: r.emit,
        label: r.label,
        when: r.when,
        citation: r.citation,
        // On the fixture, not on production — said plainly so nobody reads it
        // as a statement about the real book.
        fixtureRecords: stat?.records ?? null,
        fixtureNotional: stat?.notional ?? null,
      };
    }),
    coverage: coverage && {
      fixture: policy.fixture,
      total: coverage.total,
      matched: coverage.matched,
      unmatched: coverage.unmatched,
      unmatchedNotional: coverage.unmatchedNotional,
      offDomain: coverage.offDomain,
      unreadable: coverage.unreadable,
    },
  };
}

/** Run a rule set over the fixture the way the view that uses it would. */
function coverageFor(
  docs: Record<string, string>,
  classificationName: string,
  fixture: FixtureName,
  override?: { file: string; body: string },
) {
  const workspaceDocs = override ? { ...docs, [override.file]: override.body } : docs;
  const registry = buildRegistry(workspaceDocs);
  const classification = resolveClassification(registry, classificationName, AS_OF);
  if (!classification) return null;

  const view = Object.values(workspaceDocs)
    .map((d) => {
      try {
        return parseDoc(d);
      } catch {
        return null;
      }
    })
    .find((g): g is Graph => !!g && g.kind === 'metrics_view'
      && derivationsOf(g).some((x) => x.op === 'classify' && x.using === classificationName));
  if (!view) return null;

  const derivation = derivationsOf(view)
    .find((x) => x.op === 'classify' && x.using === classificationName)!;
  const source = (view.view.source || '').trim();
  const rows: Row[] = TABLES[fixture]?.[source]?.[AS_OF] || [];
  if (!rows.length) return null;

  return runClassification(classification, rows.map((r) => ({ ...r })), DOMAINS, derivation.name);
}

export async function getParameters(
  repo: Repository,
  name: string,
  asOf: string = AS_OF,
) {
  const registry = buildRegistry(await workspace(repo));
  const set = resolveParameterSet(registry, name, asOf);
  if (!set) throw new ToolError(`no parameter set called ${name} is in force at ${asOf}`);

  const g = set.graph;
  const value = (g.view.value || '').trim();
  return {
    name: set.name,
    keys: (g.view.keys || '').replace(/[[\]]/g, '').split(',').map((s) => s.trim()).filter(Boolean),
    valueField: value,
    effective: { from: set.effectiveFrom, to: set.effectiveTo },
    asOf,
    entries: sectionBlocks(g, 'entries').map((b) => ({
      key: b.name,
      value: b.f[value] ?? null,
      citation: b.f.citation ?? null,
    })),
  };
}

/**
 * Every document and its edges — the whole graph, for orientation.
 *
 * Split from `getLineage` rather than returned from it under a union: a caller
 * asking about one document and a caller asking about all of them want different
 * shapes, and one function returning either makes every call site branch on
 * something the type system then has to be argued with.
 */
export async function getLineageGraph(repo: Repository) {
  const lineage = buildLineage(await workspace(repo));
  return {
    nodes: lineage.nodes.map((n) => ({
      name: n.name, kind: n.kind, stage: n.stage, reads: n.reads,
      writes: n.writes, uses: n.uses, runtime: n.runtimeDetail,
    })),
  };
}

/** Where one document sits in the pipeline, and what depends on it. */
export async function getLineage(repo: Repository, name: string) {
  const lineage = buildLineage(await workspace(repo));
  const node = lineage.byName[name] || lineage.byFile[name];
  if (!node) throw new ToolError(`no artifact called ${name}`);
  const chain = chainFor(lineage, node.name);

  return {
    name: node.name,
    stage: node.stage,
    runtime: node.runtimeDetail,
    reads: node.reads,
    writes: node.writes,
    uses: node.uses,
    // Who breaks if this changes — the question behind most edits.
    usedBy: lineage.nodes.filter((n) => n.uses.includes(node.name)).map((n) => n.name),
    chain: chain.steps.map((s) => ({
      kind: s.kind, label: s.label, docs: s.docs, stage: s.stage ?? null, uses: s.uses,
    })),
    position: chain.at,
  };
}

// ---------------------------------------------------------------------------
// Authoring, without writing
// ---------------------------------------------------------------------------

export type CompileTarget = 'sql' | 'polars' | 'pyspark' | 'view' | 'dbt';

/**
 * The plan a document compiles to — including the semantic targets, so an agent
 * wiring up a dashboard gets the governed definition rather than retyping it.
 */
export async function compile(
  repo: Repository,
  name: string,
  target: CompileTarget,
  body?: string,
) {
  const docs = await workspace(repo);
  const text = body ?? docs[name];
  if (text === undefined) throw new ToolError(`no artifact called ${name}`);

  const proposed = { ...docs, [name]: text };
  const g = parse(name, text);

  if (target === 'view' || target === 'dbt') {
    if (g.kind !== 'metrics_view') {
      throw new ToolError(`${target} can only be emitted for a metrics_view, not a ${g.kind}`);
    }
    const plan = emitSemantic(g, target as SemanticTarget);
    return { target, text: plan.text, published: plan.published, issues: plan.issues };
  }

  const { spec, view } = reportAndView(proposed, name, g);
  return {
    target,
    text: compileReport(spec, view, buildRegistry(proposed), target),
    published: spec.measures,
    issues: [],
  };
}

/** Resolve a report and the view it files from, whichever end you start at. */
function reportAndView(docs: Record<string, string>, name: string, g: Graph) {
  const graphs = Object.values(docs).map((d) => {
    try {
      return parseDoc(d);
    } catch {
      return null;
    }
  }).filter((x): x is Graph => !!x);

  const reportGraph = g.kind === 'report'
    ? g
    : graphs.find((x) => x.kind === 'report'
      && readReport(x).view === (g.view.view || '').trim());
  if (!reportGraph) {
    throw new ToolError(`${name} is not a report and no report files from it`);
  }

  const spec = readReport(reportGraph);
  const view = graphs.find((x) => x.kind === 'metrics_view'
    && (x.view.view || '').trim() === spec.view);
  if (!view) throw new ToolError(`${spec.name} names a view that does not exist: ${spec.view}`);
  return { spec, view };
}

/**
 * Diagnostics for a proposed body, without saving it.
 *
 * The same catalogue the surface shows, so an agent and a person are held to one
 * standard. A second, looser set of checks for machine authors would be a way of
 * letting an agent commit what a human would have been stopped from committing.
 */
export async function validate(
  repo: Repository,
  name: string,
  body: string,
  policy: McpPolicy,
) {
  const docs = await workspace(repo);
  const proposed = { ...docs, [name]: body };
  const g = parse(name, body);

  const registry = buildRegistry(proposed);
  const evaluator = new Evaluator(g, policy.fixture, registry);
  const shipped = docs[name] ? parseDoc(docs[name]) : g;
  const diagnostics = diagnose(g, evaluator, shipped, registry, proposed);

  return {
    name,
    kind: g.kind,
    fixture: policy.fixture,
    errors: diagnostics.filter((d) => d.sev === 'error').length,
    warnings: diagnostics.filter((d) => d.sev === 'warn').length,
    diagnostics: diagnostics.map((d) => ({
      code: d.code, severity: d.sev, line: d.line + 1, message: d.message,
      fixable: !!d.fix,
    })),
  };
}

/**
 * Run a proposed rule set over the fixture and report what it does.
 *
 * The loop an agent needs: change a condition, see which records move and which
 * stop matching anything. Nothing is written, and the unmapped count is the
 * number that matters — the compiler emits no `ELSE`, so a record no rule claims
 * stays visible rather than being swept into a bucket nobody chose.
 */
export async function testRules(
  repo: Repository,
  name: string,
  policy: McpPolicy,
  body?: string,
) {
  const docs = await workspace(repo);
  const file = fileFor(docs, name, 'classification');
  const coverage = coverageFor(
    docs, name, policy.fixture,
    body === undefined ? undefined : { file, body },
  );
  if (!coverage) throw new ToolError(`${name} is not classified by any view in this workspace`);

  return {
    name,
    fixture: policy.fixture,
    total: coverage.total,
    matched: coverage.matched,
    unmatched: coverage.unmatched,
    unmatchedNotional: coverage.unmatchedNotional,
    rules: coverage.rules,
    values: coverage.values,
    // A rule that classifies nothing is either dead or pre-empted, and the two
    // need different fixes — so both are reported rather than one count.
    dead: coverage.rules.filter((r) => r.records === 0).map((r) => r.id),
    preemptedBy: coverage.preemptedBy,
    offDomain: coverage.offDomain,
    unreadable: coverage.unreadable,
  };
}

function fileFor(docs: Record<string, string>, name: string, kind: string): string {
  const hit = Object.entries(docs).find(([, body]) => {
    try {
      const g = parseDoc(body);
      return g.kind === kind && g.docName === name;
    } catch {
      return false;
    }
  });
  if (!hit) throw new ToolError(`no ${kind} called ${name}`);
  return hit[0];
}

/** The rows a report would file, from the fixture — optionally with edits applied. */
export async function previewReport(
  repo: Repository,
  name: string,
  policy: McpPolicy,
  edits?: Record<string, string>,
) {
  const docs = { ...(await workspace(repo)), ...(edits || {}) };
  const g = parse(name, docs[name] ?? '');
  const { spec, view } = reportAndView(docs, name, g);
  const result = runReport(spec, view, buildRegistry(docs), policy.fixture, AS_OF);

  return {
    report: spec.name,
    fixture: policy.fixture,
    asOf: AS_OF,
    grouping: spec.grouping,
    measures: result.measures,
    rowCount: result.rows.length,
    // Capped, and the cap is stated: a truncated answer presented as a complete
    // one is worse than no answer.
    rows: result.rows.slice(0, 200).map((r) => ({
      key: r.key,
      ...Object.fromEntries(result.measures.map((m) => [m, r.values[m]])),
    })),
    truncated: result.rows.length > 200,
  };
}

/** What a proposed edit would do — the governance question, before the write. */
export async function assessProposed(
  repo: Repository,
  name: string,
  body: string,
  policy: McpPolicy,
): Promise<ImpactReport & { name: string }> {
  const docs = await workspace(repo);
  const before = docs[name];
  if (before === undefined) throw new ToolError(`no artifact called ${name}`);
  return { name, ...assessChange(name, before, body, docs, policy.fixture) };
}

// ---------------------------------------------------------------------------
// Writing
// ---------------------------------------------------------------------------

/** Identity of a diagnostic, for telling a new error from one already there. */
function errorKey(d: { code: string; message: string }): string {
  return `${d.code}::${d.message}`;
}

// ---------------------------------------------------------------------------
// Releasing and deploying
// ---------------------------------------------------------------------------

/**
 * Cut a release — an immutable snapshot of every artifact at its current
 * revision.
 *
 * Behind the same write gate as saving, and for a sharper reason: a release is
 * the thing a channel can later point at, so an agent that can cut one can
 * stage a change for deployment. Reading releases needs no permission.
 */
export async function createRelease(
  repo: Repository,
  policy: McpPolicy,
  input: { name?: string; message: string },
) {
  if (!policy.canWrite) {
    throw new ToolError(
      'this registry connection is read-only — set KEEL_MCP_WRITE=1 to cut releases',
    );
  }
  try {
    return await cutRelease(repo, { ...input, author: policy.identity });
  } catch (err) {
    if (err instanceof RuntimeRefused) throw new ToolError(err.message);
    throw err;
  }
}

export async function listReleases(repo: Repository) {
  return repo.releases();
}

export async function getRelease(repo: Repository, version: number) {
  const found = await repo.release(version);
  if (!found) throw new ToolError(`no release r${version}`);
  return found;
}

/** What each channel serves, and when it last moved. */
export async function listChannels(repo: Repository) {
  const channels = await repo.channels();
  return Promise.all(channels.map(async (c) => ({
    ...c,
    history: (await repo.promotions(c.name)).slice(0, 5),
  })));
}

export async function getManifest(repo: Repository, channel: string) {
  try {
    return await runtimeManifest(repo, channel);
  } catch (err) {
    if (err instanceof RuntimeNotFound) throw new ToolError(err.message);
    throw err;
  }
}

/**
 * Point a channel at a release.
 *
 * The most consequential call in this server: it is the moment production
 * changes. `promoteRelease` runs the impact assessment against what the channel
 * currently serves and refuses anything that weakens a control without an
 * explicit acknowledgement — which is then recorded against the promotion.
 */
export async function promote(
  repo: Repository,
  policy: McpPolicy,
  input: {
    channel: string;
    version: number;
    message: string;
    acknowledgeReview?: boolean;
  },
) {
  if (!policy.canWrite) {
    throw new ToolError(
      'this registry connection is read-only — set KEEL_MCP_WRITE=1 to deploy',
    );
  }
  try {
    return await promoteRelease(repo, { ...input, actor: policy.identity });
  } catch (err) {
    if (err instanceof RuntimeRefused) throw new ToolError(err.message);
    if (err instanceof RuntimeNotFound) throw new ToolError(err.message);
    throw err;
  }
}

export interface SaveOutcome {
  name: string;
  revision: number;
  changed: boolean;
  impact: ImpactReport;
  /** Errors this document already had. Not this edit's fault; still real. */
  preexistingErrors: number;
}

/**
 * Save a revision — the same path a browser save takes.
 *
 * Three gates, in order, and each one exists because of a different failure:
 *
 * 1. **Writes are off unless enabled.** An agent with a registry connection
 *    should not be able to change what a bank files because somebody wired up
 *    a tool server and forgot.
 * 2. **Errors block.** An agent is held to the same catalogue as a person; a
 *    document that a human would have been stopped from saving is not one an
 *    agent gets to commit.
 * 3. **A weakening must be acknowledged explicitly.** `assessChange` runs
 *    first, and if the edit silences a control or restates filed history the
 *    save is refused unless the caller passes `acknowledgeReview`. This is the
 *    maker-checker seam in miniature: not a veto, but a step that cannot happen
 *    by accident and that lands in the revision message.
 */
export async function saveArtifact(
  repo: Repository,
  policy: McpPolicy,
  input: {
    name: string;
    body: string;
    message: string;
    kind?: string;
    expectedRevision?: number;
    acknowledgeReview?: boolean;
  },
): Promise<SaveOutcome> {
  if (!policy.canWrite) {
    throw new ToolError(
      'this registry connection is read-only — set KEEL_MCP_WRITE=1 to allow saves',
    );
  }

  const docs = await workspace(repo);
  const checks = await validate(repo, input.name, input.body, policy);

  // Block on errors this change *introduces*, not on errors that were already
  // there. `liquidity_pit` ships with two KEEL030s, so a flat "no errors" gate
  // made an unrelated edit to it impossible — an agent told to fix someone
  // else's problem before it may touch a file will either give up or fix it
  // badly, and neither is what the gate was for. Pre-existing errors are
  // reported rather than swallowed; they are just not this edit's fault.
  const wasBroken = docs[input.name] === undefined
    ? new Set<string>()
    : new Set((await validate(repo, input.name, docs[input.name], policy))
      .diagnostics.filter((d) => d.severity === 'error').map(errorKey));

  const introduced = checks.diagnostics
    .filter((d) => d.severity === 'error' && !wasBroken.has(errorKey(d)));

  if (introduced.length) {
    const first = introduced[0];
    throw new ToolError(
      `refusing to save ${input.name}: this change introduces ${introduced.length} `
      + `error(s), starting at line ${first.line} — ${first.code} ${first.message}`,
    );
  }

  const impact = docs[input.name] === undefined
    ? { findings: [], needsReview: false }
    : assessChange(input.name, docs[input.name], input.body, docs, policy.fixture);

  if (impact.needsReview && !input.acknowledgeReview) {
    const lines = impact.findings
      .filter((f) => f.direction === 'weakens')
      .map((f) => `  · ${f.summary}`);
    throw new ToolError(
      `refusing to save ${input.name} without acknowledgement — this change weakens `
      + `something:\n${lines.join('\n')}\n`
      + 'Re-send with acknowledgeReview: true if this is intended. The acknowledgement '
      + 'is recorded against the revision.',
    );
  }

  const kind = input.kind || parse(input.name, input.body).kind;
  const message = impact.needsReview
    ? `${input.message} [review acknowledged: ${
      impact.findings.filter((f) => f.direction === 'weakens').map((f) => f.summary).join('; ')
    }]`
    : input.message;

  try {
    const result = await repo.save({
      name: input.name,
      kind,
      body: input.body,
      author: policy.identity,
      message,
      ...(input.expectedRevision !== undefined
        ? { expectedRevision: input.expectedRevision }
        : {}),
    });
      return {
      name: input.name,
      ...result,
      impact,
      // Said plainly rather than hidden: this document has problems that
      // predate the change, and somebody should still fix them.
      preexistingErrors: checks.diagnostics
        .filter((d) => d.severity === 'error').length,
    };
  } catch (err) {
    // A conflict is actionable — "someone else saved first" is something an
    // agent can resolve by re-reading — so it must not arrive as a generic
    // failure.
    if (err instanceof Conflict) throw new ToolError(`conflict: ${err.message}`);
    throw err;
  }
}
