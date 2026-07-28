/**
 * Completion, wired to the YAML path the cursor sits in.
 *
 * Beyond the vocabulary itself, this does one thing the author asked for
 * directly: clicking any line whose value is a fixed choice always opens the
 * picker, with the value already set marked by a ✓ — rather than requiring the
 * author to know what the legal values are before they can see them.
 */

import {
  autocompletion, completionStatus, startCompletion,
  type Completion, type CompletionContext, type CompletionResult,
} from '@codemirror/autocomplete';
import type { Extension } from '@codemirror/state';
import { EditorView, ViewPlugin, type ViewUpdate } from '@codemirror/view';
import { candidates, type CandidateKind } from '../engine/completion';
import { CHOICE_KEYS } from '../engine/vocab';
import { syntaxField, type ContextField } from './context';

/** Scope line shown above the option list, keyed per editor instance. */
const SCOPES = new WeakMap<EditorView, string>();

const TYPE_OF: Record<CandidateKind, string> = {
  measure: 'mdlMeasure',
  func: 'mdlFunc',
  column: 'mdlColumn',
  dimension: 'mdlDimension',
  enum: 'mdlEnum',
};

export function mdlCompletion(ctxField: ContextField): Extension {
  function source(context: CompletionContext): CompletionResult | null {
    const state = context.state;
    const ctx = state.field(ctxField);
    const g = state.field(syntaxField);

    const line = state.doc.lineAt(context.pos);
    const lineIndex = line.number - 1;
    const info = g.info[lineIndex];
    if (!info || !info.key) return null;

    // Nothing to offer while the cursor is still inside the key.
    if (context.pos - line.from < info.valueFrom) return null;

    const textBefore = state.doc.sliceString(line.from + info.valueFrom, context.pos);
    const c = candidates(g, ctx.evaluator, ctx.fixture, lineIndex, textBefore);
    if (!c.list.length) return null;

    if (context.view) SCOPES.set(context.view, c.scope);

    const options: Completion[] = c.list.map((x) => ({
      label: x.n,
      detail: x.h,
      type: x.n === c.current ? 'mdlCurrent' : TYPE_OF[x.k],
    }));

    return {
      from: context.pos - c.word.length,
      to: context.pos,
      options,
      // Candidates are already scoped and narrowed; CodeMirror's own filter
      // would hide the full list on lines that already hold a legal value.
      filter: false,
    };
  }

  /**
   * Opening the picker on arrival, and painting the scope line onto the tooltip
   * (CodeMirror has no header slot, so it goes on as a data attribute the
   * stylesheet renders with `::before`).
   */
  const opener = ViewPlugin.fromClass(
    class {
      private lastLine = -1;
      private timer: number | undefined;

      constructor(readonly view: EditorView) {}

      update(u: ViewUpdate) {
        const tip = this.view.dom.querySelector('.cm-tooltip-autocomplete');
        if (tip) tip.setAttribute('data-scope', SCOPES.get(this.view) || '');

        if (!u.selectionSet && !u.docChanged) return;

        const state = u.state;
        const pos = state.selection.main.head;
        const line = state.doc.lineAt(pos);
        const lineIndex = line.number - 1;
        if (lineIndex === this.lastLine) return;
        this.lastLine = lineIndex;

        const g = state.field(syntaxField);
        const info = g.info[lineIndex];
        if (!info || !info.key || !(info.key in CHOICE_KEYS)) return;
        if (pos - line.from < info.valueFrom) return;
        if (completionStatus(state) === 'active') return;

        window.clearTimeout(this.timer);
        this.timer = window.setTimeout(() => startCompletion(this.view), 0);
      }

      destroy() {
        window.clearTimeout(this.timer);
      }
    },
  );

  return [
    autocompletion({
      activateOnTyping: true,
      closeOnBlur: true,
      icons: true,
      defaultKeymap: true,
      tooltipClass: () => 'cm-mdl-completion',
      override: [source],
    }),
    opener,
  ];
}
