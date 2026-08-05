/**
 * The registry panel.
 *
 * A tree of documents and what each one holds, with a status dot per entry and
 * the current value on the right. Measures drag into the editor, which is what
 * makes this more than a file list: an author scanning for the right measure can
 * place it without typing or memorising its exact name.
 *
 * It holds five kinds of thing now, not one, and the header, the search box and
 * the footer hint all name whichever it is. They all used to say "measures"
 * unconditionally — over a count of "16 rules", with an instruction to drag a
 * measure that a rate table has none of.
 */

import type { Diagnostic } from '../engine/diagnostics';
import type { Evaluator } from '../engine/evaluate';
import { VIEW_FILES, type ViewFile } from '../engine/documents';
import { fmt } from '../engine/format';
import { sectionBlocks, type Graph, type Measure } from '../engine/parse';
import { HUE, type PillState } from '../engine/vocab';
import type { Coverage } from '../engine/rows';
import {
  STAGE_CAPTION, STAGE_LABEL, groupByStage, type LineageGraph,
} from '../engine/lineage';

interface Props {
  file: ViewFile;
  docs: Record<ViewFile, string>;
  /**
   * What each document is for, and what feeds what.
   *
   * The tree used to be a flat list of seven in a hardcoded order, which put a
   * dashboard ratio and a pipeline enrichment stage four rows apart with
   * nothing to tell them apart. Grouping by stage is the fix, and taking the
   * grouping as a prop rather than computing it here keeps the panel a
   * renderer.
   */
  lineage: LineageGraph;
  graph: Graph;
  evaluator: Evaluator;
  diagnostics: Diagnostic[];
  active: string;
  filter: string;
  onFilter(v: string): void;
  onPickFile(f: ViewFile): void;
  onPickMeasure(name: string): void;
  /** Open a measure that lives in another document — what a report files. */
  onPickForeign(f: ViewFile, name: string): void;
  /**
   * The pill-state gallery, from §5.7 of the design.
   *
   * It lives here rather than in the document strip because it is a
   * workspace-level demonstration, not a per-document control — and because in
   * the strip its label was the widest thing in the row, squeezing primary
   * navigation down to two visible tabs out of seven.
   */
  pillState: PillState;
  onPillState(state: PillState): void;
  stateOptions: Array<[PillState, string]>;
  stateTarget: string;
}

const IDLE_DOT = '#59636e';
const OK_DOT = '#34c77b';

const LABEL: Record<string, string> = {
  metrics_view: 'measures',
  classification: 'rules',
  parameter_set: 'rates',
  report: 'measures',
  variance_monitor: 'thresholds',
  source_binding: 'mappings',
};

/**
 * What the panel is a panel *of*, per document kind.
 *
 * It said "Measures" over a count of "16 rules" — a header contradicting the
 * number beside it, which reads as a bug rather than as a fixed label. The panel
 * has held four kinds of thing since the classification layer landed and only
 * ever admitted to one.
 */
const PANEL_TITLE: Record<string, string> = {
  metrics_view: 'Measures',
  classification: 'Rules',
  parameter_set: 'Rates',
  report: 'Filed',
  variance_monitor: 'Thresholds',
  source_binding: 'Mappings',
};

/**
 * The hint at the bottom, which has to be true.
 *
 * "Drag a measure into the editor to use it" was shown over a rate table, a
 * report and a monitor — documents with no measures and nothing draggable. An
 * instruction that does not apply is worse than no instruction: it makes the
 * reader doubt the parts that do.
 */
const PANEL_HINT: Record<string, [string, string]> = {
  metrics_view: [
    'Drag a measure into the editor to use it',
    '⌘-click a name to open it · ⌥-click to preview',
  ],
  classification: [
    'Rules are tried in order, first match wins',
    'Click a rule to jump to it · a dim dot means it classified nothing',
  ],
  parameter_set: [
    'These rates are the governed assumption',
    'Click an entry to jump to it · each carries its own citation',
  ],
  report: [
    'These measures are defined in the view this report files from',
    'Click one to open it where it is defined',
  ],
  variance_monitor: [
    'Thresholds judge each day-over-day move',
    'Click a threshold to jump to it · σ bases need 10 prior moves',
  ],
  source_binding: [
    'These map a client system’s columns to the canonical source',
    'The canonical plan runs unchanged on the generated adapter',
  ],
};

