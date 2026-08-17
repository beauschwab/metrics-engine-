/**
 * View mode — a pure read of the spec, shareable by URL (PRD: "View mode is a
 * pure read of the spec — shareable via URL … exportable to PDF").
 *
 * No inspector, no sidebar, no editing: the same interpreter Canvas the
 * studio uses, full-bleed, over the latest *saved* version — a reader sees
 * what review saw, never a draft in progress. Cross-filtering still works
 * because it is a declared view interaction, not an edit. Browser print is
 * the PDF export: same plan as the deck, rendered by the same interpreter.
 */

import { useEffect, useMemo, useState } from 'react';
import type { DashboardSpec } from 'chartroom-spec';
import { loadContracts, loadDashboard, type ContractSummary } from './data';
import { Canvas } from './Canvas';

export function ViewPage({ id }: { id: string }) {
  const [spec, setSpec] = useState<DashboardSpec | null>(null);
  const [version, setVersion] = useState(0);
  const [contracts, setContracts] = useState<ContractSummary[]>([]);
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    void loadContracts().then((r) => setContracts(r.contracts));
    void loadDashboard(id)
      .then((r) => {
        if (r.latest) {
          setSpec(r.latest.spec);
          setVersion(r.latest.version);
        } else setMissing(true);
      })
      .catch(() => setMissing(true));
  }, [id]);

  const byRef = useMemo(() => new Map(contracts.map((c) => [c.ref, c])), [contracts]);

  if (missing) {
    return (
      <div className="cr-pane-empty" data-testid="view-missing">
        No saved versions of “{id}” — a view is always a saved version, never a
        draft in progress.
      </div>
    );
  }
  if (!spec) return <div className="cr-pane-empty">loading…</div>;

  return (
    <div className="cr-app cr-view" data-testid="view-page">
      <header className="cr-header cr-view-head">
        <span className="cr-brand">Chartroom</span>
        <span className="cr-header-title">{spec.dashboard.title}</span>
        <span className="cr-status-chip" data-status={spec.dashboard.status}>
          {spec.dashboard.status}
        </span>
        <span className="cr-view-version">v{version}</span>
        <span className="cr-header-spacer" />
        <a className="cr-header-link cr-noprint" href={`/api/dashboards/${id}/deck.pptx`}>deck ↓</a>
        <button
          type="button"
          className="cr-header-link cr-noprint"
          onClick={() => window.print()}
        >
          print / PDF
        </button>
        <a className="cr-header-link cr-noprint" href="#/" data-testid="view-to-studio">studio</a>
      </header>
      <div className="cr-view-body">
        <Canvas spec={spec} contracts={byRef} selected={null} onSelect={() => {}} />
      </div>
    </div>
  );
}
