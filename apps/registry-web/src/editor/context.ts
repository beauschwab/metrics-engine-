/**
 * Everything the editor extensions need from the application, carried in
 * editor state so decoration fields can read it synchronously.
 *
 * Note the split: *structure* (which line is which key, where a token starts)
 * is always parsed from the live document inside the editor, while *values*
 * and *diagnostics* arrive from React one render behind. That is deliberate —
 * it is what lets pills repaint on the keystroke without waiting on
 * evaluation, per the 16ms budget in §12.
 */

import { StateEffect, StateField } from '@codemirror/state';
import type { Evaluator } from 'keel-engine/evaluate';
import type { Diagnostic } from 'keel-engine/diagnostics';
import type { RefactorHint } from 'keel-engine/refactors';
import { parse, type Graph } from 'keel-engine/parse';
import type { FixtureName, PillKind, PillState } from 'keel-engine/vocab';

export interface PillRef {
  name: string;
  kind: PillKind;
  state: PillState;
  rect: DOMRect;
}

export interface EditorHandlers {
  onHoverPill(ref: PillRef): void;
  onLeavePill(): void;
  onGoToDefinition(name: string): void;
  onPeek(name: string, line: number): void;
  onSelectPill(name: string): void;
  onClosePeek(): void;
  onShowDependents(name: string): void;
}

export interface EditorContext {
  evaluator: Evaluator;
  diagnostics: Diagnostic[];
  /** Passive structural prompts — never blocking, never modal (§7.3). */
  hints: RefactorHint[];
  fixture: FixtureName;
  activeMeasure: string;
  /** The state switcher demonstrates each pill state on one measure. */
  pillStateOverride: PillState;
  pillStateTarget: string;
  peek: { name: string; line: number } | null;
  handlers: EditorHandlers;
}

export const setContext = StateEffect.define<EditorContext>();

export function contextField(initial: EditorContext) {
  return StateField.define<EditorContext>({
    create: () => initial,
    update(value, tr) {
      for (const e of tr.effects) if (e.is(setContext)) return e.value;
      return value;
    },
  });
}

export type ContextField = ReturnType<typeof contextField>;

/**
 * The document's own structure, re-read on every change.
 *
 * Resolution is cheap enough to run whole-document here: a 105-line view parses
 * in well under a millisecond, and keeping it in lockstep with the doc removes
 * a whole class of stale-range bugs that incremental invalidation invites.
 */
export const syntaxField = StateField.define<Graph>({
  create: (state) => parse(state.doc.toString().split('\n')),
  update(value, tr) {
    if (!tr.docChanged) return value;
    return parse(tr.state.doc.toString().split('\n'));
  },
});
