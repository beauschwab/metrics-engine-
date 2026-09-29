/**
 * The grid harness (#/grid) — the treasury grid over a seeded book, in the
 * shipping bundle (ADR-7). Like the widget harness, this page is the review
 * surface: each phase of the grid lands here first, and the e2e suite reads
 * it so a cell that stops formatting from its meta is a red build.
 *
 * Fifty thousand positions, a virtualized body, and the count in the
 * header read from `describe()` — the harness knows nothing about the rows
 * that the seam did not tell it. The columns panel opens by default here so
 * the review surface shows the whole shell.
 *
 * Two sources behind the same seam (ADR-70): `#/grid` holds the book in
 * memory and the client does every stage; `#/grid?s=duckdb` loads the same
 * book into DuckDB-WASM and the view compiles to SQL, filter, sort and
 * grouping served by the engine and children fetched on expand.
 *
 * The view lives in the URL (ADR-69): `#/grid?v=…` is read on load and
 * written back on every change with `replaceState`, so a link is the state
 * and a reload is a no-op. A link that does not parse is refused with its
 * issues shown and the default view rendered — never a view that is almost
 * the one linked. Saved views go to the browser's storage here.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  TreasuryGrid, defaultView, duckdbSource, generatePositions, inMemorySource, localStorageViewStore,
  readViewFromHash, writeViewToHash, type SourceDescription, type ViewState, type ViewUpdate,
} from 'chartroom-grid';

const ROWS = 50_000;

type SourceKind = 'memory' | 'duckdb';

function sourceKind(): SourceKind {
  const q = location.hash.indexOf('?');
  return q >= 0 && new URLSearchParams(location.hash.slice(q + 1)).get('s') === 'duckdb' ? 'duckdb' : 'memory';
}

function initialView(): { view: ViewState; issues: string[] } {
  const read = readViewFromHash(location.hash);
  if (!read) return { view: defaultView(), issues: [] };
  return read.ok ? { view: read.view, issues: [] } : { view: defaultView(), issues: read.issues };
}

export function GridHarness() {
  const [kind, setKind] = useState<SourceKind>(sourceKind);
  const book = useMemo(() => generatePositions(ROWS), []);
  const source = useMemo(
    () => (kind === 'duckdb' ? duckdbSource(book, 'DuckDB-WASM') : inMemorySource(book, 'seeded book')),
    [book, kind],
  );
  const store = useMemo(() => localStorageViewStore(), []);
  const [about, setAbout] = useState<SourceDescription | null>(null);
  useEffect(() => {
    let live = true;
    setAbout(null);
    void source.describe().then((d) => { if (live) setAbout(d); });
    return () => { live = false; };
  }, [source]);

  const [{ view, issues }, setState] = useState(initialView);
  // A hash change that reaches this route with a different (or no) view is
  // a navigation, not an edit: `#/grid` after `#/grid?v=…` means the default
  // view. `replaceState` writes below fire no hashchange, so this never loops.
  useEffect(() => {
    const onHash = () => {
      setKind(sourceKind());
      const next = initialView();
      setState((prev) => (JSON.stringify(prev.view) === JSON.stringify(next.view) && next.issues.length === 0 ? prev : next));
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  const onViewChange = useCallback((update: ViewUpdate) => {
    setState((prev) => {
      const next = update(prev.view);
      history.replaceState(null, '', writeViewToHash(location.hash || '#/grid', next));
      return { view: next, issues: [] };
    });
  }, []);

  return (
    <div className="flex h-screen flex-col" data-testid="grid-harness" data-source={kind}>
      <header className="cr-header">
        <span className="cr-brand">Chartroom</span>
        <span className="cr-header-title" data-testid="grid-harness-title">
          treasury grid — phase 5, {about ? `${about.rowCount.toLocaleString('en-US')} positions as of ${about.asOf} · ${about.name}` : kind === 'duckdb' ? 'loading DuckDB-WASM…' : 'describing the source…'}
        </span>
        <span className="cr-header-spacer" />
        <a className="cr-link" href={kind === 'duckdb' ? '#/grid' : '#/grid?s=duckdb'} data-testid="grid-source-switch">
          {kind === 'duckdb' ? 'in-memory source' : 'DuckDB-WASM source'}
        </a>
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
