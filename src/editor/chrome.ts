/**
 * Editor chrome: key/value colouring, the active-measure rail, and the two
 * custom gutters.
 *
 * The colour-mark gutter is the quiet one that earns its place — a stack of 2px
 * marks per line, ordered as the pills appear, so a line that reads mostly
 * violet is function-heavy and one that reads mostly blue composes other
 * measures. It spends the channel already committed to semantics rather than
 * introducing a new one.
 */

import { RangeSet, RangeSetBuilder, type EditorState, type Extension } from '@codemirror/state';
import {
  Decoration, EditorView, ViewPlugin, gutter, gutterLineClass, GutterMarker,
  type DecorationSet, type ViewUpdate,
} from '@codemirror/view';
import { tokenizeLine } from '../engine/tokens';
import { HUE, PILL_KEYS, type Severity } from '../engine/vocab';
import type { ContextField } from './context';
import { syntaxField } from './context';

const KEY_MARK = Decoration.mark({ class: 'cm-mdl-key' });
const VALUE_MARK = Decoration.mark({ class: 'cm-mdl-value' });
const PUNCT_MARK = Decoration.mark({ class: 'cm-mdl-punct' });
const ACTIVE_LINE = Decoration.line({ class: 'cm-mdl-active-line' });

function buildChrome(state: EditorState, ctxField: ContextField): DecorationSet {
  const g = state.field(syntaxField);
  const ctx = state.field(ctxField);
  const builder = new RangeSetBuilder<Decoration>();

  for (let i = 0; i < g.lines.length && i < state.doc.lines; i++) {
    const info = g.info[i];
    const line = state.doc.line(i + 1);

    if (info && info.owner === ctx.activeMeasure) builder.add(line.from, line.from, ACTIVE_LINE);
    if (!info) continue;

    if (info.valueFrom > 0) builder.add(line.from, line.from + info.valueFrom, KEY_MARK);

    const valueStart = line.from + info.valueFrom;
    if (valueStart < line.to) {
      const isPillLine = !!info.key && info.key in PILL_KEYS;
      builder.add(valueStart, line.to, isPillLine ? PUNCT_MARK : VALUE_MARK);
    }
  }

  return builder.finish();
}

export function chrome(ctxField: ContextField): Extension {
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;

      constructor(view: EditorView) {
        this.decorations = buildChrome(view.state, ctxField);
      }

      update(u: ViewUpdate) {
        if (u.docChanged || u.transactions.some((tr) => tr.effects.length)) {
          this.decorations = buildChrome(u.state, ctxField);
        }
      }
    },
    { decorations: (v) => v.decorations },
  );
}

/**
 * The active-measure rail has to cross the gutters as well as the text, or the
 * band stops halfway and reads as a rendering artefact.
 */
const ACTIVE_GUTTER = new (class extends GutterMarker {
  elementClass = 'cm-mdl-active-gutter';
})();

export function activeMeasureGutter(ctxField: ContextField): Extension {
  return gutterLineClass.compute([syntaxField, ctxField], (state) => {
    const g = state.field(syntaxField);
    const ctx = state.field(ctxField);
    const builder = new RangeSetBuilder<GutterMarker>();
    for (let i = 0; i < g.lines.length && i < state.doc.lines; i++) {
      const info = g.info[i];
      if (!info || info.owner !== ctx.activeMeasure) continue;
      const line = state.doc.line(i + 1);
      builder.add(line.from, line.from, ACTIVE_GUTTER);
    }
    return builder.finish() as RangeSet<GutterMarker>;
  });
}

// ---------------------------------------------------------------------------
// Gutters
// ---------------------------------------------------------------------------

const SEV_GLYPH: Record<Severity, string> = { error: '✕', warn: '⚠', info: 'i' };

class SeverityMarker extends GutterMarker {
  constructor(readonly sev: Severity) {
    super();
  }

  eq(other: SeverityMarker) {
    return this.sev === other.sev;
  }

  toDOM() {
    const el = document.createElement('span');
    el.className = `cm-mdl-sev cm-mdl-sev-${this.sev}`;
    el.textContent = SEV_GLYPH[this.sev];
    return el;
  }
}

/** One glyph per line, at the highest severity present on it. */
export function severityGutter(ctxField: ContextField): Extension {
  return gutter({
    class: 'cm-mdl-sev-gutter',
    lineMarker(view, block) {
      const ctx = view.state.field(ctxField);
      const lineNo = view.state.doc.lineAt(block.from).number - 1;
      const here = ctx.diagnostics.filter((d) => d.line === lineNo);
      if (!here.length) return null;
      const sev: Severity = here.some((d) => d.sev === 'error')
        ? 'error'
        : here.some((d) => d.sev === 'warn')
          ? 'warn'
          : 'info';
      return new SeverityMarker(sev);
    },
    lineMarkerChange: () => true,
    initialSpacer: () => new SeverityMarker('error'),
  });
}

class PillMarksMarker extends GutterMarker {
  constructor(readonly hues: string[]) {
    super();
  }

  eq(other: PillMarksMarker) {
    return this.hues.join() === other.hues.join();
  }

  toDOM() {
    const el = document.createElement('span');
    el.className = 'cm-mdl-marks';
    this.hues.forEach((h) => {
      const m = document.createElement('span');
      m.className = 'cm-mdl-mark';
      m.style.background = h;
      el.appendChild(m);
    });
    return el;
  }
}

const MARK_HUE = {
  measure: HUE.measure,
  dimension: HUE.dimension,
  func: HUE.func,
  column: HUE.column,
} as const;

export function pillMarkGutter(ctxField: ContextField): Extension {
  return gutter({
    class: 'cm-mdl-mark-gutter',
    lineMarker(view, block) {
      const ctx = view.state.field(ctxField);
      const g = view.state.field(syntaxField);
      const lineNo = view.state.doc.lineAt(block.from).number - 1;
      const info = g.info[lineNo];
      if (!info || !info.key || !(info.key in PILL_KEYS)) return null;

      const toks = tokenizeLine(lineNo, g, ctx.evaluator);
      if (!toks.length) return null;

      return new PillMarksMarker(
        toks.slice(0, 5).map((t) =>
          t.state === 'unresolved' || t.state === 'circular'
            ? HUE.unresolved
            : t.state === 'deprecated'
              ? HUE.warn
              : MARK_HUE[t.kind],
        ),
      );
    },
    lineMarkerChange: () => true,
  });
}
