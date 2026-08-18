/**
 * Metric proposals — the governed path for "the registry doesn't have my
 * calculation" (implementation spec §9, PRD E3.1).
 *
 * A gap surfaced at intake never becomes inlined math; it becomes a proposal:
 * a KEEL YAML document, validated through the *real engine* — parsed,
 * diagnosed with the full catalogue, every measure evaluated against the
 * fixtures, the semantic view DDL compiled — with the evidence stored on the
 * proposal. That evidence is the SR 11-7 artifact: the steward reads what the
 * validation actually found, not what the proposer claims.
 *
 * The decision is a human act (the API refuses agent identities), and
 * approval's real effect is a write to the KEEL registry itself — the
 * proposal table holds the workflow, the registry holds the truth. If no
 * registry process is running, approval refuses rather than pretending: a
 * proposal "approved" into nowhere would be the workflow lying about its one
 * meaningful side effect.
 */

import { diagnose } from 'keel-engine/diagnostics';
import { Evaluator } from 'keel-engine/evaluate';
import { emitSemantic } from 'keel-engine/semantic';
import { parseDoc, type Graph } from 'keel-engine/parse';
import { buildRegistry } from 'keel-engine/registry';
import type { RegistryState } from './keel';

export interface DiagnosticNote {
  code: string;
  sev: string;
  message: string;
}

export interface ProposalEvidence {
  parse: { ok: boolean; error?: string };
  kind: string | null;
  /** The document's own name — refs and the registry write both use it. */
  docName: string | null;
  diagnostics: { errors: DiagnosticNote[]; warnings: DiagnosticNote[] };
  /** Every measure evaluated on the nominal fixture — finite or not. */
  measures: Array<{ name: string; value: number | null; finite: boolean }>;
  /** The compiled semantic view, when the document is a metrics view. */
  semantic: { ok: boolean; error?: string; lineCount?: number } | null;
  /** Filled at approval: the registry revision the document became. */
  registered?: { name: string; revision: number };
  validatedAgainst: 'registry' | 'shipped';
}

/**
 * Validate a proposed document exactly as the authoring surface would see it:
 * inside the current workspace, so cross-document references resolve and the
 * diagnostics mean what they would mean after approval.
 */
export function validateProposal(yaml: string, state: RegistryState): ProposalEvidence {
  const evidence: ProposalEvidence = {
    parse: { ok: false },
    kind: null,
    docName: null,
    diagnostics: { errors: [], warnings: [] },
    measures: [],
    semantic: null,
    validatedAgainst: state.source,
  };

  let graph: Graph;
  try {
    graph = parseDoc(yaml);
    evidence.parse = { ok: true };
    evidence.kind = graph.kind;
    evidence.docName = graph.docName || null;
  } catch (e) {
    evidence.parse = { ok: false, error: e instanceof Error ? e.message : String(e) };
    return evidence;
  }

  const docs = Object.fromEntries(state.docs.map((d) => [d.name, d.body]));
  docs[graph.docName] = yaml;
  const registry = buildRegistry(docs);
  const evaluator = new Evaluator(graph, 'nominal', registry);

  try {
    const found = diagnose(graph, evaluator, graph, registry, docs);
    for (const d of found) {
      const note = { code: d.code, sev: d.sev, message: d.message };
      if (d.sev === 'error') evidence.diagnostics.errors.push(note);
      else if (d.sev === 'warn') evidence.diagnostics.warnings.push(note);
    }
  } catch (e) {
    evidence.diagnostics.errors.push({
      code: 'VALIDATION',
      sev: 'error',
      message: `the diagnostic pass could not walk this document: ${e instanceof Error ? e.message : e}`,
    });
  }

  if (graph.kind === 'metrics_view') {
    for (const m of graph.measures) {
      try {
        const v = evaluator.value(m.name).v;
        evidence.measures.push({ name: m.name, value: Number.isFinite(v) ? v : null, finite: Number.isFinite(v) });
      } catch (e) {
        evidence.measures.push({ name: m.name, value: null, finite: false });
        evidence.diagnostics.errors.push({
          code: 'EVAL', sev: 'error',
          message: `${m.name} failed to evaluate: ${e instanceof Error ? e.message : e}`,
        });
      }
    }
    try {
      const plan = emitSemantic(graph, 'view');
      evidence.semantic = { ok: true, lineCount: plan.text.split('\n').length };
    } catch (e) {
      evidence.semantic = { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  }

  return evidence;
}

/** What blocks submission — parse failures and diagnostic errors, by name. */
export function submitBlockers(evidence: ProposalEvidence): string[] {
  const out: string[] = [];
  if (!evidence.parse.ok) out.push(`the document does not parse: ${evidence.parse.error}`);
  for (const e of evidence.diagnostics.errors) out.push(`${e.code}: ${e.message}`);
  for (const m of evidence.measures.filter((x) => !x.finite)) {
    out.push(`${m.name} does not evaluate to a finite number on the nominal fixture`);
  }
  if (evidence.semantic && !evidence.semantic.ok) {
    out.push(`the semantic view does not compile: ${evidence.semantic.error}`);
  }
  return out;
}

/**
 * Write an approved proposal's document into the KEEL registry.
 *
 * Returns the new revision, or throws with the registry's own message. The
 * steward's identity rides as the author — the registry's history should say
 * who put the document there, and that is the approver, not the agent.
 */
export async function registerDocument(
  name: string,
  yaml: string,
  steward: string,
  message: string,
): Promise<number> {
  const API = process.env.KEEL_API || 'http://127.0.0.1:8787';
  let res: Response;
  try {
    res = await fetch(`${API}/api/artifacts/${encodeURIComponent(name)}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ body: yaml, author: steward, message }),
    });
  } catch {
    throw new Error(
      'the KEEL registry is not reachable — approval writes the document into the '
      + 'registry, and there is no registry to write to. Start it (npm run server) and decide again.',
    );
  }
  const data = (await res.json()) as { revision?: number; error?: string };
  if (!res.ok || typeof data.revision !== 'number') {
    throw new Error(`the registry refused the document: ${data.error ?? res.status}`);
  }
  return data.revision;
}
