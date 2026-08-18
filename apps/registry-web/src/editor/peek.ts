/**
 * The peek pane — ⌥-click opens a definition beneath the current line without
 * leaving the file, so checking what a reference means costs no navigation.
 */

import { Decoration, EditorView, WidgetType, type DecorationSet } from '@codemirror/view';
import { StateField, type EditorState, type Extension } from '@codemirror/state';
import { fmt } from 'keel-engine/format';
import { reqs } from 'keel-engine/parse';
import { EXTERNAL, FIXTURES } from 'keel-engine/vocab';
import { syntaxField, type ContextField, type EditorContext } from './context';

interface PeekRow {
  text: string;
  cls: string;
}

class PeekWidget extends WidgetType {
  constructor(
    readonly name: string,
    readonly rows: PeekRow[],
    readonly onClose: () => void,
  ) {
    super();
  }

  eq(other: PeekWidget) {
    return (
      this.name === other.name &&
      this.rows.length === other.rows.length &&
      this.rows.every((r, i) => r.text === other.rows[i].text && r.cls === other.rows[i].cls)
    );
  }

  toDOM() {
    const el = document.createElement('div');
    el.className = 'cm-mdl-peek';

    const head = document.createElement('div');
    head.className = 'cm-mdl-peek-head';

    const eyebrow = document.createElement('span');
    eyebrow.className = 'cm-mdl-peek-eyebrow';
    eyebrow.textContent = 'Preview';
    head.appendChild(eyebrow);

    const name = document.createElement('span');
    name.className = 'cm-mdl-peek-name';
    name.textContent = this.name;
    head.appendChild(name);

    const spacer = document.createElement('span');
    spacer.style.flex = '1';
    head.appendChild(spacer);

    const close = document.createElement('button');
    close.className = 'cm-mdl-peek-close';
    close.type = 'button';
    close.textContent = 'Close ✕';
    close.addEventListener('mousedown', (e) => {
      e.preventDefault();
      this.onClose();
    });
    head.appendChild(close);

    el.appendChild(head);

    this.rows.forEach((r) => {
      const row = document.createElement('div');
      row.className = r.cls;
      row.textContent = r.text;
      el.appendChild(row);
    });

    return el;
  }

  ignoreEvent() {
    return true;
  }
}

function rowsFor(state: EditorState, ctx: EditorContext, name: string): PeekRow[] {
  const g = state.field(syntaxField);
  const m = g.byName[name];
  const r = ctx.evaluator.value(name);
  const rows: PeekRow[] = [];

  if (m) {
    if (m.f.label) rows.push({ text: m.f.label, cls: 'cm-mdl-peek-label' });
    if (m.f.description) rows.push({ text: m.f.description, cls: 'cm-mdl-peek-desc' });
    const type = (m.f.type || '').trim();
    rows.push({
      text:
        type === 'simple'
          ? `${m.f.agg || 'sum'}(${m.f.field})${m.f.where ? `  where ${m.f.where}` : ''}`
          : type === 'windowed'
            ? `${m.f['window.op'] || '?'} of ${reqs(m)[0] || '?'} over the trailing ${m.f['window.over'] || '1d'}`
            : (m.f.expression || '').trim(),
      cls: 'cm-mdl-peek-expr',
    });
  } else if (EXTERNAL[name]) {
    rows.push({ text: EXTERNAL[name].label, cls: 'cm-mdl-peek-label' });
    rows.push({ text: 'Defined in another file, not this one.', cls: 'cm-mdl-peek-desc' });
  }

  rows.push({
    text: `${fmt(r.v, r.format)}   on ${(FIXTURES[ctx.fixture] || ctx.fixture).toLowerCase()}`,
    cls: 'cm-mdl-peek-value',
  });

  return rows;
}

function buildPeek(state: EditorState, ctxField: ContextField): DecorationSet {
  const ctx = state.field(ctxField);
  const peek = ctx.peek;
  if (!peek || peek.line < 0 || peek.line >= state.doc.lines) return Decoration.none;

  const line = state.doc.line(peek.line + 1);
  return Decoration.set([
    Decoration.widget({
      widget: new PeekWidget(peek.name, rowsFor(state, ctx, peek.name), ctx.handlers.onClosePeek),
      block: true,
      side: 1,
    }).range(line.to),
  ]);
}

/**
 * A block widget changes the document's vertical layout, so it has to come
 * from a state field — CodeMirror rejects block decorations supplied by a view
 * plugin, and doing so takes the whole decoration set down with it.
 */
export function peekPane(ctxField: ContextField): Extension {
  return StateField.define<DecorationSet>({
    create: (state) => buildPeek(state, ctxField),
    update(value, tr) {
      if (!tr.docChanged && !tr.effects.length) return value;
      return buildPeek(tr.state, ctxField);
    },
    provide: (f) => EditorView.decorations.from(f),
  });
}
