/**
 * How a variance monitor is verified.
 *
 * Not by a number and not by a list of alerts. A monitor is a control, and the
 * question is whether it is actually watching — so the panel leads with what each
 * threshold *did* across the window: how often it fired, how often it passed, and
 * how often it had no threshold to apply at all.
 *
 * That last column is the one that matters. A monitor with no breaches looks
 * identical to a monitor with no coverage, and the only way to tell them apart is
 * to show the points where a σ could not be computed instead of quietly counting
 * them as passes.
 *
 * Beneath that, the breaches themselves, each carrying the evidence for its own
 * verdict — the move, the limit it exceeded, and for a dispersion threshold the σ
 * and the number of observations behind it. A breach an analyst cannot check is a
 * breach they will not act on.
 */

import { useMemo, useState } from 'react';
import { compileMonitor } from 'keel-engine/compile-variance';
import { BACKEND_LABEL, readReport, type Backend } from 'keel-engine/compile';
import { fmt } from 'keel-engine/format';
import { parseDoc, type Graph } from 'keel-engine/parse';
import type { Registry } from 'keel-engine/registry';
import { readMonitor, runMonitor, BASIS_WINDOW, MIN_OBSERVATIONS } from 'keel-engine/variance';
import { HUE, type FixtureName, type Severity } from 'keel-engine/vocab';

interface Props {
  graph: Graph;
  registry: Registry;
  fixture: FixtureName;
  docs: Record<string, string>;
  onPickThreshold(id: string): void;
}

const BACKENDS: Backend[] = ['sql', 'polars', 'pyspark'];

const SEVERITY_HUE: Record<Severity, string> = {
  error: HUE.unresolved,
  warn: HUE.warn,
  info: HUE.column,
};

/**
 * What a threshold compares against, short enough to actually fit.
 *
 * The long form — `> $1,000,000`, `> 3σ of trailing 30` — was truncated to
 * `> $1,…` and `> 3σ …` in the column it lives in, which conveys nothing. These
 * are the compact forms; `basisTitle` carries the full sentence on hover.
 */
function basisLabel(basis: string, limit: number, sigma: number): string {
  if (basis === 'static_abs') return `>${fmt(limit, 'currency_usd_mm')}`;
  if (basis === 'static_pct') return `>${limit}%`;
  return `>${sigma}σ/${BASIS_WINDOW[basis]}d`;
}

function basisTitle(basis: string, limit: number, sigma: number): string {
  if (basis === 'static_abs') return `Any move above ${fmt(limit, 'currency_usd')}`;
  if (basis === 'static_pct') return `Any move above ${limit}% of the prior value`;
  return `Any move above ${sigma}× the standard deviation of the trailing ` +
    `${BASIS_WINDOW[basis]} daily changes`;
}

