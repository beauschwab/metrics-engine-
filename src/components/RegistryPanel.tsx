/**
 * The measures panel.
 *
 * A tree of views and measures with a status dot per entry and the current
 * value on the right. Measures drag into the editor, which is what makes this
 * more than a file list: an author scanning for the right measure can place it
 * without typing or memorising its exact name.
 */

import type { Diagnostic } from '../engine/diagnostics';
import type { Evaluator } from '../engine/evaluate';
import { VIEW_FILES, type ViewFile } from '../engine/documents';
import { fmt } from '../engine/format';
import { sectionBlocks, type Graph, type Measure } from '../engine/parse';
import { HUE } from '../engine/vocab';
import type { Coverage } from '../engine/rows';

interface Props {
  file: ViewFile;
  docs: Record<ViewFile, string>;
  graph: Graph;
  evaluator: Evaluator;
  diagnostics: Diagnostic[];
  active: string;
  filter: string;
  onFilter(v: string): void;
  onPickFile(f: ViewFile): void;
  onPickMeasure(name: string): void;
}

const IDLE_DOT = '#59636e';
const OK_DOT = '#34c77b';

const LABEL: Record<string, string> = {
  metrics_view: 'measures',
  classification: 'rules',
  parameter_set: 'rates',
};

/** Blocks of any kind — measures, rules, or parameter entries. */
function countBlocks(doc: string): number {
  return (doc.match(/^\s*-\s+[a-z_0-9.]+:/gm) || []).length;
}

/** The list a document is really about. */
function primarySection(g: Graph): string {
  if (g.kind === 'classification') return 'rules';
  if (g.kind === 'parameter_set') return 'entries';
  return 'measures';
}

const FILE_GLYPH: Record<string, string> = {
  metrics_view: '⧉',
  classification: '⌗',
  parameter_set: '≡',
};

