/**
 * The inspector — three tabs over one selected widget.
 *
 * **Widget** is a form generated from the metric contract and the widget
 * contract: the metric picker lists what the registry has, the dim boxes list
 * what the bound contract declares, and controls the widget doesn't support
 * are absent rather than disabled — the form cannot express what the schema
 * would reject.
 *
 * **Source** is the spec as JSON in CodeMirror. Same document, no parallel
 * model: the form and the editor write the same object, so flipping tabs is
 * proof of what you built, exactly the authoring surface's Form/YAML bargain.
 *
 * **Findings** is the server's lint report with one-click JSON Patch fixes.
 */

import { useEffect, useRef, useState } from 'react';
import { EditorState } from '@codemirror/state';
import { EditorView, keymap, lineNumbers } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import {
  applyPatch, parseSpec,
  type DashboardSpec, type LintFinding, type LintReport, type WidgetInstance,
} from 'chartroom-spec';
import type { WidgetContract } from 'chartroom-spec';
import { BriefCard } from './BriefCard';
import { GovernCard } from './GovernCard';
import type { ContractSummary } from './data';

export type Tab = 'widget' | 'source' | 'findings' | 'brief' | 'govern';

interface Props {
  spec: DashboardSpec;
  selected: WidgetInstance | null;
  contracts: ContractSummary[];
  widgets: WidgetContract[];
  report: LintReport | null;
  tab: Tab;
  /** The open dashboard — the brief tab loads and approves against it. */
  dashboardId: string | null;
  onTab(t: Tab): void;
  onSpec(next: DashboardSpec): void;
  onSelect(id: string): void;
  /** After a promotion (which writes a version) the shell refetches. */
  onReload(): void;
}

export function Inspector(props: Props) {
  const { tab, onTab, report } = props;
  const blocks = report?.counts.block ?? 0;
  const warns = report?.counts.warn ?? 0;

  return (
    <aside className="cr-inspector" data-testid="inspector">
      <nav className="cr-tabs" role="tablist">
        {(['widget', 'source', 'findings', 'brief', 'govern'] as const).map((t) => (
          <button
            key={t}
            type="button"
            role="tab"
            aria-selected={tab === t}
            className="cr-tab"
            data-testid={`tab-${t}`}
            onClick={() => onTab(t)}
          >
            {t}
            {t === 'findings' && (blocks + warns > 0) && (
              <span className="cr-tab-badge" data-blocking={blocks > 0 || undefined}>
                {blocks + warns}
              </span>
            )}
          </button>
        ))}
      </nav>
      {tab === 'widget' && <WidgetForm {...props} />}
      {tab === 'source' && <SourceEditor spec={props.spec} onSpec={props.onSpec} />}
      {tab === 'findings' && <Findings {...props} />}
      {tab === 'brief' && (
        props.dashboardId
          ? <BriefCard dashboardId={props.dashboardId} />
          : <div className="cr-pane-empty">Open a dashboard to see its brief.</div>
      )}
      {tab === 'govern' && (
        props.dashboardId
          ? <GovernCard dashboardId={props.dashboardId} onPromoted={props.onReload} />
          : <div className="cr-pane-empty">Open a dashboard to see its promotion state.</div>
      )}
    </aside>
  );
}

// ---------------------------------------------------------------------------

