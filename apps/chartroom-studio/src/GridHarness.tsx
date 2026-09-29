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
 */

import { useEffect, useMemo, useState } from 'react';
import { TreasuryGrid, generatePositions, inMemorySource, type SourceDescription } from 'chartroom-grid';

const ROWS = 50_000;

export function GridHarness() {
  const source = useMemo(() => inMemorySource(generatePositions(ROWS), 'seeded book'), []);
  const [about, setAbout] = useState<SourceDescription | null>(null);
  useEffect(() => { void source.describe().then(setAbout); }, [source]);

  return (
    <div className="flex h-screen flex-col" data-testid="grid-harness">
      <header className="cr-header">
        <span className="cr-brand">Chartroom</span>
        <span className="cr-header-title" data-testid="grid-harness-title">
          treasury grid — phase 2, {about ? `${about.rowCount.toLocaleString('en-US')} positions as of ${about.asOf}` : 'describing the source…'}
        </span>
        <span className="cr-header-spacer" />
        <a className="cr-link" href="#/widgets">widget states</a>
        <a className="cr-link" href="#/">back to the studio</a>
      </header>
      <div className="min-h-0 flex-1 px-5 pt-3 pb-5">
        <div className="h-full border border-border bg-card">
          <TreasuryGrid source={source} defaultSidebarOpen />
        </div>
      </div>
    </div>
  );
}
