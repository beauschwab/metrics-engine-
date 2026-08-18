/**
 * The studio shell — dashboard list on the left, the interpreter canvas in
 * the middle, the inspector on the right (ADR-10: fixed panes, the registry
 * surface's own idiom).
 *
 * Saving is explicit and versioned. The header says which version you are on
 * and whether the draft has moved past it — the deliberate-save posture the
 * platform settled on, in the same vocabulary as the authoring surface next
 * door.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { DashboardSpec, LintReport, WidgetContract } from 'chartroom-spec';
import {
  createDashboard, loadContracts, loadDashboard, loadDashboards, loadWidgets,
  dropQueryCache, saveVersion,
  type ContractSummary, type DashboardSummary,
} from './data';
import { Canvas } from './Canvas';
import { Inspector, type Tab } from './Inspector';
import { Harness } from './Harness';
import { ProposalsPage } from './ProposalsPage';
import { ViewPage } from './ViewPage';
import { ChatPane } from './chat/ChatPane';

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
  return <Studio />;
}

function Studio() {
  const [dashboards, setDashboards] = useState<DashboardSummary[]>([]);
  const [contracts, setContracts] = useState<ContractSummary[]>([]);
  const [widgets, setWidgets] = useState<WidgetContract[]>([]);
  const [unrenderable, setUnrenderable] = useState<ReadonlySet<string>>(new Set());
  const [source, setSource] = useState<string>('…');

  const [openId, setOpenId] = useState<string | null>(null);
  // Written synchronously in open(), because the guard must see the newest
  // intent even if a fetch resolves before React commits the state.
  const openRef = useRef<string | null>(null);
  const [spec, setSpec] = useState<DashboardSpec | null>(null);
  const [save, setSave] = useState<SaveState>({ kind: 'clean', version: 0 });
  const [report, setReport] = useState<LintReport | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('widget');
  const [newId, setNewId] = useState('');
  const [newTitle, setNewTitle] = useState('');
  const [chatOpen, setChatOpen] = useState(false);

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
    void loadDashboard(id).then((r) => {
      // Two opens can be in flight (the auto-open racing a user click);
      // only the one still selected may land.
      if (openRef.current !== id) return;
      if (r.latest) {
        setSpec(r.latest.spec);
        setReport(r.latest.lintReport);
        setSave({ kind: 'clean', version: r.latest.version });
      } else {
        setSpec(null);
        setReport(null);
        setSave({ kind: 'clean', version: 0 });
      }
    });
  };

  // Server-side lint, debounced off edits — the report review sees is the
  // server's, so the one on screen is the server's too. The sequence number
  // guards the race two quick edits create: the earlier request's response
  // arriving last must not overwrite the report for a spec no longer shown.
  const lintTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lintSeq = useRef(0);
  const editSpec = useCallback((next: DashboardSpec) => {
    setSpec(next);
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

  const doSave = async () => {
    if (!spec || !openId) return;
    const version = save.kind === 'dirty' || save.kind === 'clean' ? save.version : null;
    setSave({ kind: 'saving' });
    try {
      const r = await saveVersion(openId, spec, version === 0 ? null : version);
      setSave({ kind: 'clean', version: r.version });
      setReport(r.lintReport);
      dropQueryCache();
    } catch (e) {
      setSave({ kind: 'error', message: (e as Error).message });
    }
  };

  const doCreate = async () => {
    if (!newId || !newTitle) return;
    await createDashboard(newId, newTitle);
    const list = await loadDashboards();
    setDashboards(list.dashboards);
    setNewId('');
    setNewTitle('');
    open(newId);
  };

  const selectedWidget = spec?.widgets.find((w) => w.id === selected) ?? null;

  return (
    <div className="cr-app">
      <header className="cr-header">
        <span className="cr-brand">Chartroom</span>
        <span className="cr-header-title">{spec?.dashboard.title ?? 'no dashboard open'}</span>
        {spec && (
          <span className="cr-status-chip" data-status={spec.dashboard.status}>
            {spec.dashboard.status}
          </span>
        )}
        <span className="cr-header-spacer" />
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
        <button
          type="button"
          className="cr-save"
          data-testid="save"
          disabled={!spec || save.kind === 'saving' || save.kind === 'clean'}
          onClick={() => void doSave()}
        >
          Save version
        </button>
      </header>

      <div className="cr-body">
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

        <main className="cr-main">
          {spec
            ? (
              <Canvas
                spec={spec}
                contracts={contractsByRef}
                selected={selected}
                onSelect={(id) => { setSelected(id); setTab('widget'); }}
                unrenderable={unrenderable}
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
        {chatOpen && <ChatPane dashboardId={openId} onClose={() => setChatOpen(false)} />}
      </div>
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