function WidgetForm({ spec, selected, contracts, onSpec }: Props) {
  if (!selected) {
    return <div className="cr-pane-empty">Select a widget on the canvas to edit its binding.</div>;
  }
  const w = selected;
  const idx = spec.widgets.findIndex((x) => x.id === w.id);
  const contract = contracts.find((c) => c.ref === w.bind.metric);
  const isGrid = w.type.startsWith('perspective-grid@');
  const isBar = w.type.startsWith('bar@');
  const isSeries = w.type.startsWith('timeseries@');
  const isKpi = w.type.startsWith('kpi-tile@');

  const patch = (mutate: (next: WidgetInstance) => void) => {
    const next = structuredClone(spec);
    mutate(next.widgets[idx]);
    onSpec(next);
  };

  const toggleDim = (dim: string, on: boolean) => patch((x) => {
    const dims = new Set(x.bind.dims ?? []);
    if (on) dims.add(dim);
    else dims.delete(dim);
    const ordered = [
      ...(dims.has('as_of_date') ? ['as_of_date'] : []),
      ...[...dims].filter((d) => d !== 'as_of_date'),
    ];
    if (ordered.length) x.bind.dims = ordered;
    else delete x.bind.dims;
  });

  return (
    <div className="cr-form" data-testid="widget-form">
      <div className="cr-field">
        <label className="cr-label" htmlFor="f-metric">metric</label>
        <select
          id="f-metric"
          className="cr-input"
          data-testid="form-metric"
          value={w.bind.metric}
          onChange={(e) => patch((x) => { x.bind.metric = e.target.value; })}
        >
          {contracts.map((c) => (
            <option key={c.ref} value={c.ref}>
              {c.doc}.{c.measure}@{c.version}{c.status === 'approved' ? ' ✓' : ''}
            </option>
          ))}
          {!contract && <option value={w.bind.metric}>{w.bind.metric} (unresolved)</option>}
        </select>
        {contract && (
          <p className="cr-hint">
            {contract.unit} · {contract.format} · {contract.owner}
            {contract.denominator_of ? ` · ratio over ${contract.denominator_of}` : ''}
          </p>
        )}
      </div>

      {contract && (
        <div className="cr-field">
          <span className="cr-label">dimensions</span>
          {contract.dims.map((d) => (
            <label key={d.name} className="cr-check">
              <input
                type="checkbox"
                data-testid={`form-dim-${d.name}`}
                checked={(w.bind.dims ?? []).includes(d.name)}
                onChange={(e) => toggleDim(d.name, e.target.checked)}
              />
              {d.name}
              <span className="cr-hint-inline">{d.type}{d.ordinal ? ' · ordinal' : ''}</span>
            </label>
          ))}
        </div>
      )}

      {isSeries && (
        <div className="cr-field">
          <label className="cr-label" htmlFor="f-window">trailing window</label>
          <select
            id="f-window"
            className="cr-input"
            data-testid="form-window"
            value={w.bind.window?.trailing ?? ''}
            onChange={(e) => patch((x) => {
              if (e.target.value) x.bind.window = { trailing: e.target.value };
              else delete x.bind.window;
            })}
          >
            <option value="">full history</option>
            <option value="30d">30d</option>
            <option value="60d">60d</option>
          </select>
        </div>
      )}

      {isKpi && (
        <div className="cr-field">
          <label className="cr-label" htmlFor="f-compare">compare against</label>
          <select
            id="f-compare"
            className="cr-input"
            data-testid="form-compare"
            value={w.bind.compare ? (w.bind.compare.vs === 'prior_period' ? 'prior_period' : w.bind.compare.vs) : ''}
            onChange={(e) => patch((x) => {
              if (!e.target.value) delete x.bind.compare;
              else if (e.target.value === 'prior_period') {
                x.bind.compare = { vs: 'prior_period', style: 'delta' };
              } else {
                x.bind.compare = { vs: e.target.value, style: 'threshold' };
              }
            })}
          >
            <option value="">nothing (KPI-02 will have words)</option>
            <option value="prior_period">prior period</option>
            {contracts.filter((c) => c.ref !== w.bind.metric && c.unit === contract?.unit).map((c) => (
              <option key={c.ref} value={c.ref}>{c.measure}@{c.version} as threshold</option>
            ))}
          </select>
        </div>
      )}

      {isBar && (
        <div className="cr-field">
          <label className="cr-label" htmlFor="f-sort">sort</label>
          <select
            id="f-sort"
            className="cr-input"
            data-testid="form-sort"
            value={w.bind.sort ?? ''}
            onChange={(e) => patch((x) => {
              if (e.target.value) x.bind.sort = e.target.value as 'value' | 'dim';
              else delete x.bind.sort;
            })}
          >
            <option value="">guide default</option>
            <option value="value">by value</option>
            <option value="dim">by dimension order</option>
          </select>
        </div>
      )}

      {isGrid && (
        <div className="cr-field">
          <label className="cr-label" htmlFor="f-cells">max cells</label>
          <input
            id="f-cells"
            className="cr-input"
            data-testid="form-max-cells"
            type="number"
            value={w.bind.max_cells ?? ''}
            onChange={(e) => patch((x) => {
              const v = Number(e.target.value);
              if (v > 0) x.bind.max_cells = v;
              else delete x.bind.max_cells;
            })}
          />
        </div>
      )}

      <div className="cr-field">
        <label className="cr-label" htmlFor="f-decimals">decimals (contract ±1)</label>
        <input
          id="f-decimals"
          className="cr-input"
          data-testid="form-decimals"
          type="number"
          min={0}
          max={6}
          value={w.format?.decimals ?? ''}
          onChange={(e) => patch((x) => {
            if (e.target.value === '') {
              if (x.format) delete x.format.decimals;
              if (x.format && !Object.keys(x.format).length) delete x.format;
            } else {
              x.format = { ...(x.format ?? {}), decimals: Number(e.target.value) };
            }
          })}
        />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

function SourceEditor({ spec, onSpec }: { spec: DashboardSpec; onSpec(s: DashboardSpec): void }) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  // Guards the echo: writing the editor from a spec change must not re-parse
  // as a user edit, and a user edit must not be clobbered by its own echo.
  const applying = useRef(false);

  useEffect(() => {
    if (!host.current) return;
    const v = new EditorView({
      parent: host.current,
      state: EditorState.create({
        doc: JSON.stringify(spec, null, 2),
        extensions: [
          lineNumbers(),
          history(),
          keymap.of([...defaultKeymap, ...historyKeymap]),
          EditorView.updateListener.of((u) => {
            if (!u.docChanged || applying.current) return;
            const text = u.state.doc.toString();
            try {
              const parsed = parseSpec(JSON.parse(text));
              if (parsed.ok) {
                setProblem(null);
                onSpec(parsed.spec);
              } else {
                setProblem(parsed.problems[0]);
              }
            } catch {
              setProblem('not valid JSON yet');
            }
          }),
        ],
      }),
    });
    view.current = v;
    return () => v.destroy();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const v = view.current;
    if (!v) return;
    const want = JSON.stringify(spec, null, 2);
    if (v.state.doc.toString() !== want) {
      applying.current = true;
      v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: want } });
      applying.current = false;
    }
  }, [spec]);

  return (
    <div className="cr-source" data-testid="source-editor">
      {problem && <div className="cr-source-problem">{problem}</div>}
      <div ref={host} className="cr-source-host" />
    </div>
  );
}

