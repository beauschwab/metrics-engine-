/**
 * The steward queue — every metric proposal, with the engine's evidence laid
 * out for a decision. The agent's half (drafting, validating, submitting)
 * happened over MCP; this page is the human half: read the rationale, read
 * what the validation actually found, and approve or reject with a comment.
 *
 * Approval's real act is a registry write — the decided card shows the
 * revision the document became, because "approved" without a revision number
 * would be the workflow claiming a side effect it cannot prove.
 */

import { useEffect, useState } from 'react';

interface Evidence {
  parse: { ok: boolean; error?: string };
  diagnostics: {
    errors: Array<{ code: string; message: string }>;
    warnings: Array<{ code: string; message: string }>;
  };
  measures: Array<{ name: string; value: number | null; finite: boolean }>;
  semantic: { ok: boolean; error?: string; lineCount?: number } | null;
  registered?: { name: string; revision: number };
  validatedAgainst: string;
}

interface Proposal {
  id: string;
  docName: string;
  yaml: string;
  rationale: string;
  status: 'draft' | 'submitted' | 'approved' | 'rejected';
  evidence: Evidence;
  author: string;
  dashboardId: string | null;
  steward: string | null;
  decisionComment: string | null;
}

const IDENTITY = { 'content-type': 'application/json', 'x-identity': 'studio-author' };

export function ProposalsPage() {
  const [proposals, setProposals] = useState<Proposal[]>([]);
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

  return (
    <div className="cr-app">
      <header className="cr-header">
        <span className="cr-brand">Chartroom</span>
        <span className="cr-header-title">Metric proposals — steward queue</span>
        <span className="cr-header-spacer" />
        <a className="cr-header-link" href="#/">back to the studio</a>
      </header>
      <div className="cr-proposals" data-testid="proposals-page">
        {proposals.length === 0 && (
          <p className="cr-pane-empty" data-testid="proposals-empty">
            No proposals. They arrive from agent sessions (<code>propose_metric</code>)
            when intake surfaces a metric the registry lacks.
          </p>
        )}
        {proposals.map((p) => (
          <article key={p.id} className="cr-proposal" data-status={p.status} data-testid={`proposal-${p.id}`}>
            <header className="cr-brief-head">
              <button type="button" className="cr-proposal-toggle" onClick={() => setOpen(open === p.id ? null : p.id)}>
                <strong>{p.docName}</strong> <span className="cr-govern-detail">({p.id})</span>
              </button>
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
            </p>
            <p className="cr-proposal-rationale">{p.rationale}</p>

            {open === p.id && (
              <div className="cr-proposal-body">
                <h3 className="cr-side-head">Validation evidence ({p.evidence.validatedAgainst} workspace)</h3>
                <ul className="cr-evidence" data-testid={`evidence-${p.id}`}>
                  <li data-ok={p.evidence.parse.ok}>
                    parse: {p.evidence.parse.ok ? 'ok' : p.evidence.parse.error}
                  </li>
                  {p.evidence.measures.map((m) => (
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
                  {p.evidence.diagnostics.errors.map((d, i) => (
                    <li key={`e${i}`} data-ok={false}>{d.code}: {d.message}</li>
                  ))}
                  {p.evidence.diagnostics.warnings.map((d, i) => (
                    <li key={`w${i}`} data-warn>{d.code}: {d.message}</li>
                  ))}
                </ul>
                <h3 className="cr-side-head">Document</h3>
                <pre className="cr-proposal-yaml">{p.yaml}</pre>
              </div>
            )}

            {p.status === 'submitted' && (
              <div className="cr-brief-actions">
                <input
                  className="cr-input"
                  placeholder="decision comment (recorded, and written into the registry message)"
                  value={comments[p.id] ?? ''}
                  data-testid={`decide-comment-${p.id}`}
                  onChange={(e) => setComments((c) => ({ ...c, [p.id]: e.target.value }))}
                />
                <button type="button" className="cr-save" data-testid={`approve-${p.id}`} onClick={() => void decide(p.id, 'approve')}>
                  Approve — write to registry
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
