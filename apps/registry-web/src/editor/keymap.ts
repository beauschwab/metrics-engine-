/**
 * Key handling and drag-insert.
 *
 * Tab is overloaded on purpose, in priority order: take the ghost text if there
 * is one, else accept the highlighted completion, else move to the next pill on
 * the line. Full keyboard operation is a hard requirement here — a meaningful
 * share of this audience works keyboard-first out of habit from terminal
 * tooling.
 */

import { acceptCompletion, completionStatus } from '@codemirror/autocomplete';
import { Prec, type Extension } from '@codemirror/state';
import { EditorView, keymap } from '@codemirror/view';
import { tokenizeLine } from 'keel-engine/tokens';
import { syntaxField, type ContextField } from './context';
import { toggleQuickActions } from './quickActions';

/** Move the selection onto the next / previous pill on the current line. */
function movePill(view: EditorView, ctxField: ContextField, dir: 1 | -1): boolean {
  const state = view.state;
  const g = state.field(syntaxField);
  const ctx = state.field(ctxField);
  const sel = state.selection.main;
  const line = state.doc.lineAt(sel.head);
  const toks = tokenizeLine(line.number - 1, g, ctx.evaluator);
  if (!toks.length) return false;

  const col = sel.head - line.from;
  const next =
    dir === 1
      ? toks.find((t) => t.from > col) || toks[0]
      : [...toks].reverse().find((t) => t.to < col) || toks[toks.length - 1];

  view.dispatch({
    selection: { anchor: line.from + next.from, head: line.from + next.to },
    scrollIntoView: true,
  });
  ctx.handlers.onSelectPill(next.name);
  return true;
}

/** Move the cursor to the previous / next measure's `- name:` line. */
function jumpMeasure(view: EditorView, dir: 1 | -1): boolean {
  const state = view.state;
  const g = state.field(syntaxField);
  if (!g.measures.length) return false;

  const here = state.doc.lineAt(state.selection.main.head).number - 1;
  const target =
    dir === 1
      ? g.measures.find((m) => m.line > here) || g.measures[0]
      : [...g.measures].reverse().find((m) => m.line < here) || g.measures[g.measures.length - 1];

  const line = state.doc.line(Math.min(target.line + 1, state.doc.lines));
  view.dispatch({ selection: { anchor: line.to }, scrollIntoView: true });
  return true;
}

/**
 * Insert a measure template at the cursor with the name selected, so typing
 * replaces it. `type` is pre-filled from context — a view bound to a source
 * gets `simple`, which is the common case.
 */
function newMeasure(view: EditorView): boolean {
  const state = view.state;
  const g = state.field(syntaxField);
  const here = state.doc.lineAt(state.selection.main.head).number - 1;

  // Land after the measure the cursor is in, so the template does not split it.
  const owner = [...g.measures].reverse().find((m) => m.line <= here);
  const nextMeasure = g.measures.find((m) => m.line > (owner ? owner.line : -1));
  const insertLine = nextMeasure ? nextMeasure.line : g.lines.length;

  const NAME = 'new_measure';
  const template = [
    '',
    `  - name: ${NAME}`,
    '    description: ',
    '    type: simple',
    '    agg: sum',
    '    field: ',
    '    format: currency_usd',
  ];

  const anchorLine = state.doc.line(Math.max(1, Math.min(insertLine, state.doc.lines)));
  const at = nextMeasure ? anchorLine.from : state.doc.length;
  const text = nextMeasure ? `${template.join('\n')}\n` : `\n${template.join('\n')}`;

  view.dispatch({ changes: { from: at, insert: text }, scrollIntoView: true });

  // Select the placeholder name so the first keystroke replaces it.
  const offset = text.indexOf(NAME);
  view.dispatch({
    selection: { anchor: at + offset, head: at + offset + NAME.length },
    scrollIntoView: true,
  });
  view.focus();
  return true;
}

export function mdlKeymap(
  ctxField: ContextField,
  currentGhost: (state: EditorView['state']) => string,
): Extension {
  return Prec.highest(
    keymap.of([
      {
        key: 'Tab',
        run: (view) => {
          const ghost = currentGhost(view.state);
          if (ghost) {
            const pos = view.state.selection.main.head;
            view.dispatch({
              changes: { from: pos, insert: ghost },
              selection: { anchor: pos + ghost.length },
            });
            return true;
          }
          if (completionStatus(view.state) === 'active') return acceptCompletion(view);
          return movePill(view, ctxField, 1);
        },
      },
      {
        key: 'Shift-Tab',
        run: (view) => movePill(view, ctxField, -1),
      },
      {
        key: 'Mod-.',
        run: (view) => {
          view.dispatch({ effects: toggleQuickActions.of(true) });
          return true;
        },
      },
      // §10 — move between measures, not just between lines.
      { key: 'Mod-ArrowDown', run: (view) => jumpMeasure(view, 1) },
      { key: 'Mod-ArrowUp', run: (view) => jumpMeasure(view, -1) },
      // §11 — a new measure arrives as a template, not a blank line.
      { key: 'Mod-n', run: newMeasure, preventDefault: true },
      {
        key: 'Escape',
        run: (view) => {
          const ctx = view.state.field(ctxField);
          if (ctx.peek) {
            ctx.handlers.onClosePeek();
            return true;
          }
          view.dispatch({ effects: toggleQuickActions.of(false) });
          return false;
        },
      },
    ]),
  );
}

/**
 * Drag-insert from the registry tree — the affordance that makes that panel
 * more than a file list. The reference lands where it was dropped; on a
 * `requires:` line it lands inside the brackets.
 */
export function dropInsert(): Extension {
  return EditorView.domEventHandlers({
    dragover(event) {
      if (!event.dataTransfer) return false;
      event.preventDefault();
      event.dataTransfer.dropEffect = 'copy';
      return true;
    },
    drop(event, view) {
      const name = event.dataTransfer?.getData('text/x-metric');
      if (!name) return false;
      event.preventDefault();

      const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
      if (pos === null) return true;

      const line = view.state.doc.lineAt(pos);
      const closing = line.text.lastIndexOf(']');

      if (closing >= 0) {
        const at = line.from + closing;
        const empty = /\[\s*\]/.test(line.text);
        view.dispatch({
          changes: { from: at, insert: `${empty ? '' : ', '}${name}` },
          selection: { anchor: at + name.length + (empty ? 0 : 2) },
        });
      } else {
        const needsSpace = pos > line.from && !/\s$/.test(view.state.doc.sliceString(pos - 1, pos));
        const insert = `${needsSpace ? ' ' : ''}${name}`;
        view.dispatch({
          changes: { from: pos, insert },
          selection: { anchor: pos + insert.length },
        });
      }

      view.focus();
      return true;
    },
  });
}
