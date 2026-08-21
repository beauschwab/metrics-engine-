/**
 * Applying a text transformation to the document.
 *
 * Quick fixes are computed as a whole-document line array and then narrowed to
 * the smallest changed span before dispatch, so undo stays granular and the
 * cursor does not jump when a fix touches a line the author is not looking at.
 */

import type { EditorView } from '@codemirror/view';
import { applyFix, type Fix } from 'keel-engine/diagnostics';
import { syntaxField } from './context';

export function replaceDocLines(view: EditorView, next: string[]): void {
  const prev = view.state.doc.toString().split('\n');

  let head = 0;
  while (head < prev.length && head < next.length && prev[head] === next[head]) head++;

  let tail = 0;
  while (
    tail < prev.length - head &&
    tail < next.length - head &&
    prev[prev.length - 1 - tail] === next[next.length - 1 - tail]
  ) {
    tail++;
  }

  if (head === prev.length && head === next.length) return;

  const fromLine = view.state.doc.line(Math.min(head + 1, view.state.doc.lines));
  const toLineNo = Math.max(prev.length - tail, head + 1);
  const toLine = view.state.doc.line(Math.min(toLineNo, view.state.doc.lines));
  const insert = next.slice(head, next.length - tail).join('\n');

  view.dispatch({
    changes: { from: fromLine.from, to: toLine.to, insert },
    scrollIntoView: true,
  });
}

export function applyFixToView(view: EditorView, fix: Fix): void {
  const g = view.state.field(syntaxField);
  const lines = view.state.doc.toString().split('\n');
  replaceDocLines(view, applyFix(lines, fix, g));
  view.focus();
}

/** Rename an identifier everywhere it appears, as a single undoable edit. */
export function renameEverywhere(view: EditorView, from: string, to: string): void {
  if (!to || from === to) return;
  const re = new RegExp(`\\b${from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'g');
  const lines = view.state.doc.toString().split('\n').map((l) => l.replace(re, to));
  replaceDocLines(view, lines);
}