export function RegistryPanel({
  file, docs, graph, evaluator, diagnostics, active, filter,
  onFilter, onPickFile, onPickMeasure,
}: Props) {
  // A measure's block runs to the start of the next one — that span is what
  // its status dot aggregates.
  const items: Measure[] = sectionBlocks(graph, primarySection(graph));
  const coverage: Coverage | null =
    graph.kind === 'classification' ? evaluator.selfCoverage() : null;

  const blockEnd = (index: number) =>
    index + 1 < items.length ? items[index + 1].line : graph.lines.length;

  /** What sits on the right of a row: a value, an emitted code, or a rate. */
  const metaFor = (m: Measure): string => {
    if (graph.kind === 'classification') return (m.f.emit || '').trim();
    if (graph.kind === 'parameter_set') {
      const v = parseFloat((m.f[(graph.view.value || '').trim()] || '').trim());
      return Number.isNaN(v) ? '—' : `${(v * 100).toFixed(1)}%`;
    }
    const r = evaluator.value(m.name);
    return fmt(r.v, r.format);
  };

  const worstIn = (from: number, to: number) => {
    const here = diagnostics.filter((d) => d.line >= from && d.line < to);
    if (here.some((d) => d.sev === 'error')) return HUE.unresolved;
    if (here.length) return HUE.warn;
    return IDLE_DOT;
  };

  const fileDot = diagnostics.some((d) => d.sev === 'error')
    ? HUE.unresolved
    : diagnostics.some((d) => d.sev === 'warn')
      ? HUE.warn
      : OK_DOT;

  return (
    <div className="mdl-col mdl-col-registry">
      <div className="mdl-head">
        <span className="mdl-mark" aria-hidden="true" />
        <span className="mdl-eyebrow">Measures</span>
        <span style={{ flex: 1 }} />
        <span className="tnum" style={{ fontSize: 10, color: 'var(--mdl-text-faint)' }}>
          {items.length} {LABEL[graph.kind]}
        </span>
      </div>

      <div style={{ padding: '8px 10px', borderBottom: '1px solid var(--mdl-border-soft)' }}>
        <input
          className="mdl-search"
          type="text"
          placeholder="Search measures…"
          aria-label="Search measures"
          value={filter}
          onChange={(e) => onFilter(e.target.value)}
        />
      </div>

      <div className="mdl-scroll" style={{ flex: 1, padding: '6px 0' }} role="tree" aria-label="Measures">
        {VIEW_FILES.map((f) => {
          const isCurrent = f === file;
          return (
            <div key={f} role="treeitem" aria-expanded={isCurrent} aria-selected={isCurrent}>
              <button
                type="button"
                className="mdl-tree-file"
                data-current={isCurrent}
                onClick={() => onPickFile(f)}
                title={`view ${f}`}
              >
                <span
                  className="mdl-dot"
                  style={{ background: isCurrent ? fileDot : OK_DOT }}
                  aria-hidden="true"
                />
                <span aria-hidden="true" style={{ color: 'var(--mdl-measure)', fontSize: 11 }}>
                  {isCurrent ? FILE_GLYPH[graph.kind] : '⧉'}
                </span>
                <span>{f}.yaml</span>
                <span style={{ flex: 1 }} />
                <span className="tnum" style={{ fontSize: 10, color: 'var(--mdl-text-faint)' }}>
                  {isCurrent ? items.length : countBlocks(docs[f])}
                </span>
              </button>

              {isCurrent
                ? items
                    .map((m, i) => ({ m, i }))
                    .filter(({ m }) => !filter || m.name.indexOf(filter) >= 0)
                    .map(({ m, i }) => {
                      const tier = parseInt(m.f.sr_11_7_tier || '0', 10);
                      // A rule that classifies nothing is the tree's equivalent
                      // of a measure that will not compute.
                      const ruleStat = coverage?.rules.find((x) => x.id === m.name);
                      const dot = ruleStat
                        ? ruleStat.records === 0
                          ? HUE.warn
                          : OK_DOT
                        : worstIn(m.line, blockEnd(i));
                      return (
                        <div
                          key={m.name}
                          role="treeitem"
                          aria-selected={active === m.name}
                          className="mdl-tree-measure"
                          data-active={active === m.name}
                          draggable
                          tabIndex={0}
                          title="Drag into the editor to insert a reference"
                          onDragStart={(e) => {
                            e.dataTransfer.setData('text/x-metric', m.name);
                            e.dataTransfer.setData('text/plain', m.name);
                            e.dataTransfer.effectAllowed = 'copy';
                          }}
                          onClick={() => onPickMeasure(m.name)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault();
                              onPickMeasure(m.name);
                            }
                          }}
                        >
                          <span
                            className="mdl-dot mdl-dot-sm"
                            style={{ background: dot }}
                            aria-hidden="true"
                          />
                          <span
                            aria-hidden="true"
                            style={{ color: 'var(--mdl-measure)', fontSize: 10, opacity: 0.8 }}
                          >
                            ⟨⟩
                          </span>
                          <span className="mdl-tree-name">{m.name}</span>
                          <span style={{ flex: 1 }} />
                          {tier >= 1 && tier <= 2 ? (
                            <span className="mdl-tier-dot" style={{ marginRight: 4 }} aria-hidden="true" />
                          ) : null}
                          <span
                            className="tnum mono"
                            style={{ fontSize: 10, color: 'var(--mdl-text-faint)' }}
                          >
                            {metaFor(m)}
                          </span>
                        </div>
                      );
                    })
                : null}
            </div>
          );
        })}
      </div>

      <div
        style={{
          flex: 'none',
          borderTop: '1px solid var(--mdl-border)',
          padding: '8px 12px',
          display: 'flex',
          flexDirection: 'column',
          gap: 4,
        }}
      >
        <span className="mdl-eyebrow-quiet">Drag a measure into the editor to use it</span>
        <span style={{ fontSize: 11, color: 'var(--mdl-text-muted)' }}>
          ⌘-click a name to open it · ⌥-click to preview
        </span>
      </div>
    </div>
  );
}
