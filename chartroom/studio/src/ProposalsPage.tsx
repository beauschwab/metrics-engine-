/**
 * The steward queue — every proposal, with its evidence laid out for a
 * decision. The agent's half (drafting, validating, submitting) happened over
 * MCP; this page is the human half: read the rationale, read what the
 * validation actually found, and approve or reject with a comment.
 *
 * Since Phase 10 the queue carries three kinds (ADR-46/47). A *metric* is
 * validated by running it, and approval writes a registry revision. A *widget*
 * or *pattern* has nothing to run, so its evidence is structural — schema
 * problems and dangling references — and approval writes a catalog version.
 * Either way the decided card names the artifact the approval produced,
 * because "approved" without one would be the workflow claiming a side effect
 * it cannot prove.
 */

import { useEffect, useState } from 'react';

type ArtifactType = 'metric' | 'widget' | 'pattern';

/** Structural evidence for a catalog entry — the widget/pattern half. */
interface CatalogEvidence {
  parse: { ok: boolean; error?: string };
  name: string | null;
  version: number | null;
  schema: string[];
  references: string[];
  renderable: boolean;
  published?: { name: string; version: number };
}

/**
 * Metric evidence. Every field below the parse result is metric-only — a
 * catalog proposal has no measures to evaluate and no diagnostics to run — so
 * they are optional and read defensively. Typing them as required is what
 * made the first cut of this page crash the whole card on a widget proposal.
 */
interface Evidence {
  parse: { ok: boolean; error?: string };
  diagnostics?: {
    errors: Array<{ code: string; message: string }>;
    warnings: Array<{ code: string; message: string }>;
  };
  measures?: Array<{ name: string; value: number | null; finite: boolean }>;
  semantic?: { ok: boolean; error?: string; lineCount?: number } | null;
  registered?: { name: string; revision: number };
  validatedAgainst?: string;
}

interface Proposal {
  id: string;
  artifactType: ArtifactType;
  docName: string;
  yaml: string;
  rationale: string;
  status: 'draft' | 'submitted' | 'approved' | 'rejected';
  evidence: Evidence & Partial<CatalogEvidence>;
  author: string;
  dashboardId: string | null;
  steward: string | null;
  decisionComment: string | null;
}

const IDENTITY = { 'content-type': 'application/json', 'x-identity': 'studio-author' };

