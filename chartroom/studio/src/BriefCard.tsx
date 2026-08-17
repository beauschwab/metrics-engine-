/**
 * The design brief as an approvable card — the human half of the maker-checker
 * seam. An agent (or a colleague) drafts the brief; whoever reviews it here
 * reads the eight intake slots, the pattern decision, the bindings and the
 * exclusions, and either approves or goes back to the conversation.
 *
 * Approval is the one action in the studio the server will refuse an agent —
 * the button below posts with a *human* identity, and that identity is why it
 * works. The card also says what approval unlocks, because a gate whose
 * consequences are invisible reads as bureaucracy rather than governance.
 */

import { useEffect, useState } from 'react';
import type { Brief, BriefStatus } from 'chartroom-spec';

export interface BriefRow {
  version: number;
  brief: Brief;
  status: BriefStatus;
  author: string;
  approvedBy: string | null;
  approvedAt: string | null;
  createdAt: string;
}

const SLOT_LABELS: Array<[keyof Brief['intake'], string]> = [
  ['decision', 'Decision this dashboard supports'],
  ['audience', 'Audience'],
  ['cadence', 'Cadence'],
  ['grain_entities', 'Grain & entities'],
  ['comparisons', 'Comparisons'],
  ['thresholds', 'Thresholds'],
  ['sharing_scope', 'Sharing scope'],
  ['existing_overlap', 'Existing overlap'],
];

export function BriefCard({ dashboardId }: { dashboardId: string }) {
  const [row, setRow] = useState<BriefRow | null | 'missing'>(null);
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    void fetch(`/api/dashboards/${dashboardId}/brief`)
      .then(async (r) => {
        if (r.status === 404) return 'missing' as const;
        const body = await r.json() as { brief: BriefRow };
        return body.brief;
      })
      .then(setRow)
      .catch(() => setRow('missing'));
  };
  useEffect(load, [dashboardId]);

  const approve = async () => {
    setError(null);
    const r = await fetch(`/api/dashboards/${dashboardId}/brief/approve`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-identity': 'studio-author' },
    });
    if (!r.ok) {
      const body = await r.json() as { error?: string };
      setError(body.error ?? `the server said ${r.status}`);
      return;
    }
    load();
  };

  if (row === null) return <div className="cr-pane-empty">loading the brief…</div>;
  if (row === 'missing') {
    return (
      <div className="cr-pane-empty" data-testid="brief-missing">
        No brief exists for this dashboard yet. Briefs arrive from the agent
        conversation (via <code>create_brief</code>) — the intake interview
        happens there, the approval happens here.
      </div>
    );
  }

  const b = row.brief;
  return (
    <div className="cr-brief" data-testid="brief-card" data-status={row.status}>
      <header className="cr-brief-head">
        <span className="cr-brief-title">Design brief v{row.version}</span>
        <span className="cr-brief-status" data-status={row.status} data-testid="brief-status">
          {row.status}
        </span>
      </header>
      <p className="cr-brief-byline">
        drafted by <strong>{row.author}</strong>
        {row.status === 'approved' && row.approvedBy && (
          <> · approved by <strong>{row.approvedBy}</strong></>
        )}
      </p>

      <dl className="cr-brief-slots">
        {SLOT_LABELS.map(([key, label]) => (
          <div key={key} className="cr-brief-slot">
            <dt>{label}</dt>
            <dd>{String(b.intake[key])}</dd>
          </div>
        ))}
        <div className="cr-brief-slot">
          <dt>Pattern</dt>
          <dd>
            {'ref' in b.pattern
              ? <>{b.pattern.ref}{b.pattern.deviations.length > 0 && <> — deviations: {b.pattern.deviations.join('; ')}</>}</>
              : <>none — {b.pattern.none.justification}</>}
          </dd>
        </div>
      </dl>

      <h3 className="cr-side-head">Metric bindings</h3>
      <ul className="cr-brief-bindings">
        {b.bindings.map((bind, i) => (
          <li key={i}>
            <span className="cr-brief-slot-name">{bind.widget_slot}</span>
            <span className="cr-brief-metric">{bind.metric}</span>
          </li>
        ))}
      </ul>

      {b.excluded.length > 0 && (
        <>
          <h3 className="cr-side-head">Asked for, excluded</h3>
          <ul className="cr-brief-excluded">
            {b.excluded.map((e, i) => <li key={i}><strong>{e.what}</strong> — {e.why}</li>)}
          </ul>
        </>
      )}

      <pre className="cr-brief-wireframe">{b.wireframe}</pre>

      {row.status === 'draft' && (
        <div className="cr-brief-actions">
          <p className="cr-hint">
            Approving unlocks composition for the agent session that drafted
            this. Editing the brief afterwards re-locks it.
          </p>
          <button type="button" className="cr-save" data-testid="brief-approve" onClick={() => void approve()}>
            Approve brief
          </button>
          {error && <p className="cr-brief-error">{error}</p>}
        </div>
      )}
    </div>
  );
}
