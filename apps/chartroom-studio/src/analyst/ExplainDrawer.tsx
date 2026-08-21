/**
 * "Where this number comes from" — the drill-down behind every frame's
 * `explain`.
 *
 * One deliberate departure from the prototype. It ends in a table of the
 * underlying rows; this ends in the aggregate breakdown instead. Row-level
 * data has no representation in the query response types at all — that is the
 * structural half of the aggregates-only boundary, written down in
 * `query.ts`: "Row-level data has no representation in the response types, so
 * it cannot leak by accident." Adding a rows endpoint to satisfy a drawer
 * would dismantle the guarantee to decorate it. The breakdown answers the same
 * question a reader is actually asking — which slices make up this number —
 * without a row ever crossing the wire, and the CSV exports that.
 *
 * Everything else is the real thing: the lineage is the contract's own
 * registry metadata, and the compiled query is the SQL the warehouse manifest
 * publishes for that measure — the same text the Python executor runs, not a
 * template rendered for display.
 */

import { useEffect, useState } from 'react';
import type { DashboardSpec, WidgetInstance } from 'chartroom-spec';
import { parseMetricRef } from 'chartroom-spec';
import type { Basis, QueryResult } from '../bindings';
import { requestsFor } from '../bindings';
import { runQuery, type ContractSummary } from '../data';

interface Manifest {
  docs: Array<{
    name: string;
    revision: number;
    source: string;
    measures: Array<{ name: string; kind: string; sql: string; format: string }>;
  }>;
}

export interface ExplainDrawerProps {
  widget: WidgetInstance;
  spec: DashboardSpec;
  contract: ContractSummary | undefined;
  asOf: string | null;
  basis: Basis;
  params: Record<string, string>;
  onClose(): void;
}

const BASIS_LABEL: Record<Basis, string> = {
  prior_day: 'prior day',
  prior_week: 'prior week',
  month_end: 'month-end',
};

/** Enough precision to reconcile against a source system, not chart precision. */
const exact = (v: number, unit: string): string =>
  unit === 'percent' ? `${v.toFixed(6)} percent` : `${Math.round(v).toLocaleString('en-US')} ${unit}`;

const short = (v: number, unit: string): string =>
  unit === 'percent' ? `${v.toFixed(1)}%` : v.toLocaleString('en-US', { maximumFractionDigits: 0 });

