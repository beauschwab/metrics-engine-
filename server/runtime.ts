/**
 * Releases, channels, and the runtime read path.
 *
 * The problem this layer solves: the surface autosaves every settled edit as a
 * revision, so anything that read "the latest workspace" at runtime would
 * change under a client as authors typed. The fix is not to make saving harder
 * — cheap drafts are good — but to make **deployment a separate, deliberate
 * act**:
 *
 *   edit    → a revision   (automatic, cheap, safe — nothing reads it)
 *   release → a snapshot   (every artifact pinned at one revision, immutable)
 *   promote → a deployment (a channel now points at that release)
 *
 * A runtime client never names a release. It dereferences a **channel** —
 * `production`, `staging` — and gets whatever release was last deliberately
 * promoted to it. Rollback is repointing the channel; nothing is ever edited
 * back. Every promotion is recorded with an actor and a message, so "what was
 * production computing on the 14th" is a query, not an investigation.
 *
 * Promotion is where the governance gate bites hardest. `assessChange` runs
 * between what the channel currently serves and the candidate release, and a
 * change that silences a control or restates history is refused without an
 * explicit acknowledgement — the same maker-checker seam as the MCP save gate,
 * applied at the moment it matters most: the moment production changes.
 */

import { diagnose } from '../src/engine/diagnostics';
import { Evaluator } from '../src/engine/evaluate';
import { assessChange, type Finding } from '../src/engine/impact';
import {
  adapterModel, adapterStatements, checkBinding, emitAdapterSql, readBinding,
  sourceUsage,
  type BindingIssue,
} from '../src/engine/binding';
import { buildLineage } from '../src/engine/lineage';
import { compileReport, readReport, type Backend } from '../src/engine/compile';
import { parseDoc, type Graph } from '../src/engine/parse';
import { buildRegistry, resolveClassification } from '../src/engine/registry';
import { AS_OF } from '../src/engine/fixtures';
import type { Repository, Revision } from './repository';

export class RuntimeNotFound extends Error {}
export class RuntimeRefused extends Error {
  constructor(message: string, public issues: BindingIssue[] | Finding[] = []) {
    super(message);
  }
}

const graphOf = (body: string): Graph | null => {
  try {
    return parseDoc(body);
  } catch {
    return null;
  }
};

const docsOf = (rows: Revision[]): Record<string, string> =>
  Object.fromEntries(rows.map((r) => [r.name, r.body]));

// ---------------------------------------------------------------------------
// Cutting a release
// ---------------------------------------------------------------------------

/**
 * Cut a release from the current workspace.
 *
 * The diagnostic sweep is recorded on the release rather than blocking it —
 * the shipped workspace itself carries two KEEL030s, and a release gate that
 * refuses anything imperfect is a gate people learn to work around. The one
 * hard refusal is a document that does not parse: it cannot be compiled, so a
 * release containing it is not a deployable thing, it is a broken file with a
 * version number.
 */
export async function cutRelease(
  repo: Repository,
  input: { name?: string; message: string; author: string },
) {
  const workspace = await repo.workspace();
  const docs = docsOf(workspace);

  let errors = 0;
  let warnings = 0;
  const unparseable: string[] = [];

  for (const artifact of workspace) {
    const g = graphOf(artifact.body);
    if (!g) {
      unparseable.push(artifact.name);
      continue;
    }
    try {
      const registry = buildRegistry(docs);
      const found = diagnose(g, new Evaluator(g, 'nominal', registry), g, registry, docs);
      errors += found.filter((d) => d.sev === 'error').length;
      warnings += found.filter((d) => d.sev === 'warn').length;
    } catch {
      // A document the diagnostic pass cannot even walk counts as an error;
      // silently skipping it would under-report the release's health.
      errors += 1;
    }
  }

  if (unparseable.length) {
    throw new RuntimeRefused(
      `refusing to cut a release: ${unparseable.join(', ')} does not parse. `
      + 'A release containing an unparseable document is not deployable — it is '
      + 'a broken file with a version number.',
    );
  }

  return repo.createRelease({ ...input, errors, warnings });
}