export function ProposalsPage() {
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [kind, setKind] = useState<'all' | ArtifactType>('all');
  const [open, setOpen] = useState<string | null>(null);
  const [comments, setComments] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    void fetch('/api/proposals')
      .then((r) => r.json())
      .then((r) => setProposals((r as { proposals: Proposal[] }).proposals));
  };
  useEffect(load, []);

  const decide = async (id: string, decision: 'approve' | 'reject') => {
    setError(null);
    const r = await fetch(`/api/proposals/${id}/decide`, {
      method: 'POST', headers: IDENTITY,
      body: JSON.stringify({ decision, comment: comments[id] ?? '' }),
    });
    if (!r.ok) {
      const body = await r.json() as { error?: string };
      setError(body.error ?? `the server said ${r.status}`);
      return;
    }
    setComments((c) => ({ ...c, [id]: '' }));
    load();
  };

  const visible = kind === 'all' ? proposals : proposals.filter((p) => p.artifactType === kind);

  return (
    <div className="cr-app">
      <header className="cr-header">
        <span className="cr-brand">Chartroom</span>
        <span className="cr-header-title">Proposals — steward queue</span>
        <span className="cr-header-spacer" />
        <a className="cr-header-link" href="#/">back to the studio</a>
      </header>
      <div className="cr-proposals" data-testid="proposals-page">
        <div className="cr-kind-filter" data-testid="kind-filter">
          {(['all', 'metric', 'widget', 'pattern'] as const).map((k) => (
            <button
              key={k}
              type="button"
              className="cr-kind-chip"
              data-active={kind === k || undefined}
              data-testid={`kind-${k}`}
              onClick={() => setKind(k)}
            >
              {k}
              <span className="cr-kind-count">
                {k === 'all' ? proposals.length : proposals.filter((p) => p.artifactType === k).length}
              </span>
            </button>
          ))}
        </div>
        {visible.length === 0 && (
          <p className="cr-pane-empty" data-testid="proposals-empty">
            No {kind === 'all' ? '' : `${kind} `}proposals. They arrive from agent sessions
            (<code>propose_metric</code>, <code>propose_widget</code>, <code>propose_pattern</code>)
            when intake surfaces a gap the registry or the catalog cannot fill.
          </p>
        )}
        {visible.map((p) => (
          <article key={p.id} className="cr-proposal" data-status={p.status} data-testid={`proposal-${p.id}`}>
            <header className="cr-brief-head">
              <button type="button" className="cr-proposal-toggle" onClick={() => setOpen(open === p.id ? null : p.id)}>
                <strong>{p.docName}</strong> <span className="cr-govern-detail">({p.id})</span>
              </button>
              <span className="cr-kind-chip cr-kind-badge" data-testid={`proposal-kind-${p.id}`}>
                {p.artifactType}
              </span>
              <span className="cr-status-chip" data-status={p.status} data-testid={`proposal-status-${p.id}`}>
                {p.status}
              </span>
            </header>
            <p className="cr-hint">
              proposed by {p.author}
              {p.dashboardId && <> for <strong>{p.dashboardId}</strong></>}
              {p.steward && <> · decided by <strong>{p.steward}</strong>{p.decisionComment && <>: “{p.decisionComment}”</>}</>}
              {p.evidence.registered && (
                <> · in the registry as <strong>{p.evidence.registered.name}@{p.evidence.registered.revision}</strong></>
              )}
              {p.evidence.published && (
                <> · in the catalog as <strong>{p.evidence.published.name}@{p.evidence.published.version}</strong></>
              )}
            </p>
            <p className="cr-proposal-rationale">{p.rationale}</p>

            {open === p.id && (
              <div className="cr-proposal-body">
                <h3 className="cr-side-head">
                  {p.artifactType === 'metric'
                    ? `Validation evidence (${p.evidence.validatedAgainst} workspace)`
                    : 'Validation evidence (schema and references)'}
                </h3>
                <ul className="cr-evidence" data-testid={`evidence-${p.id}`}>
                  <li data-ok={p.evidence.parse.ok}>
                    parse: {p.evidence.parse.ok ? 'ok' : p.evidence.parse.error}
                  </li>
                  {/* The catalog half: nothing to run, so the evidence is
                      structural — what the schema rejected and what the entry
                      references that does not exist. */}
                  {(p.evidence.schema ?? []).map((m, i) => (
                    <li key={`s${i}`} data-ok={false}>schema — {m}</li>
                  ))}
                  {(p.evidence.references ?? []).map((m, i) => (
                    <li key={`r${i}`} data-ok={false}>reference — {m}</li>
                  ))}
                  {p.artifactType === 'widget' && p.evidence.parse.ok && (
                    <li data-ok={p.evidence.renderable} data-testid={`renderable-${p.id}`}>
                      {p.evidence.renderable
                        ? 'an implementation exists — this contract can be drawn'
                        : 'contract-first: no renderer yet, so the catalog will carry it '
                          + 'as unrenderable until an implementation lands'}
                    </li>
                  )}
                  {(p.evidence.measures ?? []).map((m) => (
                    <li key={m.name} data-ok={m.finite}>
                      {m.name} = {m.finite ? m.value?.toLocaleString('en-US', { maximumFractionDigits: 4 }) : 'not evaluable'}
                    </li>
                  ))}
                  {p.evidence.semantic && (
                    <li data-ok={p.evidence.semantic.ok}>
                      semantic view: {p.evidence.semantic.ok
                        ? `compiles (${p.evidence.semantic.lineCount} lines)`
                        : p.evidence.semantic.error}
                    </li>
                  )}
                  {(p.evidence.diagnostics?.errors ?? []).map((d, i) => (
                    <li key={`e${i}`} data-ok={false}>{d.code}: {d.message}</li>
                  ))}
                  {(p.evidence.diagnostics?.warnings ?? []).map((d, i) => (
                    <li key={`w${i}`} data-warn>{d.code}: {d.message}</li>
                  ))}
                </ul>
                <h3 className="cr-side-head">
                  {p.artifactType === 'metric' ? 'Document' : 'Contract'}
                </h3>
                <pre className="cr-proposal-yaml">{p.yaml}</pre>
              </div>
            )}

            {p.status === 'submitted' && (
              <div className="cr-brief-actions">
                <input
                  className="cr-input"
                  placeholder={p.artifactType === 'metric'
                    ? 'decision comment (recorded, and written into the registry message)'
                    : 'decision comment (recorded with the catalog version)'}
                  value={comments[p.id] ?? ''}
                  data-testid={`decide-comment-${p.id}`}
                  onChange={(e) => setComments((c) => ({ ...c, [p.id]: e.target.value }))}
                />
                <button type="button" className="cr-save" data-testid={`approve-${p.id}`} onClick={() => void decide(p.id, 'approve')}>
                  {p.artifactType === 'metric'
                    ? 'Approve — write to registry'
                    : 'Approve — publish catalog version'}
                </button>
                <button type="button" className="cr-fix" data-testid={`reject-${p.id}`} onClick={() => void decide(p.id, 'reject')}>
                  Reject
                </button>
                {error && <p className="cr-brief-error" data-testid="decide-error">{error}</p>}
              </div>
            )}
          </article>
        ))}
      </div>
    </div>
  );
}