export function ExplainDrawer({
  widget, spec, contract, asOf, basis, params, onClose,
}: ExplainDrawerProps) {
  const [result, setResult] = useState<QueryResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [manifest, setManifest] = useState<Manifest | null>(null);
  const ref = parseMetricRef(widget.bind.metric);

  useEffect(() => {
    let alive = true;
    const { main } = requestsFor(widget, spec, [], { asOf, basis, params });
    runQuery(main)
      .then((r) => { if (alive) setResult(r); })
      .catch((e: Error) => { if (alive) setError(e.message); });
    void fetch('/api/warehouse/manifest')
      .then((r) => (r.ok ? r.json() : null))
      .then((m: Manifest | null) => { if (alive && m) setManifest(m); })
      .catch(() => { /* the drawer degrades to no SQL, not to an error */ });
    return () => { alive = false; };
  }, [widget.id, JSON.stringify(widget.bind), asOf, basis, JSON.stringify(params)]);

  useEffect(() => {
    const on = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', on);
    return () => document.removeEventListener('keydown', on);
  }, [onClose]);

  const unit = result?.unit ?? contract?.unit ?? 'number';
  const headline = result?.kind === 'scalar' ? result.value : null;

  // The aggregate breakdown: whatever shape the binding already returns.
  const breakdown: Array<{ label: string; value: number }> =
    result?.kind === 'groups'
      ? result.rows.map((r) => ({ label: Object.values(r.key).join(' · '), value: r.value }))
      : result?.kind === 'series'
        ? result.series.map((s) => ({
          label: Object.values(s.key).join(' · ') || (ref?.measure ?? 'series'),
          value: s.points[s.points.length - 1]?.value ?? 0,
        }))
        : result?.kind === 'scalar'
          ? [
            { label: `${ref?.measure ?? 'value'} at ${result.asOf}`, value: result.value },
            { label: `the same measure, ${BASIS_LABEL[basis]}`, value: result.prior },
          ]
          : [];

  const sql = manifest?.docs
    .find((d) => d.name === ref?.doc)?.measures
    .find((m) => m.name === ref?.measure)?.sql;

  const source = manifest?.docs.find((d) => d.name === ref?.doc)?.source;

  const downloadCsv = () => {
    const head = 'slice,value,unit,as_of,metric\n';
    const body = breakdown
      .map((b) => [b.label, b.value, unit, result?.asOf ?? '', widget.bind.metric].join(','))
      .join('\n');
    const a = document.createElement('a');
    a.href = `data:text/csv;charset=utf-8,${encodeURIComponent(head + body)}`;
    a.download = `${widget.id}-${result?.asOf ?? 'latest'}.csv`;
    a.click();
  };

  return (
    <div className="cr-drawer-scrim" data-testid="explain-drawer" onClick={onClose}>
      <aside className="cr-drawer" onClick={(e) => e.stopPropagation()}>
        <header className="cr-drawer-head">
          <span className="cr-drawer-eyebrow">where this number comes from</span>
          <span className="cr-context-spacer" />
          <button type="button" className="cr-drawer-close" data-testid="explain-close" onClick={onClose}>
            close · esc
          </button>
        </header>

        <div className="cr-drawer-body">
          <div className="cr-drawer-headline">
            <div className="cr-drawer-headline-text">
              <span className="cr-drawer-title">{widget.title || ref?.measure || widget.id}</span>
              <span className="cr-drawer-value" data-testid="explain-value">
                {headline === null ? '—' : short(headline, unit)}
              </span>
            </div>
            <span className="cr-context-spacer" />
            <div className="cr-drawer-actions">
              <span className="cr-drawer-exact" title="full precision">
                {headline === null ? '' : exact(headline, unit)}
              </span>
              <div className="cr-drawer-buttons">
                <button
                  type="button"
                  className="cr-fix"
                  disabled={headline === null}
                  onClick={() => {
                    if (headline !== null && navigator.clipboard) {
                      void navigator.clipboard.writeText(String(headline));
                    }
                  }}
                >
                  Copy value
                </button>
                <button
                  type="button"
                  className="cr-fix"
                  data-testid="explain-csv"
                  disabled={!breakdown.length}
                  onClick={downloadCsv}
                >
                  Download CSV
                </button>
              </div>
            </div>
          </div>

          {error && <p className="cr-drawer-error">{error}</p>}

          <section className="cr-drawer-section">
            <h3 className="cr-drawer-head-label">Breakdown</h3>
            {breakdown.length === 0 && <p className="cr-hint">no aggregate slices for this binding</p>}
            {breakdown.map((b) => (
              <div className="cr-drawer-row" key={b.label}>
                <span className="cr-drawer-row-label">{b.label}</span>
                <span className="cr-drawer-row-value">{short(b.value, unit)}</span>
              </div>
            ))}
            <p className="cr-hint cr-drawer-note">
              Aggregates only — row-level data has no representation in the query response,
              by design. This is the same guarantee the API enforces.
            </p>
          </section>

          <section className="cr-drawer-section">
            <h3 className="cr-drawer-head-label">Lineage</h3>
            <ul className="cr-drawer-lineage">
              <li>
                document: {contract?.doc ?? '—'} · revision @{ref?.version ?? '—'} ·
                owner {contract?.owner ?? '—'}
              </li>
              <li>governance: {contract?.status ?? 'not in the registry'}</li>
              <li>grain: {contract?.grain ?? '—'} · unit: {unit}</li>
              {source && <li>upstream: {source}</li>}
              <li>as-of resolved: {result?.asOf ?? '—'} · delta against {BASIS_LABEL[basis]}</li>
            </ul>
          </section>

          <section className="cr-drawer-section">
            <h3 className="cr-drawer-head-label">Compiled query</h3>
            {sql
              ? <pre className="cr-drawer-sql" data-testid="explain-sql">{sql}</pre>
              : (
                <p className="cr-hint">
                  This measure has no published SQL — it is evaluated by the engine directly.
                </p>
              )}
          </section>
        </div>
      </aside>
    </div>
  );
}
