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
import type { EditorContext } from './editor/context';
import { diagnose, type Fix } from './engine/diagnostics';
import { DEFAULT_MEASURE, INITIAL_DOCS, type ViewFile } from './engine/documents';
import { Evaluator } from './engine/evaluate';
import { parseDoc } from './engine/parse';
import { conformance as conformanceOf } from './engine/plan';
import { plural } from './engine/format';
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

export default function App() {
  const [docs, setDocs] = useState<Record<ViewFile, string>>({ ...INITIAL_DOCS });
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

  const editor = useRef<MetricEditorHandle>(null);
  const hoverTimer = useRef<number | undefined>(undefined);

  // ---- the loop -----------------------------------------------------------
  // parse → resolve + diagnose → evaluate. Measured rather than asserted; the
  // number in the strip is the real elapsed time for this document.
  const { graph, evaluator, diagnostics, loopMs } = useMemo(() => {
    const t0 = performance.now();
    const g = parseDoc(docs[file]);
    const ev = new Evaluator(g, fixture);
    const d = diagnose(g, ev);
    ev.snapshot();
    return { graph: g, evaluator: ev, diagnostics: d, loopMs: Math.round(performance.now() - t0) };
  }, [docs, file, fixture]);

  // The last value each measure computed successfully. When an edit breaks the
  // arithmetic the panel holds this rather than blanking: an author needs to
  // remember what the number was in order to judge what it becomes.
  const lastGood = useRef<Record<string, number>>({});
  useEffect(() => {
    const snap = evaluator.snapshot();
    Object.keys(snap).forEach((k) => {
      if (Number.isFinite(snap[k])) lastGood.current[k] = snap[k];
    });
  }, [evaluator]);

  // The baseline is what the numbers were before this editing session — it is
  // deliberately *not* refreshed on every keystroke, because "what did my
  // change do" is the question the delta answers.
  useEffect(() => {
    setBaseline(new Evaluator(parseDoc(docs[file]), fixture).snapshot());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file, fixture]);

  const setDoc = useCallback(
    (next: string) => setDocs((prev) => ({ ...prev, [file]: next })),
    [file],
  );

  const openMeasure = useCallback((name: string) => {
    setActive(name);
    setCard(null);
    setPeek(null);
    editor.current?.goToMeasure(name);
  }, []);

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
    [evaluator, diagnostics, fixture, active, pillStateOverride, peek, openMeasure, showCard],
  );

  // The strip's fix button routes through the same transformation the editor's
  // own lint action uses, so both produce one identical, undoable edit.
  const applyQuickFix = useCallback((fix: Fix) => editor.current?.applyFix(fix), []);

  const conformance = useMemo(
    () => conformanceOf(graph.byName[active] || null),
    [graph, active],
  );

  const errors = diagnostics.filter((d) => d.sev === 'error').length;
  const warns = diagnostics.filter((d) => d.sev === 'warn').length;

  return (
    <div className="mdl-shell">
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
      />

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
