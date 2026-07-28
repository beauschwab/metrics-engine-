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
import { tokenizeLine } from '../engine/tokens';
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