// ---------------------------------------------------------------------------

function Findings({ spec, report, onSpec, onSelect }: Props) {
  if (!report) return <div className="cr-pane-empty">lint has not run yet</div>;
  if (!report.findings.length) {
    return <div className="cr-pane-empty" data-testid="findings-clean">No findings — the guide is satisfied.</div>;
  }

  const apply = (f: LintFinding) => {
    if (!f.fix) return;
    onSpec(applyPatch(spec, f.fix));
  };

  return (
    <ul className="cr-findings" data-testid="findings">
      {report.findings.map((f, i) => (
        <li key={`${f.rule}-${f.path}-${i}`} className="cr-finding" data-severity={f.severity}>
          <div className="cr-finding-head">
            <span className="cr-finding-rule">{f.rule}</span>
            <span className="cr-finding-sev">{f.severity}</span>
            {f.widget && (
              <button type="button" className="cr-finding-jump" onClick={() => onSelect(f.widget!)}>
                {f.widget}
              </button>
            )}
          </div>
          <p className="cr-finding-msg">{f.message}</p>
          {f.fix && (
            <button
              type="button"
              className="cr-fix"
              data-testid={`fix-${f.rule}`}
              onClick={() => apply(f)}
            >
              {f.fixLabel || 'Apply fix'}
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}