/** Blocks of any kind — measures, rules, or parameter entries. */
function countBlocks(doc: string): number {
  return (doc.match(/^\s*-\s+[a-z_0-9.]+:/gm) || []).length;
}

/** The list a document is really about. */
function primarySection(g: Graph): string {
  if (g.kind === 'classification') return 'rules';
  if (g.kind === 'parameter_set') return 'entries';
  if (g.kind === 'variance_monitor') return 'thresholds';
  if (g.kind === 'source_binding') return 'columns';
  return 'measures';
}

/**
 * A report has no blocks — its grain and measures are inline lists — so what it
 * files has to be read off the header rather than from a section that does not
 * exist. Those measures are defined in the report's *view*, not in the report,
 * which is why the tree has to be able to open a name in another document.
 */
function filedMeasures(g: Graph): string[] {
  return (g.view.measures || '')
    .replace(/[[\]]/g, '')
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);
}

const FILE_GLYPH: Record<string, string> = {
  metrics_view: '⧉',
  classification: '⌗',
  parameter_set: '≡',
  report: '▤',
  variance_monitor: '∿',
  source_binding: '⇄',
};

export function RegistryPanel({
  file, docs, lineage, graph, evaluator, diagnostics, active, filter,
  onFilter, onPickFile, onPickMeasure, onPickForeign,
  pillState, onPillState, stateOptions, stateTarget,
}: Props) {
  // A measure's block runs to the start of the next one — that span is what
  // its status dot aggregates.
  const items: Measure[] = sectionBlocks(graph, primarySection(graph));
  const filed = graph.kind === 'report' ? filedMeasures(graph) : [];
  // Where a report's measures actually live, so the tree can open them.
  const filedIn = (graph.view.view || '').trim() as ViewFile;
  const headerCount = graph.kind === 'report' ? filed.length : items.length;
  const coverage: Coverage | null =
    graph.kind === 'classification' ? evaluator.selfCoverage() : null;

  const hint = PANEL_HINT[graph.kind] || PANEL_HINT.metrics_view;
  const title = PANEL_TITLE[graph.kind] || 'Measures';
  const noun = LABEL[graph.kind] || 'measures';

  const blockEnd = (index: number) =>
    index + 1 < items.length ? items[index + 1].line : graph.lines.length;

  /** What sits on the right of a row: a value, an emitted code, or a rate. */
  const metaFor = (m: Measure): string => {
    if (graph.kind === 'variance_monitor') {
      // What the threshold compares against, so the tree says what each one is
      // for rather than only naming it.
      const basis = (m.f.basis || '').trim();
      if (basis.startsWith('stddev')) return `${(m.f.sigma || '').trim()}σ`;
      return basis === 'static_pct' ? `${(m.f.limit || '').trim()}%` : (m.f.limit || '').trim();
    }
    if (graph.kind === 'source_binding') return (m.f.column || '').trim();
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
        <span className="mdl-eyebrow">{title}</span>
        <span style={{ flex: 1 }} />
        <span className="tnum" style={{ fontSize: 10, color: 'var(--mdl-text-faint)' }}>
          {/* No "Measures · 12 measures". The noun is dropped when it would only
              repeat the title the reader has just read. */}
          {headerCount}{noun === title.toLowerCase() ? '' : ` ${noun}`}
        </span>
      </div>

      <div style={{ padding: '8px 10px', borderBottom: '1px solid var(--mdl-border-soft)' }}>
        <input
          className="mdl-search"
          type="text"
          placeholder={`Search ${noun}…`}
          aria-label={`Search ${noun}`}
          value={filter}
          onChange={(e) => onFilter(e.target.value)}
        />
      </div>

      <div className="mdl-scroll" style={{ flex: 1, padding: '6px 0' }} role="tree" aria-label="Registry">
        {groupByStage(lineage, VIEW_FILES).map((group) => (
          // The group is what makes the stage legible, so it has to be a real
          // group to a screen reader too — otherwise the panel reads as seven
          // flat items again and the whole distinction is visual-only.
          <div
            key={group.stage}
            role="group"
            aria-label={`${STAGE_LABEL[group.stage]} — ${STAGE_CAPTION[group.stage]}`}
          >
            <div className="mdl-tree-group" data-stage={group.stage}>
              <span className="mdl-tree-group-name">{STAGE_LABEL[group.stage]}</span>
              {/* The question the stage answers. A header that only names
                  itself teaches nothing the first time the panel is opened. */}
              <span className="mdl-tree-group-caption">{STAGE_CAPTION[group.stage]}</span>
              <span className="mdl-tree-group-rule" aria-hidden="true" />
            </div>

        {group.files.map((name) => {
          const f = name as ViewFile;
          const isCurrent = f === file;
          return (
            // A file's own name is the file's own name. Without the explicit
            // label it is computed from everything inside it, so the document
            // announces as its entire contents — every measure and every value
            // read aloud as one string.
            <div
              key={f}
              role="treeitem"
              aria-label={`${f}.yaml`}
              aria-expanded={isCurrent}
              aria-selected={isCurrent}
            >
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
                  {isCurrent ? headerCount : countBlocks(docs[f])}
                </span>
              </button>

              {/* Child items belong in a group, not directly inside their
                  parent item — a treeitem inside a treeitem is not a tree. */}
              {isCurrent ? (
                <div role="group" aria-label={`${f}.yaml contents`}>
                  {/* A report's measures are defined in its view, so the tree
                      lists them here and opens them there. Counting two and
                      showing none is the alternative, and it reads as a bug. */}
                  {filed
                    .filter((name) => !filter || name.indexOf(filter) >= 0)
                    .map((name) => (
                      <div
                        key={name}
                        role="treeitem"
                        aria-selected={false}
                        className="mdl-tree-measure"
                        data-active={false}
                        tabIndex={0}
                        title={`${name} — defined in ${filedIn}.yaml`}
                        onClick={() => onPickForeign(filedIn, name)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            onPickForeign(filedIn, name);
                          }
                        }}
                      >
                        <span
                          className="mdl-dot mdl-dot-sm"
                          style={{ background: IDLE_DOT }}
                          aria-hidden="true"
                        />
                        <span
                          aria-hidden="true"
                          style={{ color: 'var(--mdl-measure)', fontSize: 10, opacity: 0.8 }}
                        >
                          ⟨⟩
                        </span>
                        <span className="mdl-tree-name">{name}</span>
                        <span style={{ flex: 1 }} />
                        <span
                          className="mono"
                          style={{ fontSize: 10, color: 'var(--mdl-text-faint)' }}
                        >
                          {filedIn}
                        </span>
                      </div>
                    ))}

                  {items
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
                    })}
                </div>
              ) : null}
            </div>
          );
        })}
          </div>
        ))}
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
        <span className="mdl-eyebrow-quiet">{hint[0]}</span>
        <span style={{ fontSize: 11, color: 'var(--mdl-text-muted)' }}>{hint[1]}</span>

        {/* Stacked, not side by side. The column is ~230px and a 10px uppercase
            label beside a full-width select folded onto two lines. */}
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'stretch',
            gap: 4,
            marginTop: 6,
            paddingTop: 8,
            borderTop: '1px solid var(--mdl-border-soft)',
          }}
        >
          <label
            className="mdl-eyebrow-quiet"
            htmlFor="mdl-state"
            title={`Render ${stateTarget} in each pill state`}
            style={{ whiteSpace: 'nowrap' }}
          >
            Pill state · {stateTarget}
          </label>
          <select
            id="mdl-state"
            className="mdl-select"
            value={pillState}
            onChange={(e) => onPillState(e.target.value as PillState)}
          >
            {stateOptions.map(([k, label]) => (
              <option key={k} value={k}>{label}</option>
            ))}
          </select>
        </div>
      </div>
    </div>
  );
}