export function VariancePanel({ graph, registry, fixture, docs, onPickThreshold }: Props) {
  const [tab, setTab] = useState<'control' | Backend>('control');

  const resolved = useMemo(() => {
    const monitor = readMonitor(graph);
    const reportDoc = Object.values(docs).find((d) => d.includes(`name: ${monitor.report}\n`));
    if (!reportDoc) return null;
    const reportGraph = parseSafe(reportDoc);
    if (!reportGraph || reportGraph.kind !== 'report') return null;
    const spec = readReport(reportGraph);
    const viewDoc = Object.values(docs).find((d) => d.includes(`view: ${spec.view}\n`));
    const view = viewDoc ? parseSafe(viewDoc) : null;
    if (!view || view.kind !== 'metrics_view') return null;
    return { monitor, spec, view };
  }, [graph, docs]);

  const result = useMemo(() => {
    if (!resolved) return null;
    return runMonitor(resolved.monitor, resolved.spec, resolved.view, registry, fixture);
  }, [resolved, registry, fixture]);

  if (!resolved || !result) {
    return (
      <div className="mdl-col mdl-col-validation">
        <div className="mdl-tabs"><div className="mdl-tab" data-current="true">Control</div></div>
        <div style={{ padding: '14px 16px', fontSize: 12, color: 'var(--mdl-text-faint)' }}>
          This monitor names a report or a view that does not exist, so there is nothing to watch.
        </div>
      </div>
    );
  }

  const { monitor, spec } = resolved;
  const grain = monitor.grain.length ? monitor.grain : spec.grouping;
  const errors = result.breaches.filter((b) => b.evaluation.threshold.severity === 'error').length;

  return (
    <div className="mdl-col mdl-col-validation">
      <div className="mdl-tabs" role="tablist" aria-label="Monitor">
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'control'}
          className="mdl-tab"
          data-current={tab === 'control'}
          onClick={() => setTab('control')}
        >
          Control
        </button>
        {BACKENDS.map((b) => (
          <button
            key={b}
            type="button"
            role="tab"
            aria-selected={tab === b}
            className="mdl-tab"
            data-current={tab === b}
            onClick={() => setTab(b)}
          >
            {BACKEND_LABEL[b]}
          </button>
        ))}
      </div>

      <div className="mdl-scroll" style={{ flex: 1 }}>
        {tab !== 'control' ? (
          <pre className="mdl-plan">{compileMonitor(monitor, spec.table, grain, tab)}</pre>
        ) : (
          <div>
            <div className="mdl-section">
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                <span className="mdl-eyebrow">Breaches</span>
                <span style={{ flex: 1 }} />
                <span className="mono" style={{ fontSize: 11, color: 'var(--mdl-text-faint)' }}>
                  {grain.join(' · ')}
                </span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6 }}>
                <span className="mdl-value" style={{ color: errors ? HUE.unresolved : undefined }}>
                  {result.breaches.length}
                </span>
                <span className="mono" style={{ fontSize: 11, color: 'var(--mdl-text-faint)' }}>
                  over {result.evaluated.toLocaleString('en-US')} key-days · {result.keys} rollups
                </span>
              </div>
              <div style={{ marginTop: 10, fontSize: 12, color: 'var(--mdl-text-faint)' }}>
                day-over-day{' '}
                <span className="mono" style={{ color: 'var(--mdl-measure)' }}>{monitor.measure}</span>
                {' '}on{' '}
                <span className="mono" style={{ color: 'var(--mdl-measure)' }}>{spec.table || spec.name}</span>
              </div>
            </div>

            {/* What each threshold did. `no threshold` is the column that
                distinguishes a quiet control from an absent one. */}
            <div style={{ padding: '14px 16px' }}>
              <div className="mdl-eyebrow" style={{ marginBottom: 10 }}>Per threshold</div>
              <div className="mdl-report-head">
                <span>id</span>
                <span style={{ flex: 1 }} />
                <span className="mdl-report-num">fired</span>
                <span className="mdl-report-num">passed</span>
                <span className="mdl-report-num" title={`needs ${MIN_OBSERVATIONS} prior moves`}>
                  no threshold
                </span>
              </div>
              {result.stats.map((s) => {
                const t = monitor.thresholds.find((x) => x.id === s.id)!;
                const ran = s.breaches + s.passes;
                return (
                  <div
                    key={s.id}
                    className="mdl-report-row"
                    role="button"
                    tabIndex={0}
                    style={{ cursor: 'pointer' }}
                    onClick={() => onPickThreshold(s.id)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        onPickThreshold(s.id);
                      }
                    }}
                  >
                    <span
                      className="mono"
                      style={{ fontSize: 11, color: SEVERITY_HUE[s.severity], whiteSpace: 'nowrap' }}
                    >
                      {s.id}
                    </span>
                    <span
                      className="mono"
                      title={basisTitle(s.basis, t.limit, t.sigma)}
                      style={{
                        fontSize: 10,
                        color: 'var(--mdl-text-faint)',
                        marginLeft: 6,
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {basisLabel(s.basis, t.limit, t.sigma)}
                    </span>
                    <span style={{ flex: 1 }} />
                    <span
                      className="mdl-report-num mono tnum"
                      style={{ color: s.breaches ? SEVERITY_HUE[s.severity] : 'var(--mdl-text-faint)' }}
                    >
                      {s.breaches}
                    </span>
                    <span className="mdl-report-num mono tnum">{s.passes}</span>
                    <span
                      className="mdl-report-num mono tnum"
                      style={{
                        color: ran && s.insufficient > ran ? HUE.warn : 'var(--mdl-text-faint)',
                      }}
                    >
                      {s.insufficient}
                    </span>
                  </div>
                );
              })}
            </div>

            {result.breaches.length ? (
              <div style={{ padding: '0 16px 14px' }}>
                <div className="mdl-eyebrow" style={{ marginBottom: 10 }}>Worst first</div>
                {result.breaches.slice(0, 30).map((b, i) => (
                  <div key={`${b.key.join('-')}-${b.date}-${b.evaluation.threshold.id}-${i}`} className="mdl-trace-row">
                    <span
                      className="mono"
                      style={{ fontSize: 10, minWidth: 74, color: SEVERITY_HUE[b.evaluation.threshold.severity] }}
                    >
                      {b.evaluation.threshold.id}
                    </span>
                    <span
                      className="mono"
                      style={{ fontSize: 11, minWidth: 122, whiteSpace: 'nowrap' }}
                    >
                      {b.key.map((k) => k || '∅').join(' · ')}
                    </span>
                    <span
                      className="mono"
                      style={{
                        fontSize: 10,
                        color: 'var(--mdl-text-faint)',
                        minWidth: 68,
                        whiteSpace: 'nowrap',
                      }}
                      title={b.gapDays > 1 ? `previous filing was ${b.gapDays} days earlier` : undefined}
                    >
                      {b.date}
                      {b.gapDays > 1 ? ' ⟂' : ''}
                    </span>
                    <span style={{ flex: 1 }} />
                    <span
                      className="mono tnum"
                      style={{ fontSize: 11, minWidth: 92, textAlign: 'right', whiteSpace: 'nowrap' }}
                    >
                      {fmt(b.delta, 'currency_usd')}
                    </span>
                    <span
                      className="mono tnum"
                      style={{ fontSize: 10, color: 'var(--mdl-text-faint)', minWidth: 62, textAlign: 'right' }}
                      title={
                        Number.isFinite(b.evaluation.sigma)
                          ? `limit ${fmt(b.evaluation.limit, 'currency_usd')} = ` +
                            `${b.evaluation.threshold.sigma}σ of ${fmt(b.evaluation.sigma, 'currency_usd')} ` +
                            `over ${b.evaluation.observations} moves`
                          : `limit ${b.evaluation.limit}`
                      }
                    >
                      {Number.isFinite(b.deltaPct) ? `${b.deltaPct.toFixed(1)}%` : '—'}
                    </span>
                  </div>
                ))}
                {result.breaches.length > 30 ? (
                  <div style={{ marginTop: 6, fontSize: 11, color: 'var(--mdl-text-faint)' }}>
                    … {result.breaches.length - 30} more
                  </div>
                ) : null}
              </div>
            ) : null}

            {/* A rollup arriving or leaving is a reportable event that no
                threshold can express — there is no prior day to compare to. */}
            {result.appeared.length || result.disappeared.length ? (
              <div style={{ padding: '0 16px 16px' }}>
                <div className="mdl-eyebrow" style={{ marginBottom: 10 }}>Arrivals and departures</div>
                {result.appeared.slice(0, 6).map((a) => (
                  <div key={`a-${a.key.join('-')}-${a.date}`} className="mdl-trace-row">
                    <span className="mono" style={{ fontSize: 10, minWidth: 74, color: HUE.dimension }}>
                      appeared
                    </span>
                    <span className="mono" style={{ fontSize: 11 }}>{a.key.join(' · ')}</span>
                    <span style={{ flex: 1 }} />
                    <span className="mono" style={{ fontSize: 10, color: 'var(--mdl-text-faint)' }}>{a.date}</span>
                    <span className="mono tnum" style={{ fontSize: 11, marginLeft: 8 }}>
                      {fmt(a.value, 'currency_usd')}
                    </span>
                  </div>
                ))}
                {result.disappeared.slice(0, 6).map((d) => (
                  <div key={`d-${d.key.join('-')}-${d.date}`} className="mdl-trace-row">
                    <span className="mono" style={{ fontSize: 10, minWidth: 74, color: HUE.warn }}>
                      stopped
                    </span>
                    <span className="mono" style={{ fontSize: 11 }}>{d.key.join(' · ')}</span>
                    <span style={{ flex: 1 }} />
                    <span className="mono" style={{ fontSize: 10, color: 'var(--mdl-text-faint)' }}>{d.date}</span>
                    <span className="mono tnum" style={{ fontSize: 11, marginLeft: 8 }}>
                      was {fmt(d.previous, 'currency_usd')}
                    </span>
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
}

/** Parsing a document from the workspace, tolerant of one being mid-edit. */
function parseSafe(doc: string): Graph | null {
  try {
    return parseDoc(doc);
  } catch {
    return null;
  }
}
