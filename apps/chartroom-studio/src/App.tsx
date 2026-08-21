/**
 * The studio shell — analyst-first, authoring behind a mode.
 *
 * v2 inverts what this surface opens as. The board, the scope it is read
 * under, and the exceptions against it are the default; the dashboard list and
 * the inspector are authoring tools that appear when you switch into author
 * mode. The panes themselves are still fixed (ADR-10) — it is which panes are
 * present that the mode decides, not where they sit.
 *
 * The mode is a route (`#/author`), not component state. It survives a reload,
 * it can be linked to, and it lives in the same hash router as `#/view/:id`
 * and `#/proposals` rather than beside it — a second, invisible notion of
 * "where am I" is how two navigation systems start disagreeing.
 *
 * Saving is explicit and versioned. The header says which version you are on
 * and whether the draft has moved past it — the deliberate-save posture the
 * platform settled on, in the same vocabulary as the authoring surface next
 * door.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { DashboardSpec, LintReport, WidgetContract } from 'chartroom-spec';
import {
  createDashboard, loadCalendar, loadContracts, loadDashboard, loadDashboards, loadWidgets,
  dropQueryCache, saveVersion,
  type Calendar, type ContractSummary, type DashboardSummary,
} from './data';
import type { AnalystEnv, Basis } from './bindings';
import { Canvas } from './Canvas';
import { Inspector, type Tab } from './Inspector';
import { Harness } from './Harness';
import { ProposalsPage } from './ProposalsPage';
import { ViewPage } from './ViewPage';
import { ChatPane } from './chat/ChatPane';
import { AnalystBar } from './analyst/AnalystBar';
import { ContextBar, useContextOptions, type CrossFilter } from './analyst/ContextBar';
import { ExceptionsPanel } from './analyst/ExceptionsPanel';
import { ExplainDrawer } from './analyst/ExplainDrawer';
import { CommandPalette, type Command } from './analyst/CommandPalette';
import { ChangesModal } from './analyst/ChangesModal';
import { exceptionsOf, type UpgradeNotice } from './analyst/exceptions';

type SaveState =
  | { kind: 'clean'; version: number }
  | { kind: 'dirty'; version: number }
  | { kind: 'saving' }
  | { kind: 'error'; message: string };

export function App() {
  const [route, setRoute] = useState(location.hash);
  useEffect(() => {
    const on = () => setRoute(location.hash);
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  if (route === '#/widgets') return <Harness />;
  if (route === '#/proposals') return <ProposalsPage />;
  const view = /^#\/view\/([a-z][a-z0-9-]*)$/.exec(route);
  if (view) return <ViewPage id={view[1]} />;
  return <Studio mode={route === '#/author' ? 'author' : 'read'} />;
}

function Studio({ mode }: { mode: 'read' | 'author' }) {
  const [dashboards, setDashboards] = useState<DashboardSummary[]>([]);
  const [contracts, setContracts] = useState<ContractSummary[]>([]);
  const [widgets, setWidgets] = useState<WidgetContract[]>([]);
  const [unrenderable, setUnrenderable] = useState<ReadonlySet<string>>(new Set());
  const [source, setSource] = useState<string>('…');
  const [calendar, setCalendar] = useState<Calendar | null>(null);

  const [openId, setOpenId] = useState<string | null>(null);
  // Written synchronously in open(), because the guard must see the newest
  // intent even if a fetch resolves before React commits the state.
  const openRef = useRef<string | null>(null);
  const [spec, setSpec] = useState<DashboardSpec | null>(null);
  // The version on record, kept beside the draft so "what have I changed" can
  // be answered without a round trip.
  const [savedSpec, setSavedSpec] = useState<DashboardSpec | null>(null);
  const [save, setSave] = useState<SaveState>({ kind: 'clean', version: 0 });
  const [report, setReport] = useState<LintReport | null>(null);
  const [upgrades, setUpgrades] = useState<UpgradeNotice[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('widget');
  const [newId, setNewId] = useState('');
  const [newTitle, setNewTitle] = useState('');
  const [chatOpen, setChatOpen] = useState(false);

  // ---- the analyst surface --------------------------------------------------
  const [asOf, setAsOf] = useState<string | null>(null);
  const [basis, setBasis] = useState<Basis>('prior_day');
  const [ctxValues, setCtxValues] = useState<Record<string, string>>({});
  const [cross, setCross] = useState<CrossFilter | null>(null);
  const [acked, setAcked] = useState<ReadonlySet<string>>(new Set());
  const [exceptionsOpen, setExceptionsOpen] = useState(true);
  const [explain, setExplain] = useState<string | null>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [changesOpen, setChangesOpen] = useState(false);
  const [history, setHistory] = useState<DashboardSpec[]>([]);

  const env: AnalystEnv = useMemo(
    () => ({ asOf, basis, params: ctxValues }),
    [asOf, basis, ctxValues],
  );

  const contractsByRef = useMemo(
    () => new Map(contracts.map((c) => [c.ref, c])),
    [contracts],
  );

  useEffect(() => {
    void loadContracts().then((r) => {
      setContracts(r.contracts);
      setSource(r.source);
    });
    void loadWidgets().then((r) => {
      setWidgets(r.widgets);
      // Approved contracts with no renderer yet — the canvas says so rather
      // than reading as a broken binding (ADR-47).
      setUnrenderable(new Set(r.unrenderable ?? []));
    });
    void loadCalendar().then(setCalendar).catch(() => setCalendar(null));
    void loadDashboards().then((r) => {
      setDashboards(r.dashboards);
      if (r.dashboards.length) open(r.dashboards[0].id);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const open = (id: string) => {
    // Idempotent: clicking the dashboard that is already open (or opening)
    // must not refetch — the response would land after any edits made in the
    // meantime and silently reset the spec to the saved version. That is a
    // data-loss bug wearing a refresh's clothes.
    if (openRef.current === id) return;
    openRef.current = id;
    setOpenId(id);
    setSelected(null);
    // Scope belongs to the board it was chosen on: a filter or a context
    // value carried across would narrow the next board by a dimension its
    // author never declared.
    setCross(null);
    setCtxValues({});
    setHistory([]);
    void loadDashboard(id).then((r) => {
      // Two opens can be in flight (the auto-open racing a user click);
      // only the one still selected may land.
      if (openRef.current !== id) return;
      if (r.latest) {
        setSpec(r.latest.spec);
        setSavedSpec(r.latest.spec);
        setReport(r.latest.lintReport);
        setSave({ kind: 'clean', version: r.latest.version });
      } else {
        setSpec(null);
        setSavedSpec(null);
        setReport(null);
        setSave({ kind: 'clean', version: 0 });
      }
    });
    void fetch(`/api/dashboards/${id}/upgrades`)
      .then((r) => (r.ok ? r.json() : { upgrades: [] }))
      .then((r) => {
        if (openRef.current === id) setUpgrades((r as { upgrades: UpgradeNotice[] }).upgrades ?? []);
      })
      .catch(() => setUpgrades([]));
  };

  // Server-side lint, debounced off edits — the report review sees is the
  // server's, so the one on screen is the server's too. The sequence number
  // guards the race two quick edits create: the earlier request's response
  // arriving last must not overwrite the report for a spec no longer shown.
  const lintTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lintSeq = useRef(0);
  const editSpec = useCallback((next: DashboardSpec) => {
    // The undo stack records the spec as it was *before* this edit, capped so
    // a long session cannot grow it without bound.
    setSpec((prev) => {
      if (prev) setHistory((h) => [...h.slice(-24), prev]);
      return next;
    });
    setSave((s) => (s.kind === 'clean' || s.kind === 'dirty'
      ? { kind: 'dirty', version: s.version }
      : s));
    if (lintTimer.current) clearTimeout(lintTimer.current);
    const seq = ++lintSeq.current;
    lintTimer.current = setTimeout(() => {
      void fetch('/api/lint', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ spec: next }),
      })
        .then((r) => (r.ok ? r.json() : null))
        .then((r) => {
          if (r && seq === lintSeq.current) setReport((r as { report: LintReport }).report);
        });
    }, 250);
  }, []);

  const undo = useCallback(() => {
    setHistory((h) => {
      if (!h.length) return h;
      setSpec(h[h.length - 1]);
      return h.slice(0, -1);
    });
  }, []);

  const doSave = useCallback(async () => {
    if (!spec || !openId) return;
    const version = save.kind === 'dirty' || save.kind === 'clean' ? save.version : null;
    setSave({ kind: 'saving' });
    try {
      const r = await saveVersion(openId, spec, version === 0 ? null : version);
      setSave({ kind: 'clean', version: r.version });
      setSavedSpec(spec);
      setReport(r.lintReport);
      setHistory([]);
      setChangesOpen(false);
      dropQueryCache();
    } catch (e) {
      setSave({ kind: 'error', message: (e as Error).message });
    }
  }, [spec, openId, save]);

  const doCreate = async () => {
    if (!newId || !newTitle) return;
    await createDashboard(newId, newTitle);
    const list = await loadDashboards();
    setDashboards(list.dashboards);
    setNewId('');
    setNewTitle('');
    open(newId);
  };

  const setMode = useCallback((next: 'read' | 'author') => {
    location.hash = next === 'author' ? '#/author' : '';
  }, []);

  const selectedWidget = spec?.widgets.find((w) => w.id === selected) ?? null;
  const explainWidget = spec?.widgets.find((w) => w.id === explain) ?? null;
  const contextOptions = useContextOptions(spec);

  const exceptions = useMemo(
    () => exceptionsOf(report, upgrades, acked),
    [report, upgrades, acked],
  );

  const scopeDirty = asOf !== null || basis !== 'prior_day'
    || Object.keys(ctxValues).length > 0 || cross !== null;

  const resetScope = useCallback(() => {
    setAsOf(null);
    setBasis('prior_day');
    setCtxValues({});
    setCross(null);
  }, []);

  // ---- keyboard -------------------------------------------------------------
  const commands: Command[] = useMemo(() => [
    ...dashboards.map((d) => ({
      label: `Open ${d.title}`, hint: d.id, run: () => open(d.id),
    })),
    ...(calendar?.dates ?? []).slice().reverse().slice(0, 12).map((d) => ({
      label: `As-of ${d}`,
      hint: 'date',
      run: () => setAsOf(d === calendar?.latest ? null : d),
    })),
    { label: 'Compare vs prior day', hint: 'basis', run: () => setBasis('prior_day') },
    { label: 'Compare vs prior week', hint: 'basis', run: () => setBasis('prior_week') },
    { label: 'Compare vs month-end', hint: 'basis', run: () => setBasis('month_end') },
    {
      label: mode === 'author' ? 'Switch to read mode' : 'Switch to author mode',
      hint: 'r',
      run: () => setMode(mode === 'author' ? 'read' : 'author'),
    },
    { label: 'Show changes against the saved version', hint: 'd', run: () => setChangesOpen(true) },
    { label: 'Save version', hint: '⌘S', run: () => void doSave() },
    { label: 'Undo the last edit', hint: '⌘Z', run: undo },
    { label: 'Open the agent', hint: 'a', run: () => setChatOpen(true) },
    {
      label: 'Findings and the data critic',
      hint: 'l',
      run: () => { setMode('author'); setTab('findings'); },
    },
    { label: 'Reset the scope', hint: 'scope', run: resetScope },
    { label: 'Proposals — steward queue', hint: 'route', run: () => { location.hash = '#/proposals'; } },
    { label: 'Widget states harness', hint: 'route', run: () => { location.hash = '#/widgets'; } },
    ...(openId
      ? [{ label: 'Reader view of this board', hint: 'route', run: () => { location.hash = `#/view/${openId}`; } }]
      : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [dashboards, calendar, mode, openId, doSave, undo, resetScope, setMode]);

  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName ?? '';
      const typing = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
      const meta = e.metaKey || e.ctrlKey;
      if (meta && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPaletteOpen((p) => !p);
        return;
      }
      // The palette owns the keyboard while it is open — it has its own
      // Escape and Enter, and a bare `r` typed into its box is a search, not
      // a mode switch.
      if (paletteOpen) return;
      if (meta && e.key.toLowerCase() === 'z') { e.preventDefault(); undo(); return; }
      if (meta && e.key.toLowerCase() === 's') { e.preventDefault(); void doSave(); return; }
      if (e.key === 'Escape') { setChangesOpen(false); setExplain(null); return; }
      if (typing || meta) return;
      if (e.key === 'a') setChatOpen((c) => !c);
      if (e.key === 'e') setExceptionsOpen((x) => !x);
      if (e.key === 'r') setMode(mode === 'author' ? 'read' : 'author');
      if (e.key === 'd') setChangesOpen(true);
      if (e.key === 'l') { setMode('author'); setTab('findings'); }
    };
    document.addEventListener('keydown', on);
    return () => document.removeEventListener('keydown', on);
  }, [paletteOpen, undo, doSave, mode, setMode]);

  const author = mode === 'author';
  const showExceptions = exceptionsOpen && exceptions.length > 0;
  // A board that declares no context params, with nothing filtered and the
  // scope untouched, has nothing to put in the bar — and the as-of is already
  // stated in the header. An empty 36px strip would be chrome for its own sake.
  const showContext = !!spec && (
    Object.keys(spec.context).length > 0 || cross !== null || scopeDirty
  );

  return (
    <div className="cr-app" data-mode={mode}>
      <header className="cr-header">
        <span className="cr-brand">Chartroom</span>
        <span className="cr-header-title">{spec?.dashboard.title ?? 'no dashboard open'}</span>
        {spec && (
          <span className="cr-status-chip" data-status={spec.dashboard.status}>
            {spec.dashboard.status}
          </span>
        )}
        <span className="cr-header-spacer" />

        <AnalystBar
          calendar={calendar}
          asOf={asOf}
          basis={basis}
          onAsOf={setAsOf}
          onBasis={setBasis}
          exceptionCount={exceptions.length}
          exceptionsOpen={showExceptions}
          onToggleExceptions={() => setExceptionsOpen((x) => !x)}
          mode={mode}
          onToggleMode={() => setMode(author ? 'read' : 'author')}
        />

        {author && (
          <>
            {openId && save.kind === 'clean' && save.version > 0 && (
              <>
                <a
                  className="cr-header-link"
                  href={`#/view/${openId}`}
                  data-testid="open-view"
                  title="The shareable read-only view of the latest saved version"
                >
                  view
                </a>
                <a
                  className="cr-header-link"
                  href={`/api/dashboards/${openId}/deck.pptx`}
                  data-testid="export-deck"
                  title="The committee pack: the saved version's numbers, as native PPTX charts"
                >
                  deck ↓
                </a>
              </>
            )}
            <button
              type="button"
              className="cr-header-link cr-chat-toggle"
              data-testid="open-chat"
              data-open={chatOpen || undefined}
              onClick={() => setChatOpen((o) => !o)}
            >
              agent ✳
            </button>
            <a className="cr-header-link" href="#/proposals" data-testid="nav-proposals">proposals</a>
            <span className="cr-registry-source" data-source={source} title={
              source === 'shipped'
                ? 'no registry process reachable — contracts derive from the shipped documents'
                : 'contracts derive from the live registry'
            }>
              registry: {source}
            </span>
            <SaveLabel state={save} />
            {history.length > 0 && (
              <button
                type="button"
                className="cr-header-link"
                data-testid="undo"
                title="⌘Z"
                onClick={undo}
              >
                undo ({history.length})
              </button>
            )}
            <button
              type="button"
              className="cr-header-link"
              data-testid="open-changes"
              title="Press d"
              onClick={() => setChangesOpen(true)}
            >
              changes
            </button>
            <button
              type="button"
              className="cr-save"
              data-testid="save"
              disabled={!spec || save.kind === 'saving' || save.kind === 'clean'}
              onClick={() => void doSave()}
            >
              Save version
            </button>
          </>
        )}

        {!author && (
          <>
            <button
              type="button"
              className="cr-header-link cr-chat-toggle"
              data-testid="open-chat"
              data-open={chatOpen || undefined}
              onClick={() => setChatOpen((o) => !o)}
            >
              agent ✳
            </button>
            <span className="cr-kbd" title="Command palette">⌘K</span>
          </>
        )}
      </header>

      {showContext && spec && (
        <ContextBar
          spec={spec}
          values={ctxValues}
          options={contextOptions}
          onValue={(name, value) => setCtxValues((v) => ({ ...v, [name]: value }))}
          cross={cross}
          onClearCross={() => setCross(null)}
          asOf={asOf}
          dirty={scopeDirty}
          onReset={resetScope}
        />
      )}

      {showExceptions && (
        <ExceptionsPanel
          exceptions={exceptions}
          onAck={(id) => setAcked((a) => new Set(a).add(id))}
          onHide={() => setExceptionsOpen(false)}
          onSelect={(widget) => { setMode('author'); setSelected(widget); setTab('widget'); }}
        />
      )}

      <div className="cr-body">
        {author && (
          <aside className="cr-sidebar" data-testid="sidebar">
            <h2 className="cr-side-head">Dashboards</h2>
            <ul className="cr-dash-list">
              {dashboards.map((d) => (
                <li key={d.id}>
                  <button
                    type="button"
                    className="cr-dash-item"
                    data-open={openId === d.id || undefined}
                    data-testid={`dash-${d.id}`}
                    onClick={() => open(d.id)}
                  >
                    <span className="cr-dash-title">{d.title}</span>
                    <span className="cr-dash-meta">{d.id} · {d.status}</span>
                  </button>
                </li>
              ))}
            </ul>
            <div className="cr-new-dash">
              <input
                className="cr-input"
                placeholder="slug-id"
                value={newId}
                data-testid="new-id"
                onChange={(e) => setNewId(e.target.value)}
              />
              <input
                className="cr-input"
                placeholder="Title"
                value={newTitle}
                data-testid="new-title"
                onChange={(e) => setNewTitle(e.target.value)}
              />
              <button type="button" className="cr-fix" data-testid="new-create" onClick={() => void doCreate()}>
                New dashboard
              </button>
            </div>
            <h2 className="cr-side-head">Registry functions</h2>
            <ul className="cr-contract-list">
              {contracts.map((c) => (
                <li key={c.ref} className="cr-contract" title={c.description ?? c.ref}>
                  <span className="cr-contract-name">{c.doc}.{c.measure}</span>
                  <span className="cr-contract-meta">
                    @{c.version} · {c.unit}{c.status === 'approved' ? ' · ✓ governed' : ''}
                  </span>
                </li>
              ))}
            </ul>
          </aside>
        )}

        <main className="cr-main">
          {spec
            ? (
              <Canvas
                spec={spec}
                contracts={contractsByRef}
                selected={selected}
                onSelect={(id) => { setSelected(id); setTab('widget'); }}
                unrenderable={unrenderable}
                env={env}
                cross={cross}
                onCross={setCross}
                onExplain={setExplain}
              />
            )
            : (
              <div className="cr-pane-empty" data-testid="no-dashboard">
                {openId
                  ? 'This dashboard has no versions yet — open the Source tab and paste a spec.'
                  : 'Create or open a dashboard on the left.'}
              </div>
            )}
        </main>

        {author && (
          <Inspector
            spec={spec ?? EMPTY_SPEC}
            selected={selectedWidget}
            contracts={contracts}
            widgets={widgets}
            report={report}
            tab={tab}
            dashboardId={openId}
            onTab={setTab}
            onSpec={editSpec}
            onSelect={(id) => { setSelected(id); setTab('widget'); }}
            onReload={() => {
              // Promotion saved a new version server-side; drop the idempotence
              // guard so open() actually refetches, and refresh the list chips.
              if (openId) {
                openRef.current = null;
                open(openId);
              }
              void loadDashboards().then((r) => setDashboards(r.dashboards));
            }}
          />
        )}
        {chatOpen && <ChatPane dashboardId={openId} onClose={() => setChatOpen(false)} />}
      </div>

      {explainWidget && spec && (
        <ExplainDrawer
          widget={explainWidget}
          spec={spec}
          contract={contractsByRef.get(explainWidget.bind.metric)}
          asOf={asOf}
          basis={basis}
          params={ctxValues}
          onClose={() => setExplain(null)}
        />
      )}

      {changesOpen && spec && (
        <ChangesModal
          spec={spec}
          saved={savedSpec}
          version={save.kind === 'clean' || save.kind === 'dirty' ? save.version : 0}
          canUndo={history.length > 0}
          saveDisabled={!spec || save.kind === 'saving' || save.kind === 'clean'}
          onUndo={undo}
          onSave={() => void doSave()}
          onClose={() => setChangesOpen(false)}
        />
      )}

      {paletteOpen && (
        <CommandPalette commands={commands} onClose={() => setPaletteOpen(false)} />
      )}
    </div>
  );
}

function SaveLabel({ state }: { state: SaveState }) {
  if (state.kind === 'saving') return <span className="cr-save-state">saving…</span>;
  if (state.kind === 'error') {
    return <span className="cr-save-state" data-error title={state.message}>{state.message}</span>;
  }
  if (state.kind === 'dirty') {
    return (
      <span className="cr-save-state" data-dirty data-testid="save-state">
        edited since v{state.version}
      </span>
    );
  }
  return (
    <span className="cr-save-state" data-testid="save-state">
      {state.version ? `v${state.version}` : 'unsaved'}
    </span>
  );
}

/** The inspector needs *a* spec even before one is open; never rendered. */
const EMPTY_SPEC: DashboardSpec = {
  chartroom: '0.1',
  dashboard: {
    id: 'empty', title: 'empty', pattern: { none: { justification: 'placeholder only' } },
    audience: 'alm-analyst', cadence: 'eod', status: 'draft',
  },
  context: {},
  layout: { grid: { cols: 12, row_height: 96 } },
  widgets: [{
    id: 'placeholder', type: 'kpi-tile@1', pos: { x: 0, y: 0, w: 3, h: 2 },
    bind: { metric: 'keel://none.none@1' },
  }],
  interactions: [],
};
