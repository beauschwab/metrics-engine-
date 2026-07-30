/**
 * Metrics Definition Layer — the authoring surface.
 *
 * Three columns: the measures tree, the editor, and the validation column.
 * The result of the definition is never more than one glance away, the
 * dependency structure is always visible without navigation, and the surface
 * spends screen space on proving a number correct that a general-purpose
 * editor would spend on more lines of code.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DefinitionCard, type CardTarget } from './components/DefinitionCard';
import { MetricEditor, type MetricEditorHandle } from './components/MetricEditor';
import { ProblemsStrip } from './components/ProblemsStrip';
import { RegistryPanel } from './components/RegistryPanel';
import { ValidationColumn } from './components/ValidationColumn';
import { Resizer, useLayout } from './components/Resizer';
import type { EditorContext } from './editor/context';
import { diagnose, type Fix } from './engine/diagnostics';
import { DEFAULT_MEASURE, INITIAL_DOCS, type ViewFile } from './engine/documents';
import { Evaluator } from './engine/evaluate';
import { parseDoc } from './engine/parse';
import { buildRegistry, resolveClassification } from './engine/registry';
import { classificationMigration, runClassification, type Migration } from './engine/rows';
import { AS_OF, TABLES } from './engine/fixtures';
import { DOMAINS, HUE } from './engine/vocab';
import { conformance as conformanceOf } from './engine/plan';
import { loadWorkspace, saveArtifact, type Connection } from './engine/persistence';
import { plural } from './engine/format';
import { refactorHints } from './engine/refactors';
import type { TraceMode } from './engine/trace';
import type { FixtureName, PillState } from './engine/vocab';

const STATE_OPTIONS: Array<[PillState, string]> = [
  ['resolved', 'Recognized'],
  ['unresolved', 'Unknown name'],
  ['circular', 'Loops back on itself'],
  ['deprecated', 'Being retired'],
  ['restricted', 'Hidden from you'],
  ['stale', 'Recalculating'],
  ['focused', 'Selected'],
];

/** The measure the state switcher demonstrates on. */
const STATE_TARGET = 'hqla_total';

/** Who a save is attributed to until there is an identity provider to ask. */
const AUTHOR = 'authoring-surface';

type SaveState =
  | { kind: 'idle' }
  | { kind: 'saving' }
  | { kind: 'saved'; revision: number; at: number }
  | { kind: 'conflict'; message: string }
  /** Their version is now loaded and yours is on the clipboard. */
  | { kind: 'reloaded' }
  | { kind: 'offline'; message: string };

/**
 * What the surface says about where the text is.
 *
 * Worth spelling out rather than showing a green dot: "this is a prototype whose
 * edits die on reload" and "this is a registry and your change is revision 7"
 * are different products, and an author needs to know which one they are using
 * before they spend an afternoon in it.
 */
function saveLabel(connection: Connection, save: SaveState): { text: string; hue: string } {
  if (connection.state === 'offline') {
    return { text: 'not connected · edits are local', hue: 'var(--mdl-text-faint)' };
  }
  switch (save.kind) {
    case 'saving':
      return { text: 'saving…', hue: 'var(--mdl-text-faint)' };
    case 'saved':
      return { text: `saved · r${save.revision}`, hue: HUE.signal };
    case 'conflict':
      return { text: 'someone else saved', hue: HUE.unresolved };
    case 'reloaded':
      return { text: 'theirs loaded · yours copied', hue: HUE.warn };
    case 'offline':
      return { text: 'save failed', hue: HUE.warn };
    default:
      return { text: 'registry connected', hue: HUE.signal };
  }
}

