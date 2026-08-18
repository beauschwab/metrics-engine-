/**
 * The promotion checklist as the studio shows it — the same
 * `promotionChecklist` the promote route runs, so the card and the gate
 * cannot disagree (the server re-checks anyway; this card is a view of the
 * gate, never the gate).
 *
 * Everything human-only in Phase 3 happens here: approvals per track, the
 * promote act itself, and the reading of upgrade notices. The buttons post
 * with a human identity — the same seam as brief approval — and the card
 * says what each unmet requirement needs, because a gate that only says "no"
 * teaches nobody how to get to "yes".
 */

import { useEffect, useState } from 'react';

interface Requirement {
  id: string;
  label: string;
  met: boolean;
  detail?: string;
}

interface Checklist {
  status: string;
  next: 'team' | 'certified' | null;
  requirements: Requirement[];
  approvals: Record<string, { approver: string; decision: string }>;
  upgrades: { stale: number; weakens: number };
}

interface Notice {
  doc: string;
  pinned: number;
  latest: number;
  widgets: string[];
  findings: Array<{ direction: string; summary: string; detail: string[] }>;
  weakens: boolean;
  historyUnavailable?: boolean;
}

const IDENTITY = { 'content-type': 'application/json', 'x-identity': 'studio-author' };

export function GovernCard({ dashboardId, onPromoted }: {
  dashboardId: string;
  /** Promotion writes a new version — the shell reloads the open dashboard. */
  onPromoted(): void;
}) {
  const [checklist, setChecklist] = useState<Checklist | null>(null);
  const [upgrades, setUpgrades] = useState<Notice[] | null>(null);
  const [refreshSlo, setRefreshSlo] = useState('T+0 18:00 America/New_York');
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    void fetch(`/api/dashboards/${dashboardId}/promotion`)
      .then((r) => (r.ok ? r.json() : null))
      .then((r) => setChecklist(r as Checklist | null));
    void fetch(`/api/dashboards/${dashboardId}/upgrades`)
      .then((r) => (r.ok ? r.json() : { upgrades: [] }))
      .then((r) => setUpgrades((r as { upgrades: Notice[] }).upgrades ?? []));
  };
  useEffect(load, [dashboardId]);

  const act = async (path: string, body: Record<string, unknown>) => {
    setError(null);
    const r = await fetch(path, { method: 'POST', headers: IDENTITY, body: JSON.stringify(body) });
    const data = await r.json() as { error?: string; unmet?: string[] };
    if (!r.ok) {
      setError(data.unmet?.length ? `${data.error} — ${data.unmet.join('; ')}` : data.error ?? `the server said ${r.status}`);
      return false;
    }
    load();
    return true;
  };

  const approve = (track: string) =>
    act(`/api/dashboards/${dashboardId}/approvals`, {
      track, decision: 'approve', comment: `${track} sign-off from the studio`,
    });

  const promote = async () => {
    if (!checklist?.next) return;
    const body: Record<string, unknown> = { to: checklist.next };
    if (checklist.next === 'certified') body.refresh_slo = refreshSlo;
    if (await act(`/api/dashboards/${dashboardId}/promote`, body)) onPromoted();
  };

  if (!checklist) return <div className="cr-pane-empty">loading the promotion state…</div>;

  const unmet = checklist.requirements.filter((r) => !r.met);
  const tracks = checklist.next === 'certified' ? ['peer', 'design', 'data-owner'] : ['peer'];

  return (
    <div className="cr-govern" data-testid="govern-card">
      <header className="cr-brief-head">
        <span className="cr-brief-title">Promotion</span>
        <span className="cr-status-chip" data-status={checklist.status} data-testid="govern-status">
          {checklist.status}
        </span>
      </header>

      {checklist.next === null ? (
        <p className="cr-hint" data-testid="govern-terminal">
          Certified is the last stage — changes from here are new versions under
          the same certification, and weakening upgrades appear below.
        </p>
      ) : (
        <>
          <p className="cr-hint">
            Next stage: <strong>{checklist.next}</strong>. The server re-checks
            every requirement at promote time — this list is the same
            computation, shown early.
          </p>
          <ul className="cr-govern-reqs" data-testid="govern-reqs">
            {checklist.requirements.map((r) => (
              <li key={r.id} className="cr-govern-req" data-met={r.met} data-testid={`req-${r.id}`}>
                <span className="cr-govern-mark">{r.met ? '✓' : '·'}</span>
                <span>
                  {r.label}
                  {r.detail && <span className="cr-govern-detail"> — {r.detail}</span>}
                </span>
              </li>
            ))}
          </ul>

          <h3 className="cr-side-head">Sign-offs</h3>
          <div className="cr-govern-tracks">
            {tracks.map((track) => {
              const a = checklist.approvals[track];
              return (
                <div key={track} className="cr-govern-track">
                  <span className="cr-govern-track-name">{track}</span>
                  {a?.decision === 'approve'
                    ? <span className="cr-govern-detail">approved by {a.approver}</span>
                    : (
                      <button
                        type="button"
                        className="cr-fix"
                        data-testid={`approve-${track}`}
                        onClick={() => void approve(track)}
                      >
                        Approve as {track}
                      </button>
                    )}
                </div>
              );
            })}
          </div>

          {checklist.next === 'certified' && (
            <div className="cr-field">
              <label className="cr-label" htmlFor="g-slo">refresh SLO (declared at certification)</label>
              <input
                id="g-slo"
                className="cr-input"
                data-testid="refresh-slo"
                value={refreshSlo}
                onChange={(e) => setRefreshSlo(e.target.value)}
              />
            </div>
          )}

          <div className="cr-brief-actions">
            <button
              type="button"
              className="cr-save"
              data-testid="promote"
              disabled={unmet.length > 0}
              onClick={() => void promote()}
            >
              Promote to {checklist.next}
            </button>
            {unmet.length > 0 && (
              <p className="cr-hint">{unmet.length} requirement(s) unmet — the button follows the gate.</p>
            )}
            {error && <p className="cr-brief-error" data-testid="govern-error">{error}</p>}
          </div>
        </>
      )}

      <h3 className="cr-side-head">Version pins</h3>
      {upgrades === null && <p className="cr-hint">checking pins against the registry…</p>}
      {upgrades !== null && upgrades.length === 0 && (
        <p className="cr-hint" data-testid="pins-current">Every pinned revision is the latest.</p>
      )}
      {upgrades !== null && upgrades.map((n) => (
        <div key={`${n.doc}@${n.pinned}`} className="cr-upgrade" data-weakens={n.weakens || undefined} data-testid={`upgrade-${n.doc}`}>
          <p className="cr-upgrade-head">
            <strong>{n.doc}</strong> pinned @{n.pinned}, registry at @{n.latest}
            {n.weakens && <span className="cr-upgrade-weakens"> — weakens a control</span>}
          </p>
          <p className="cr-govern-detail">widgets: {n.widgets.join(', ')}</p>
          {n.historyUnavailable
            ? <p className="cr-hint">The pinned revision could not be fetched — no diff without a registry.</p>
            : (
              <ul className="cr-upgrade-findings">
                {n.findings.map((f, i) => (
                  <li key={i} data-direction={f.direction}>{f.summary}</li>
                ))}
              </ul>
            )}
          <p className="cr-hint">
            Re-pinning is an edit: change the refs in the spec and save a
            version. Nothing re-pins silently.
          </p>
        </div>
      ))}
    </div>
  );
}
