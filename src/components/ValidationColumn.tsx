/**
 * The validation column — value, derivation trace, blast radius, and the
 * generated query.
 *
 * This column is not collapsible by default. Hiding it defeats the product's
 * thesis; an author who wants it gone can drag it closed, but the interface
 * will not suggest doing so.
 */

import type { MouseEvent } from 'react';
import type { Diagnostic } from '../engine/diagnostics';
import { COMPILE_BLOCKING } from '../engine/diagnostics';
import type { Evaluator } from '../engine/evaluate';
import { AS_OF } from '../engine/fixtures';
import { fmt } from '../engine/format';
import { reqs, type Graph } from '../engine/parse';
import { conformance as conformanceOf, planLines } from '../engine/plan';
import { dependents, traceNodes, type TraceMode } from '../engine/trace';
import { HUE, type FixtureName } from '../engine/vocab';
import { CoveragePanel } from './CoveragePanel';
import { ParameterPanel } from './ParameterPanel';
import { ReportPanel } from './ReportPanel';
import { VariancePanel } from './VariancePanel';
import { readReport } from '../engine/compile';
import type { Registry } from '../engine/registry';
import type { Migration } from '../engine/rows';
import { Pill } from './Pill';
import { RollingNumber } from './RollingNumber';

interface Props {
  graph: Graph;
  evaluator: Evaluator;
  diagnostics: Diagnostic[];
  fixture: FixtureName;
  active: string;
  baseline: Record<string, number>;
  /** Last successfully computed value per measure — held when an edit breaks. */
  lastGood: Record<string, number>;
  traceMode: TraceMode;
  collapsed: Record<string, boolean>;
  vtab: 'verify' | 'plan';
  onVtab(tab: 'verify' | 'plan'): void;
  onTraceMode(mode: TraceMode): void;
  onToggleNode(key: string, open: boolean): void;
  onPickMeasure(name: string): void;
  onHoverPill(name: string, e: MouseEvent<HTMLElement>): void;
  onLeavePill(): void;
  /** Notional that would change classification versus the filed version. */
  migration: Migration[];
  onPickRule(id: string): void;
  /** The open workspace — a monitor reaches across to its report and its view. */
  docs: Record<string, string>;
  /** Every document in the workspace — a report reaches across to its view. */
  registry: Registry;
}

const SPARK_POINTS = 42;

