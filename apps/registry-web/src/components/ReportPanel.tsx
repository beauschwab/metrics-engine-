/**
 * A report is verified by looking at what would be filed.
 *
 * Not a scalar and not a distribution — the actual rows, at the grain of the
 * form, with the totals they roll up to. Beside them sits the compiled plan
 * for each execution target, because "the pipeline runs this same definition"
 * is a claim, and the claim should be inspectable rather than asserted.
 */

import { useState } from 'react';
import { compileReport, BACKEND_LABEL, type Backend, type ReportSpec } from 'keel-engine/compile';
import { fmt } from 'keel-engine/format';
import type { Graph } from 'keel-engine/parse';
import type { Registry } from 'keel-engine/registry';
import { runReport } from 'keel-engine/report';
import { AS_OF } from 'keel-engine/fixtures';
import { HUE, type FixtureName } from 'keel-engine/vocab';

interface Props {
  spec: ReportSpec;
  view: Graph | null;
  registry: Registry;
  fixture: FixtureName;
}

const BACKENDS: Backend[] = ['sql', 'polars', 'pyspark'];

export function ReportPanel({ spec, view, registry, fixture }: Props) {
  const [tab, setTab] = useState<'result' | Backend>('result');

  if (!view) {
    return (
      <div className="mdl-col mdl-col-validation">
        <div className="mdl-tabs"><div className="mdl-tab" data-current="true">Submission</div></div>
        <div style={{ padding: '14px 16px', fontSize: 12, color: 'var(--mdl-text-faint)' }}>
          This report names a view that does not exist, so there is nothing to file.
        </div>
      </div>
    );
  }

  const result = runReport(spec, view, registry, fixture, AS_OF);

  return (
    <div className="mdl-col mdl-col-validation">
      <div className="mdl-tabs" role="tablist" aria-label="Report">
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'result'}
          className="mdl-tab"
          data-current={tab === 'result'}
          onClick={() => setTab('result')}
        >
          Submission
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
        {tab === 'result' ? (
          <div>
            <div className="mdl-section">
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                <span className="mdl-eyebrow">Rows to file</span>
                <span style={{ flex: 1 }} />
                <span className="mono" style={{ fontSize: 11, color: 'var(--mdl-text-faint)' }}>
                  {AS_OF}
                </span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6 }}>
                <span className="mdl-value">{result.rows.length}</span>
                <span className="mono" style={{ fontSize: 11, color: 'var(--mdl-text-faint)' }}>
                  from {result.records.toLocaleString('en-US')} records
                </span>
              </div>
              <div style={{ marginTop: 10, fontSize: 12, color: 'var(--mdl-text-faint)' }}>
                {spec.table ? (
                  <>
                    <span className="mono" style={{ color: 'var(--mdl-measure)' }}>{spec.table}</span>
                    {' · '}partitioned by {spec.partitionBy.join(', ') || '—'} · {spec.mode}
                  </>
                ) : (
                  'No materialize target — readable, never written.'
                )}
              </div>
              {result.coverage && result.coverage.unmatched > 0 ? (
                <div style={{ marginTop: 8, fontSize: 12, color: HUE.unresolved }}>
                  {result.coverage.unmatched} records carry no product ID and would file under a blank key.
                </div>
              ) : null}
            </div>

            <div style={{ padding: '14px 16px' }}>
              <div className="mdl-eyebrow" style={{ marginBottom: 10 }}>
                {spec.grouping.join(' · ')}
              </div>

              {/* The filed table. Grouping keys left, measures right-aligned. */}
              <div className="mdl-report-head">
                <span>key</span>
                <span style={{ flex: 1 }} />
                {result.measures.map((m) => (
                  <span key={m} className="mdl-report-num" title={m}>
                    {m.replace(/_30d$|_balance$/, '')}
                  </span>
                ))}
              </div>

              {result.rows.slice(0, 40).map((r) => (
                <div key={r.key.join('|')} className="mdl-report-row">
                  <span className="mono mdl-report-key" title={r.key.join(' · ')}>
                    {r.key.map((k) => k || '∅').join(' · ')}
                  </span>
                  <span style={{ flex: 1 }} />
                  {result.measures.map((m) => (
                    <span key={m} className="mdl-report-num mono tnum">
                      {fmt(r.values[m], 'currency_usd_mm')}
                    </span>
                  ))}
                </div>
              ))}

              <div className="mdl-report-row" style={{ borderTop: '1px solid var(--mdl-border-strong)', marginTop: 4 }}>
                <span className="mono" style={{ fontSize: 11, color: 'var(--mdl-text-faint)' }}>
                  total · {result.rows.length} rows
                </span>
                <span style={{ flex: 1 }} />
                {result.measures.map((m) => (
                  <span key={m} className="mdl-report-num mono tnum" style={{ color: HUE.signal }}>
                    {fmt(result.totals[m], 'currency_usd_mm')}
                  </span>
                ))}
              </div>
            </div>
          </div>
        ) : (
          <pre className="mdl-plan">{compileReport(spec, view, registry, tab)}</pre>
        )}
      </div>
    </div>
  );
}
