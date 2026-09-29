/**
 * The grid harness (#/grid) — the treasury grid over a seeded book, in the
 * shipping bundle (ADR-7). Like the widget harness, this page is the review
 * surface: each phase of the grid lands here first, and the e2e suite reads
 * it so a cell that stops formatting from its meta is a red build.
 *
 * Fifty thousand positions behind an in-memory `DataSource`, a virtualized
 * body, and the count in the header read from `describe()` — the harness
 * knows nothing about the rows that the seam did not tell it. The columns
 * panel opens by default here so the review surface shows the whole shell.
 *
 * The view lives in the URL (ADR-69): `#/grid?v=…` is read on load and
 * written back on every change with `replaceState`, so a link is the state
 * and a reload is a no-op. A link that does not parse is refused with its
 * issues shown and the default view rendered — never a view that is almost
 * the one linked. Saved views go to the browser's storage here.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  TreasuryGrid, defaultView, generatePositions, inMemorySource, localStorageViewStore,
  readViewFromHash, writeViewToHash, type SourceDescription, type ViewState, type ViewUpdate,
} from 'chartroom-grid';

const ROWS = 50_000;

function initialView(): { view: ViewState; issues: string[] } {
  const read = readViewFromHash(location.hash);
  if (!read) return { view: defaultView(), issues: [] };
  return read.ok ? { view: read.view, issues: [] } : { view: defaultView(), issues: read.issues };
}

export function GridHarness() {
  const source = useMemo(() => inMemorySource(generatePositions(ROWS), 'seeded book'), []);
  const store = useMemo(() => localStorageViewStore(), []);
  const [about, setAbout] = useState<SourceDescription | null>(null);
  useEffect(() => { void source.describe().then(setAbout); }, [source]);

  const [{ view, issues }, setState] = useState(initialView);
  const onViewChange = useCallback((update: ViewUpdate) => {
    setState((prev) => {
      const next = update(prev.view);
      history.replaceState(null, '', writeViewToHash(location.hash || '#/grid', next));
      return { view: next, issues: [] };
    });
  }, []);

  return (
    <div className="flex h-screen flex-col" data-testid="grid-harness">
      <header className="cr-header">
        <span className="cr-brand">Chartroom</span>
        <span className="cr-header-title" data-testid="grid-harness-title">
          treasury grid — phase 4, {about ? `${about.rowCount.toLocaleString('en-US')} positions as of ${about.asOf}` : 'describing the source…'}
        </span>
        <span className="cr-header-spacer" />
        <a className="cr-link" href="#/widgets">widget states</a>
        <a className="cr-link" href="#/">back to the studio</a>
      </header>
      {issues.length > 0 && (
        <div role="alert" data-testid="grid-link-refused" className="mx-5 mt-3 rounded-sm border border-destructive/60 bg-card px-3 py-2 text-xs">
          <span className="font-semibold text-breach-text">The linked view was refused</span>
          <span className="text-faint"> — showing the default view instead.</span>
          <ul className="mt-1 list-disc pl-4 text-faint">
            {issues.map((i) => <li key={i}>{i}</li>)}
          </ul>
        </div>
      )}
      <div className="min-h-0 flex-1 px-5 pt-3 pb-5">
        <div className="h-full border border-border bg-card">
          <TreasuryGrid source={source} view={view} onViewChange={onViewChange} viewStore={store} defaultSidebarOpen />
        </div>
      </div>
    </div>
  );
}