export function ValidationColumn(props: Props) {
  const {
    graph, evaluator, diagnostics, fixture, active, baseline, lastGood, traceMode, collapsed,
    vtab, onVtab, onTraceMode, onToggleNode, onPickMeasure, onHoverPill, onLeavePill,
    migration, onPickRule, registry, docs,
  } = props;

  if (graph.kind === 'report') {
    const spec = readReport(graph);
    const viewGraph = Object.values(registry.graphs).find(
      (x) => x.kind === 'metrics_view' && (x.view.view || '').trim() === spec.view,
    ) || null;
    return <ReportPanel spec={spec} view={viewGraph} registry={registry} fixture={fixture} />;
  }

  // A rule set and a rate table are verified by coverage, not by a value.
  if (graph.kind === 'classification') {
    return (
      <div className="mdl-col mdl-col-validation">
        {/* A real tab, even though it is the only one. It was a `div`, which put
            two of the five document kinds outside the keyboard order and made
            the column's chrome change shape depending on what was open. */}
        <div className="mdl-tabs" role="tablist" aria-label="Validation">
          <button type="button" role="tab" aria-selected className="mdl-tab" data-current="true">
            Coverage
          </button>
        </div>
        <div className="mdl-scroll" style={{ flex: 1 }}>
          <CoveragePanel
            coverage={evaluator.selfCoverage()}
            migration={migration}
            onPickRule={onPickRule}
          />
        </div>
      </div>
    );
  }

  // A monitor is verified by what its thresholds did, not by a value.
  if (graph.kind === 'variance_monitor') {
    return (
      <VariancePanel
        graph={graph}
        registry={registry}
        fixture={fixture}
        docs={docs}
        onPickThreshold={onPickRule}
      />
    );
  }

  if (graph.kind === 'parameter_set') {
    return (
      <div className="mdl-col mdl-col-validation">
        <div className="mdl-tabs" role="tablist" aria-label="Validation">
          <button type="button" role="tab" aria-selected className="mdl-tab" data-current="true">
            Assumptions
          </button>
        </div>
        <div className="mdl-scroll" style={{ flex: 1 }}>
          <ParameterPanel graph={graph} />
        </div>
      </div>
    );
  }

  const value = evaluator.value(active);
  const measure = graph.byName[active] || null;

  // Only a diagnostic that stops the definition compiling makes the number
  // stale. A missing description does not invalidate a number that computed.
  const blocking = diagnostics.find((d) => d.sev === 'error' && COMPILE_BLOCKING[d.code]);

  // The number did not come out this time — hold the last one that did, dimmed,
  // and say why. Never blank, never an error in place of a number.
  const held = !Number.isFinite(value.v) && Number.isFinite(lastGood[active]);
  const shown = held ? lastGood[active] : value.v;
  const stale = !!blocking || held;
  const staleNote = blocking
    ? `${blocking.code} · ${blocking.message}`
    : held
      ? 'the formula did not produce a number'
      : '';

  const previous = baseline[active];
  const delta =
    previous === undefined || isNaN(previous) || !Number.isFinite(value.v)
      ? null
      : value.v - previous;
  const isPct = value.format === 'percent_1dp' || value.format === 'percent_2dp';

  const series = value.s.slice(-SPARK_POINTS).map((v) => (isNaN(v) ? null : v));
  const finite = series.filter((v): v is number => v !== null);
  const lo = finite.length ? Math.min(...finite) : 0;
  const hi = finite.length ? Math.max(...finite) : 1;

  const nodes = traceNodes(graph, evaluator, active, traceMode, collapsed);
  const deps = dependents(graph, active);
  const conformance = conformanceOf(measure);

  const traceExpr = measure
    ? (measure.f.type || '').trim() === 'simple'
      ? `${measure.f.agg || 'sum'}(${measure.f.field})${measure.f.where ? `\nwhere ${measure.f.where}` : ''}`
      : (measure.f.type || '').trim() === 'windowed'
        ? `${measure.f['window.op'] || '?'} of ⟨${reqs(measure)[0] || '?'}⟩ over the trailing ${measure.f['window.over'] || '1d'}`
        : (measure.f.expression || '').trim()
    : '';

  return (
    <div className="mdl-col mdl-col-validation">
      <div className="mdl-tabs" role="tablist" aria-label="Validation">
        {([['verify', 'Result'], ['plan', 'Query']] as const).map(([k, label]) => (
          <button
            key={k}
            type="button"
            role="tab"
            aria-selected={vtab === k}
            className="mdl-tab"
            data-current={vtab === k}
            onClick={() => onVtab(k)}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="mdl-scroll" style={{ flex: 1 }}>
        {vtab === 'verify' ? (
          <div>
            {/* ---- value ---- */}
            <div className="mdl-section">
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                <span className="mdl-eyebrow">Value</span>
                <span style={{ flex: 1 }} />
                <span
                  className="mdl-eyebrow-quiet"
                  style={{ color: stale ? HUE.warn : '#34c77b', letterSpacing: '0.08em' }}
                >
                  {stale ? '⚠ out of date' : 'up to date'}
                </span>
                <span className="mono" style={{ fontSize: 11, color: 'var(--mdl-text-faint)' }}>
                  {AS_OF}
                </span>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6 }}>
                {/* Holds the last good number rather than blanking — an author
                    needs to remember what it was to judge what it becomes. */}
                <RollingNumber
                  className="mdl-value"
                  value={fmt(shown, value.format)}
                  aria-live="polite"
                  style={stale ? { color: 'rgba(231,235,241,.62)' } : undefined}
                />
                <span className="mono" style={{ fontSize: 11, color: 'var(--mdl-measure)' }}>
                  ⟨{active}⟩
                </span>
              </div>

              <div className="mdl-spark" aria-hidden="true">
                {series.map((v, i) => {
                  const t = v === null || hi === lo ? 0.5 : (v - lo) / (hi - lo);
                  return (
                    <span
                      key={i}
                      style={{
                        height: Math.max(3, 4 + 28 * t),
                        background:
                          i === series.length - 1
                            ? HUE.signal
                            : v === null
                              ? 'var(--mdl-raised)'
                              : '#4c5563',
                      }}
                    />
                  );
                })}
              </div>

              <div
                style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 8, fontSize: 12 }}
              >
                <span
                  className="mono tnum"
                  style={{
                    fontSize: 12,
                    color:
                      delta === null || delta === 0
                        ? 'var(--mdl-text-faint)'
                        : delta > 0
                          ? 'var(--mdl-up)'
                          : 'var(--mdl-down)',
                  }}
                >
                  {delta === null
                    ? '—'
                    : delta === 0
                      ? '±0'
                      : `${delta > 0 ? '▲ ' : '▼ '}${Math.abs(
                          isPct ? delta : previous ? (100 * delta) / previous : 0,
                        ).toFixed(1)}${isPct ? 'pp' : '%'}`}
                </span>
                <span style={{ color: 'var(--mdl-text-faint)' }}>vs. previous edit</span>
                <span style={{ flex: 1 }} />
                {staleNote ? (
                  <span
                    className="mono"
                    style={{
                      fontSize: 11,
                      color: HUE.warn,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                      maxWidth: 190,
                    }}
                    title={staleNote}
                  >
                    {staleNote}
                  </span>
                ) : null}
              </div>
            </div>

            {/* ---- derivation trace ---- */}
            <div className="mdl-section">
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                <span className="mdl-eyebrow">How this is calculated</span>
                <span style={{ flex: 1 }} />
                {/* Q1, built both ways rather than argued about. */}
                {([['full', 'Every step'], ['drill', 'One step']] as const).map(([k, label]) => (
                  <button
                    key={k}
                    type="button"
                    className="mdl-mode"
                    data-current={traceMode === k}
                    onClick={() => onTraceMode(k)}
                  >
                    {label}
                  </button>
                ))}
              </div>

              <div
                className="mono"
                style={{
                  fontSize: 12,
                  lineHeight: '18px',
                  color: 'var(--mdl-text-muted)',
                  marginBottom: 10,
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                }}
              >
                {traceExpr}
              </div>

              <div role="tree" aria-label="Derivation">
                {nodes.map((n) => (
                  <div key={n.key} role="treeitem" aria-expanded={n.childCount ? n.open : undefined}>
                    <div className="mdl-trace-row" style={{ paddingLeft: n.depth * 14, marginTop: n.depth === 0 ? 0 : 4 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 4, minWidth: 0 }}>
                        <button
                          type="button"
                          className="mdl-caret"
                          style={{ cursor: n.childCount ? 'pointer' : 'default' }}
                          aria-label={n.childCount ? `${n.open ? 'Collapse' : 'Expand'} ${n.name}` : undefined}
                          onClick={() => n.childCount && onToggleNode(n.key, n.open)}
                        >
                          {n.childCount ? (n.open ? '▾' : '▸') : ''}
                        </button>
                        <Pill
                          name={n.name}
                          tier={n.tier}
                          value={fmt(n.value.v, n.value.format)}
                          onEnter={(e) => onHoverPill(n.name, e)}
                          onLeave={onLeavePill}
                          onClick={() => onPickMeasure(n.name)}
                        />
                      </div>
                      <span className="mdl-trace-leader" aria-hidden="true" />
                      <span
                        className="mono tnum"
                        style={{
                          fontSize: 12,
                          flex: 'none',
                          color: isNaN(n.value.v) ? HUE.unresolved : 'var(--mdl-text)',
                        }}
                      >
                        {fmt(n.value.v, n.value.format)}
                      </span>
                    </div>

                    {n.detail.map((d, i) => (
                      <div key={i} className="mdl-trace-detail" style={{ paddingLeft: n.depth * 14 + 14 }}>
                        <span>{d.text}</span>
                        <span style={{ flex: 1 }} />
                        {/* `0 rows` beside a `0` value makes the commonest
                            silent error self-evident. */}
                        <span
                          className="tnum"
                          style={{ color: d.zero ? HUE.unresolved : 'var(--mdl-text-faint)' }}
                        >
                          {d.rows}
                        </span>
                      </div>
                    ))}
                  </div>
                ))}
              </div>

              <div
                className="mono"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  marginTop: 8,
                  paddingTop: 8,
                  borderTop: '1px solid var(--mdl-border-strong)',
                  fontSize: 13,
                }}
              >
                <span style={{ color: 'var(--mdl-text-muted)' }}>=</span>
                <span style={{ flex: 1 }} />
                <span className="tnum" style={{ color: HUE.signal }}>
                  {fmt(value.v, value.format)}
                </span>
              </div>
            </div>

            {/* ---- blast radius ---- */}
            <div style={{ padding: '14px 16px' }}>
              <div className="mdl-eyebrow" style={{ marginBottom: 10 }}>
                If you change this, {deps.length} measures move
              </div>

              {deps.map((name) => {
                const r = evaluator.value(name);
                const before = baseline[name];
                // Same rule as the value panel: hold the last good number when
                // this pass produced nothing, and drop the delta rather than
                // implying the dependent didn't move.
                const broken = !Number.isFinite(r.v) && Number.isFinite(lastGood[name]);
                const after = broken ? lastGood[name] : r.v;
                const d =
                  before === undefined || isNaN(before) || !Number.isFinite(r.v)
                    ? null
                    : r.v - before;
                const m = graph.byName[name];
                const tier = m ? parseInt(m.f.sr_11_7_tier || '0', 10) : 0;
                const pct = r.format === 'percent_1dp' || r.format === 'percent_2dp';
                const rel =
                  d === null
                    ? ''
                    : pct
                      ? `${Math.abs(d).toFixed(1)}pp`
                      : before
                        ? `${Math.abs((100 * d) / before).toFixed(1)}%`
                        : '—';

                return (
                  <div key={name}>
                    <div className="mdl-blast-row" data-changed={d !== null && d !== 0}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <Pill
                          name={name}
                          tier={0}
                          value={fmt(r.v, r.format)}
                          onEnter={(e) => onHoverPill(name, e)}
                          onLeave={onLeavePill}
                          onClick={() => onPickMeasure(name)}
                        />
                        {tier >= 1 && tier <= 2 ? <span className="mdl-tier-dot" aria-hidden="true" /> : null}
                      </div>
                      <span style={{ flex: 1 }} />
                      <span
                        className="mono tnum"
                        style={{ fontSize: 11, color: 'var(--mdl-text-faint)' }}
                      >
                        {fmt(before, r.format)}
                      </span>
                      <span style={{ color: 'var(--mdl-text-faint)', fontSize: 10, margin: '0 6px' }}>→</span>
                      <span
                        className="mono tnum"
                        style={{
                          fontSize: 12,
                          minWidth: 74,
                          textAlign: 'right',
                          color: broken ? 'rgba(231,235,241,.62)' : 'var(--mdl-text)',
                        }}
                        title={broken ? 'last good value — this edit does not compute' : undefined}
                      >
                        {fmt(after, r.format)}
                      </span>
                      <span
                        className="mono tnum"
                        style={{
                          fontSize: 11,
                          minWidth: 62,
                          textAlign: 'right',
                          color:
                            d === null || d === 0
                              ? 'var(--mdl-text-faint)'
                              : d > 0
                                ? 'var(--mdl-up)'
                                : 'var(--mdl-down)',
                        }}
                      >
                        {d === null ? '' : d === 0 ? '±0' : `${d > 0 ? '▲ ' : '▼ '}${rel}`}
                      </span>
                    </div>
                    {tier >= 1 && tier <= 2 && d !== null && d !== 0 ? (
                      <div style={{ fontSize: 11, color: HUE.warn, padding: '0 0 6px 2px' }}>
                        approved metric — tell model risk before you change this
                      </div>
                    ) : null}
                  </div>
                );
              })}

              {deps.length === 0 ? (
                <div style={{ fontSize: 12, color: 'var(--mdl-text-faint)' }}>
                  Nothing else uses this measure. Editing it changes nothing downstream.
                </div>
              ) : null}
            </div>
          </div>
        ) : (
          <div style={{ padding: '14px 16px' }}>
            <div className="mdl-eyebrow" style={{ marginBottom: 10 }}>
              Generated query · ⟨{active}⟩
            </div>
            {planLines(graph, measure, fixture).map((line, i) => (
              <div key={i} className="mdl-plan-line" data-comment={line.indexOf('--') === 0}>
                {line}
              </div>
            ))}

            <div className="mdl-eyebrow" style={{ margin: '20px 0 8px 0' }}>
              Database support
            </div>
            {conformance.map((c) => (
              <div
                key={c.name}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '5px 0',
                  borderBottom: '1px solid var(--mdl-border-soft)',
                  fontSize: 12,
                }}
              >
                <span
                  className="mdl-dot"
                  style={{ background: c.ok ? '#34c77b' : HUE.warn }}
                  aria-hidden="true"
                />
                <span className="mono" style={{ fontSize: 12 }}>{c.name}</span>
                <span style={{ flex: 1 }} />
                <span style={{ fontSize: 11, color: c.ok ? '#34c77b' : HUE.warn }}>
                  {c.ok ? 'works' : 'not supported'}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