export default function App() {
  const [docs, setDocs] = useState<Record<ViewFile, string>>({ ...INITIAL_DOCS });
  const [connection, setConnection] = useState<Connection>({
    state: 'offline',
    reason: 'not loaded yet',
  });
  const [saveState, setSaveState] = useState<SaveState>({ kind: 'idle' });
  const [file, setFile] = useState<ViewFile>('liquidity_pit');
  const [fixture, setFixture] = useState<FixtureName>('nominal');
  const [active, setActive] = useState(DEFAULT_MEASURE.liquidity_pit);
  const [pillStateOverride, setPillStateOverride] = useState<PillState>('resolved');
  const [vtab, setVtab] = useState<'verify' | 'plan'>('verify');
  const [traceMode, setTraceMode] = useState<TraceMode>('full');
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [problemsOpen, setProblemsOpen] = useState(true);
  const [filter, setFilter] = useState('');
  const [card, setCard] = useState<CardTarget | null>(null);
  const [peek, setPeek] = useState<{ name: string; line: number } | null>(null);
  const [baseline, setBaseline] = useState<Record<string, number>>({});

  const [layout, setLayout] = useLayout();
  const editor = useRef<MetricEditorHandle>(null);
  const hoverTimer = useRef<number | undefined>(undefined);

  // ---- the loop -----------------------------------------------------------
  // parse → resolve + diagnose → evaluate. Measured rather than asserted; the
  // number in the strip is the real elapsed time for this document.
  // What the file looked like when the session opened. KEEL032 and KEEL034 are
  // about *change*, so they need something to compare against.
  const shipped = useMemo(() => parseDoc(INITIAL_DOCS[file]), [file]);

  const { graph, evaluator, diagnostics, hints, registry, loopMs } = useMemo(() => {
    const t0 = performance.now();
    // Classifications and parameter sets are cross-document references, so the
    // whole workspace is resolved before the active file is evaluated.
    const registry = buildRegistry(docs);
    const g = parseDoc(docs[file]);
    const ev = new Evaluator(g, fixture, registry);
    const d = diagnose(g, ev, shipped, registry, docs);
    const h = g.kind === 'metrics_view' ? refactorHints(g) : [];
    if (g.kind === 'metrics_view') ev.snapshot();
    return {
      graph: g, evaluator: ev, diagnostics: d, hints: h, registry,
      loopMs: Math.round(performance.now() - t0),
    };
  }, [docs, file, fixture, shipped]);

  // The last value each measure computed successfully. When an edit breaks the
  // arithmetic the panel holds this rather than blanking: an author needs to
  // remember what the number was in order to judge what it becomes.
  const lastGood = useRef<Record<string, number>>({});
  useEffect(() => {
    if (graph.kind !== 'metrics_view') return;
    const snap = evaluator.snapshot();
    Object.keys(snap).forEach((k) => {
      if (Number.isFinite(snap[k])) lastGood.current[k] = snap[k];
    });
  }, [evaluator, graph]);

  // The baseline is what the numbers were before this editing session — it is
  // deliberately *not* refreshed on every keystroke, because "what did my
  // change do" is the question the delta answers.
  useEffect(() => {
    const g = parseDoc(docs[file]);
    if (g.kind !== 'metrics_view') {
      setBaseline({});
      return;
    }
    setBaseline(new Evaluator(g, fixture, buildRegistry(docs)).snapshot());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file, fixture]);

  // ---- persistence --------------------------------------------------------
  // The registry is loaded once on mount. A failure is not an error: the surface
  // was a static prototype before there was a server and still has to work as
  // one, so it falls back to the shipped documents and says it is offline.
  // Nothing renders until this resolves. Painting the shipped documents first
  // and swapping them for the registry's a moment later means the surface shows
  // rule text that is not what is stored — briefly, but an author reading a
  // condition during that moment is reading the wrong one.
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    const abort = new AbortController();
    loadWorkspace({ signal: abort.signal }).then((ws) => {
      if (abort.signal.aborted) return;
      setDocs(ws.docs);
      setConnection(ws.connection);
      setLoaded(true);
    });
    return () => abort.abort();
  }, []);

  /**
   * Saves are debounced, and only the document that changed is written.
   *
   * A revision per keystroke would make the history unreadable, which defeats
   * the point of having one. The revision number the server returns is kept so
   * the *next* save can declare what it edited — that is what turns a second tab
   * from a silent overwrite into a conflict the author is told about.
   */
  const pendingSave = useRef<number | undefined>(undefined);

  const scheduleSave = useCallback(
    (name: ViewFile, body: string) => {
      if (connection.state !== 'online') return;
      window.clearTimeout(pendingSave.current);
      pendingSave.current = window.setTimeout(() => {
        const expected = connection.state === 'online' ? connection.revisions[name] : undefined;
        setSaveState({ kind: 'saving' });
        saveArtifact({
          name,
          kind: parseDoc(body).kind,
          body,
          author: AUTHOR,
          message: 'Edited in the authoring surface',
          ...(expected !== undefined ? { expectedRevision: expected } : {}),
        }).then((outcome) => {
          if (outcome.state === 'saved') {
            setConnection((prev) =>
              prev.state === 'online'
                ? { state: 'online', revisions: { ...prev.revisions, [name]: outcome.revision } }
                : prev);
            setSaveState({ kind: 'saved', revision: outcome.revision, at: Date.now() });
          } else {
            // Nothing is resolved here. A conflict means someone else wrote, and
            // picking a winner automatically is the failure the history exists
            // to prevent.
            setSaveState({ kind: outcome.state, message: outcome.message });
          }
        });
      }, 900);
    },
    [connection],
  );

  const setDoc = useCallback(
    (next: string) => {
      setDocs((prev) => ({ ...prev, [file]: next }));
      scheduleSave(file, next);
    },
    [file, scheduleSave],
  );

  const openMeasure = useCallback((name: string) => {
    setActive(name);
    setCard(null);
    setPeek(null);
    editor.current?.goToMeasure(name);
  }, []);

  /**
   * Open a measure that lives in a different document.
   *
   * The editor remounts when the file changes, so the jump cannot happen in
   * the same tick — the handle still points at the outgoing view. The name is
   * parked and the effect below runs it once the new editor is mounted.
   */
  const pendingJump = useRef<string | null>(null);

  const openIn = useCallback(
    (target: ViewFile, name: string) => {
      if (target === file) {
        openMeasure(name);
        return;
      }
      pendingJump.current = name;
      setFile(target);
      setActive(name);
      setCard(null);
      setPeek(null);
      setCollapsed({});
    },
    [file, openMeasure],
  );

  useEffect(() => {
    const name = pendingJump.current;
    if (!name) return;
    pendingJump.current = null;
    editor.current?.goToMeasure(name);
  }, [file]);

  const showCard = useCallback((target: CardTarget) => {
    setCard(target);
  }, []);

  const hoverFromReact = useCallback(
    (name: string, e: { currentTarget: HTMLElement }) => {
      const rect = e.currentTarget.getBoundingClientRect();
      window.clearTimeout(hoverTimer.current);
      hoverTimer.current = window.setTimeout(() => {
        showCard({ name, kind: 'measure', state: 'resolved', x: rect.left - 320, y: rect.bottom + 6 });
      }, 300);
    },
    [showCard],
  );

  const leaveCard = useCallback(() => {
    window.clearTimeout(hoverTimer.current);
    setCard(null);
  }, []);

  // ---- what the editor extensions can see and do --------------------------
  const context = useMemo<EditorContext>(
    () => ({
      evaluator,
      diagnostics,
      hints,
      fixture,
      activeMeasure: active,
      pillStateOverride,
      pillStateTarget: STATE_TARGET,
      peek,
      handlers: {
        onHoverPill: (ref) =>
          showCard({ name: ref.name, kind: ref.kind, state: ref.state, x: ref.rect.left, y: ref.rect.bottom + 6 }),
        onLeavePill: () => setCard(null),
        onGoToDefinition: openMeasure,
        onPeek: (name, line) => {
          setPeek({ name, line });
          setCard(null);
        },
        onSelectPill: () => setCard(null),
        onClosePeek: () => setPeek(null),
        onShowDependents: (name) => {
          setActive(name);
          setVtab('verify');
        },
      },
    }),
    [evaluator, diagnostics, hints, fixture, active, pillStateOverride, peek, openMeasure, showCard],
  );

  // The strip's fix button routes through the same transformation the editor's
  // own lint action uses, so both produce one identical, undoable edit.
  const applyQuickFix = useCallback((fix: Fix) => editor.current?.applyFix(fix), []);

  const conformance = useMemo(
    () => conformanceOf(graph.byName[active] || null),
    [graph, active],
  );

  /**
   * How much notional this rule set would move relative to the version that
   * was filed. Both versions run over the *same* rows, so the difference is
   * attributable entirely to the rules.
   */
  const migration = useMemo<Migration[]>(() => {
    if (graph.kind !== 'classification') return [];
    const filed = resolveClassification(buildRegistry(INITIAL_DOCS), graph.docName, AS_OF);
    const current = resolveClassification(buildRegistry(docs), graph.docName, AS_OF);
    if (!filed || !current) return [];

    const src = ((TABLES[fixture] || {})[current.source] || {})[AS_OF] || [];
    const before = src.map((r) => ({ ...r }));
    const after = src.map((r) => ({ ...r }));
    const b = runClassification(filed, before, DOMAINS);
    const a = runClassification(current, after, DOMAINS);
    return classificationMigration(b, a, before, after, current.notional);
  }, [graph, docs, fixture]);

  const errors = diagnostics.filter((d) => d.sev === 'error').length;
  const warns = diagnostics.filter((d) => d.sev === 'warn').length;

  if (!loaded) {
    // Deliberately almost nothing. With no registry this is a single frame, and
    // with one it is however long the workspace takes — either way a skeleton
    // that mimics the surface would just be a second thing to keep in sync.
    return (
      <div
        className="mdl-shell"
        data-testid="mdl-loading"
        style={{ gridTemplateColumns: '1fr', placeItems: 'center' }}
      >
        <span className="mdl-eyebrow-quiet">Loading the registry…</span>
      </div>
    );
  }

  return (
    <div
      className="mdl-shell"
      style={{ gridTemplateColumns: `${layout.registry}px 5px minmax(0, 1fr) 5px ${layout.validation}px` }}
    >
      <RegistryPanel
        file={file}
        docs={docs}
        graph={graph}
        evaluator={evaluator}
        diagnostics={diagnostics}
        active={active}
        filter={filter}
        onFilter={setFilter}
        onPickFile={(f) => {
          setFile(f);
          setActive(DEFAULT_MEASURE[f]);
          setPeek(null);
          setCollapsed({});
        }}
        onPickMeasure={openMeasure}
        onPickForeign={openIn}
      />

      <Resizer panel="registry" layout={layout} onChange={setLayout} label="Resize measures panel" />

      <div className="mdl-col mdl-col-editor">
        <div className="mdl-tabs">
          {(Object.keys(docs) as ViewFile[]).map((f) => (
            <button
              key={f}
              type="button"
              className="mdl-tab"
              data-current={f === file}
              onClick={() => {
                setFile(f);
                setActive(DEFAULT_MEASURE[f]);
                setPeek(null);
                setCollapsed({});
              }}
            >
              <span
                className="mdl-dot mdl-dot-sm"
                style={{ background: f === file && errors ? '#e5484d' : '#34c77b' }}
                aria-hidden="true"
              />
              {f}.yaml
            </button>
          ))}

          <span style={{ flex: 1 }} />

          <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '0 12px' }}>
            {saveState.kind === 'conflict' ? (
              /**
               * A conflict has to have a way out.
               *
               * Telling the author "someone else saved" and stopping there means
               * their work is stranded in a tab with no action available — they
               * either lose it or force it over a change they cannot see. This
               * takes the stored revision, keeps their text on the clipboard, and
               * lets them reapply deliberately. It does not merge: choosing
               * between two governed rule sets is not a thing to automate.
               */
              <button
                type="button"
                className="mdl-fix"
                data-testid="mdl-resolve-conflict"
                title={saveState.message}
                onClick={() => {
                  const mine = docs[file];
                  navigator.clipboard?.writeText(mine).catch(() => {});
                  loadWorkspace().then((ws) => {
                    setDocs(ws.docs);
                    setConnection(ws.connection);
                    setSaveState({ kind: 'reloaded' });
                  });
                }}
              >
                Load theirs · copy mine
              </button>
            ) : null}

            <span
              className="mono"
              data-testid="mdl-save-state"
              title={
                connection.state === 'offline'
                  ? `No registry reachable: ${connection.reason}`
                  : saveState.kind === 'conflict' || saveState.kind === 'offline'
                    ? saveState.message
                    : 'Edits are appended to the registry as revisions'
              }
              style={{ fontSize: 10, color: saveLabel(connection, saveState).hue }}
            >
              {saveLabel(connection, saveState).text}
            </span>

            <span className="mdl-divider" aria-hidden="true" />

            <label className="mdl-eyebrow-quiet" htmlFor="mdl-fixture">Test data</label>
            <select
              id="mdl-fixture"
              className="mdl-select"
              value={fixture}
              onChange={(e) => setFixture(e.target.value as FixtureName)}
            >
              <option value="nominal">Typical</option>
              <option value="edge">Tricky rows</option>
              <option value="stress">Stressed</option>
            </select>

            <span className="mdl-divider" aria-hidden="true" />

            <label className="mdl-eyebrow-quiet" htmlFor="mdl-state">Show {STATE_TARGET} as</label>
            <select
              id="mdl-state"
              className="mdl-select"
              value={pillStateOverride}
              onChange={(e) => setPillStateOverride(e.target.value as PillState)}
            >
              {STATE_OPTIONS.map(([k, label]) => (
                <option key={k} value={k}>{label}</option>
              ))}
            </select>
          </div>
        </div>

        <MetricEditor
          key={file}
          handle={editor}
          doc={docs[file]}
          context={context}
          onChange={setDoc}
          onCursorMeasure={setActive}
        />

        <ProblemsStrip
          diagnostics={diagnostics}
          conformance={conformance}
          open={problemsOpen}
          loopMs={loopMs}
          onToggle={() => setProblemsOpen((v) => !v)}
          onGo={(line) => editor.current?.goToLine(line)}
          onFix={applyQuickFix}
        />
      </div>

      <Resizer panel="validation" layout={layout} onChange={setLayout} label="Resize validation panel" />

      <ValidationColumn
        graph={graph}
        evaluator={evaluator}
        diagnostics={diagnostics}
        fixture={fixture}
        active={active}
        baseline={baseline}
        lastGood={lastGood.current}
        traceMode={traceMode}
        collapsed={collapsed}
        vtab={vtab}
        onVtab={setVtab}
        onTraceMode={(mode) => {
          setTraceMode(mode);
          setCollapsed({});
        }}
        onToggleNode={(key, open) =>
          setCollapsed((prev) => ({ ...prev, [key]: open }))
        }
        onPickMeasure={openMeasure}
        onHoverPill={hoverFromReact}
        onLeavePill={leaveCard}
        migration={migration}
        onPickRule={(id) => editor.current?.goToMeasure(id)}
        registry={registry}
        docs={docs}
      />

      {card ? (
        <DefinitionCard target={card} graph={graph} evaluator={evaluator} fixture={fixture} />
      ) : null}

      {/* Diagnostics announce once per settled loop, not per keystroke. */}
      <div className="mdl-sr" aria-live="polite" aria-atomic="true">
        {errors || warns
          ? `${plural(errors, 'error')}, ${plural(warns, 'warning')}`
          : 'No problems'}
      </div>
    </div>
  );
}
