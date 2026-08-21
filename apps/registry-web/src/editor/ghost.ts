/**
 * Ghost text — a dimmed completion ahead of the cursor, taken with Tab.
 *
 * It fires only where a single candidate is unambiguous, and never inside
 * `expression`: predicting arithmetic invites an author to accept a formula
 * they did not reason about, which is precisely the failure this surface
 * exists to prevent.
 */

import { Decoration, EditorView, ViewPlugin, WidgetType, type DecorationSet, type ViewUpdate } from '@codemirror/view';
import type { EditorState, Extension } from '@codemirror/state';
import { candidates, ghostFor } from 'keel-engine/completion';
import { syntaxField, type ContextField } from './context';

class GhostWidget extends WidgetType {
  constructor(readonly text: string) {
    super();
  }

  eq(other: GhostWidget) {
    return this.text === other.text;
  }

  toDOM() {
    const el = document.createElement('span');
    el.className = 'cm-mdl-ghost';
    el.textContent = this.text;
    el.setAttribute('aria-hidden', 'true');
    return el;
  }
}

export function ghostText(ctxField: ContextField): {
  extension: Extension;
  current: (state: EditorState) => string;
} {
  const current = (state: EditorState): string => {
    const sel = state.selection.main;
    if (!sel.empty) return '';

    const ctx = state.field(ctxField);
    const g = state.field(syntaxField);
    const line = state.doc.lineAt(sel.head);
    const info = g.info[line.number - 1];
    if (!info || !info.key) return '';
    if (sel.head - line.from < info.valueFrom) return '';
    // Only at the end of the line — ghosting mid-line would suggest text the
    // author would have to delete around.
    if (sel.head !== line.to) return '';

    const textBefore = state.doc.sliceString(line.from + info.valueFrom, sel.head);
    return ghostFor(candidates(g, ctx.evaluator, ctx.fixture, line.number - 1, textBefore));
  };

  const plugin = ViewPlugin.fromClass(
    class {
      decorations: DecorationSet = Decoration.none;

      constructor(view: EditorView) {
        this.build(view.state, view.hasFocus);
      }

      update(u: ViewUpdate) {
        if (u.docChanged || u.selectionSet || u.focusChanged || u.transactions.some((t) => t.effects.length)) {
          this.build(u.state, u.view.hasFocus);
        }
      }

      private build(state: EditorState, focused: boolean) {
        const text = focused ? current(state) : '';
        this.decorations = text
          ? Decoration.set([
              Decoration.widget({ widget: new GhostWidget(text), side: 1 })
                .range(state.selection.main.head),
            ])
          : Decoration.none;
      }
    },
    { decorations: (v) => v.decorations },
  );

  return { extension: plugin, current };
}