// ---------------------------------------------------------------------------
// Promoting
// ---------------------------------------------------------------------------

/**
 * Point a channel at a release, through the impact gate.
 *
 * The comparison is against **what the channel currently serves**, not against
 * the previous release by number — releases can be cut and skipped, and the
 * governance question is always "what changes for the people reading this
 * channel". The first promotion has nothing to weaken relative to and goes
 * through clean.
 */
export async function promoteRelease(
  repo: Repository,
  input: {
    channel: string;
    version: number;
    actor: string;
    message: string;
    acknowledgeReview?: boolean;
  },
) {
  const candidate = await repo.releaseWorkspace(input.version);
  if (!candidate.length) throw new RuntimeNotFound(`no release r${input.version}`);

  const current = await repo.channel(input.channel);
  const findings: Array<Finding & { artifact: string }> = [];

  if (current && current.version !== input.version) {
    const deployed = docsOf(await repo.releaseWorkspace(current.version));
    const next = docsOf(candidate);

    for (const [name, body] of Object.entries(next)) {
      const before = deployed[name];
      if (before === undefined || before === body) continue;
      const impact = assessChange(name, before, body, next);
      impact.findings.forEach((f) => findings.push({ ...f, artifact: name }));
    }
  }

  const weakenings = findings.filter((f) => f.direction === 'weakens');
  if (weakenings.length && !input.acknowledgeReview) {
    const lines = weakenings.map((f) => `  · ${f.artifact}: ${f.summary}`);
    throw new RuntimeRefused(
      `refusing to promote r${input.version} to ${input.channel} without `
      + `acknowledgement — versus what ${input.channel} currently serves, this `
      + `weakens something:\n${lines.join('\n')}\n`
      + 'Re-send with acknowledgeReview: true if intended. The acknowledgement '
      + 'is recorded against the promotion.',
      weakenings,
    );
  }

  const message = weakenings.length
    ? `${input.message} [review acknowledged: ${weakenings.map((f) => f.summary).join('; ')}]`
    : input.message;

  const channel = await repo.promote(input.channel, input.version, input.actor, message);
  return { channel, findings };
}

// ---------------------------------------------------------------------------
// The runtime read path
// ---------------------------------------------------------------------------

async function channelWorkspace(repo: Repository, channelName: string) {
  const channel = await repo.channel(channelName);
  if (!channel) {
    throw new RuntimeNotFound(
      `no channel called ${channelName} — nothing has been promoted to it`,
    );
  }
  const rows = await repo.releaseWorkspace(channel.version);
  return { channel, rows, docs: docsOf(rows) };
}

/**
 * What a channel currently serves — the poll target.
 *
 * A client caches plans keyed on `release.version` and re-fetches only when
 * the manifest's version moves. That is the entire cache-invalidation story,
 * and it works because releases are immutable: the same version is always the
 * same bytes.
 */
export async function runtimeManifest(repo: Repository, channelName: string) {
  const { channel, rows, docs } = await channelWorkspace(repo, channelName);
  const release = await repo.release(channel.version);
  const lineage = buildLineage(docs);

  return {
    channel: channel.name,
    release: {
      version: channel.version,
      name: release?.name ?? '',
      createdAt: release?.createdAt ?? '',
      promotedAt: channel.updatedAt,
      promotedBy: channel.updatedBy,
    },
    artifacts: rows.map((r) => ({
      name: r.name,
      kind: r.kind,
      stage: lineage.byFile[r.name]?.stage ?? null,
      revision: r.revision,
      contentHash: r.contentHash,
    })),
  };
}

