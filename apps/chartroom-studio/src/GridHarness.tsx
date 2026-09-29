/**
 * The grid harness (#/grid) — the treasury grid over a seeded book, in the
 * shipping bundle (ADR-7). Like the widget harness, this page is the review
 * surface: each phase of the grid lands here first, and the e2e suite reads
 * it so a cell that stops formatting from its meta is a red build.
 *
 * Phase 0: a few hundred rows, plain table. Phase 1 turns the count up to
 * 50,000 and virtualizes the body. The chrome is the studio's header; the
 * frame around the grid is Tailwind on the grid's theme (ADR-65).
 */

import { useMemo } from 'react';
import { TreasuryGrid, generatePositions } from 'chartroom-grid';

const ROWS = 200;

export function GridHarness() {
  const rows = useMemo(() => generatePositions(ROWS), []);
  return (
    <div className="flex h-screen flex-col" data-testid="grid-harness">
      <header className="cr-header">
        <span className="cr-brand">Chartroom</span>
        <span className="cr-header-title">treasury grid — phase 0, {ROWS.toLocaleString('en-US')} seeded positions</span>
        <span className="cr-header-spacer" />
        <a className="cr-link" href="#/widgets">widget states</a>
        <a className="cr-link" href="#/">back to the studio</a>
      </header>
      <div className="min-h-0 flex-1 px-5 pt-3 pb-5">
        <div className="h-full border border-border bg-card">
          <TreasuryGrid rows={rows} />
        </div>
      </div>
    </div>
  );
}