function findReport(docs: Record<string, string>, name: string) {
  const graphs = Object.values(docs)
    .map(graphOf)
    .filter((g): g is Graph => !!g);

  const reportGraph = graphs.find((g) => g.kind === 'report' && g.docName === name);
  if (!reportGraph) throw new RuntimeNotFound(`no report called ${name} in this release`);

  const spec = readReport(reportGraph);
  const view = graphs.find(
    (g) => g.kind === 'metrics_view' && (g.view.view || '').trim() === spec.view,
  );
  if (!view) throw new RuntimeNotFound(`${name} names a view this release does not carry: ${spec.view}`);
  return { spec, view };
}

/**
 * The compiled plan for a report, as the pinned release defines it.
 *
 * Unlike the live-preview path, this serves the **whole** plan, materialize
 * step included: the caller here is the pipeline, and writing the submission
 * is precisely its job.
 *
 * With `binding`, the plan itself is untouched — the response adds the adapter
 * that presents the client's table under the canonical names. One plan
 * everywhere is the conformance story; per-system plan rewrites would be N
 * things to keep conformant.
 */
export async function runtimePlan(
  repo: Repository,
  channelName: string,
  reportName: string,
  target: Backend,
  bindingName?: string,
) {
  const { channel, docs } = await channelWorkspace(repo, channelName);
  const { spec, view } = findReport(docs, reportName);
  const registry = buildRegistry(docs);
  const text = compileReport(spec, view, registry, target);

  let adapter = null;
  if (bindingName) {
    const body = docs[bindingName];
    const g = body === undefined ? null : graphOf(body);
    if (!g || g.kind !== 'source_binding') {
      throw new RuntimeNotFound(`no source binding called ${bindingName} in this release`);
    }
    const binding = readBinding(g);
    if (binding.binds !== (view.view.source || '').trim()) {
      throw new RuntimeRefused(
        `${bindingName} binds ${binding.binds || '(nothing)'}, but ${reportName} `
        + `reads ${(view.view.source || '').trim()} — wrong binding for this report`,
      );
    }

    const usage = sourceUsage(view, registry, AS_OF, [...spec.grouping, ...spec.partitionBy]);
    const issues = checkBinding(binding, usage);
    const fatal = issues.filter((i) => i.sev === 'error');
    if (fatal.length) {
      // Refused rather than served. An adapter missing a column fails loudly in
      // the client's engine, which is survivable; one whose vocabulary can
      // never produce a value the rules test for fails silently, forever, on
      // one system — and this is the only place positioned to see that.
      throw new RuntimeRefused(
        `refusing to serve ${bindingName}: the adapter would not be faithful:\n`
        + fatal.map((i) => `  · ${i.message}`).join('\n'),
        issues,
      );
    }

    adapter = {
      binding: binding.name,
      table: binding.table,
      /** The whole thing, for a human and for a migration file. */
      sql: emitAdapterSql(binding),
      /** What to execute, in order — so no client has to split SQL itself. */
      statements: adapterStatements(binding),
      /** The same mapping as data, for clients that reshape a DataFrame. */
      model: adapterModel(binding),
      notes: issues,
    };
  }

  return {
    channel: channelName,
    release: channel.version,
    report: spec.name,
    target,
    writes: spec.table,
    text,
    adapter,
  };
}

/** The resolved rule set a release carries, in evaluation order. */
export async function runtimeRules(
  repo: Repository,
  channelName: string,
  name: string,
  asOf: string = AS_OF,
) {
  const { channel, docs } = await channelWorkspace(repo, channelName);
  const classification = resolveClassification(buildRegistry(docs), name, asOf);
  if (!classification) {
    throw new RuntimeNotFound(`no classification called ${name} is in force at ${asOf} in this release`);
  }

  return {
    channel: channelName,
    release: channel.version,
    name: classification.name,
    column: classification.column,
    domain: classification.domain,
    onNoMatch: classification.onNoMatch,
    effective: { from: classification.effectiveFrom, to: classification.effectiveTo },
    asOf,
    rules: classification.rules.map((r, i) => ({
      order: i + 1,
      id: r.id,
      emit: r.emit,
      when: r.when,
      citation: r.citation,
    })),
  };
}
