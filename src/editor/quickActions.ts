/**
 * `⌘.` — quick actions on whatever the cursor is touching.
 *
 * On a diagnostic it offers that diagnostic's fix; on a pill it offers
 * navigation and a rename across every reference. Every action is a text
 * transformation the author can read in the diff afterwards. Nothing here
 * rewrites more than it says it will.
 */

import { StateEffect, StateField, type Extension } from '@codemirror/state';
import { showTooltip, type EditorView, type Tooltip } from '@codemirror/view';
import { tokenizeLine, type PillToken } from '../engine/tokens';
import { EXTERNAL, isReferenceName } from '../engine/vocab';
import type { Diagnostic } from '../engine/diagnostics';
import { applyFixToView, renameEverywhere } from './apply';
import { ownerAt } from '../engine/parse';
import { syntaxField, type ContextField } from './context';

export const toggleQuickActions = StateEffect.define<boolean>();

interface Target {
  diagnostics: Diagnostic[];
  pill: PillToken | null;
  /** A non-empty selection inside an expression — the unit "extract" works on. */
  selection: { from: number; to: number; text: string } | null;
}

function targetAt(view: EditorView, ctxField: ContextField): Target {
  const state = view.state;
  const ctx = state.field(ctxField);
  const g = state.field(syntaxField);
  const sel = state.selection.main;
  const line = state.doc.lineAt(sel.head);
  const lineIndex = line.number - 1;
  const col = sel.head - line.from;
  const info = g.info[lineIndex];

  const toks = tokenizeLine(lineIndex, g, ctx.evaluator);
  const selectedText = sel.empty ? '' : state.doc.sliceString(sel.from, sel.to).trim();

  return {
    diagnostics: ctx.diagnostics.filter((d) => d.line === lineIndex),
    pill: toks.find((t) => col >= t.from && col <= t.to) || null,
    selection:
      selectedText && info && info.key === 'expression'
        ? { from: sel.from, to: sel.to, text: selectedText }
        : null,
  };
}

/**
 * Rewrite a measure's `requires` to exactly the names its expression now
 * references.
 *
 * Extract and inline both change what an expression depends on, and leaving
 * the dependency list stale would hand the author two diagnostics to clear by
 * hand immediately after an action that was supposed to help. Run as a
 * follow-up dispatch so it reads the re-parsed document.
 */
function syncRequires(view: EditorView, measureName: string): void {
  const g = view.state.field(syntaxField);
  const m = g.byName[measureName];
  if (!m || m.lineOf.requires === undefined) return;

  const names = (m.f.expression || '')
    .match(/[A-Za-z_][A-Za-z0-9_]*/g)
    ?.filter(isReferenceName)
    .filter((n) => g.byName[n] || EXTERNAL[n])
    .filter((n, i, a) => a.indexOf(n) === i) ?? [];

  const line = view.state.doc.line(m.lineOf.requires + 1);
  const next = line.text.replace(/^(\s*requires:).*$/, `$1 [${names.join(', ')}]`);
  if (next === line.text) return;

  view.dispatch({ changes: { from: line.from, to: line.to, insert: next } });
}

/** Only a derived measure can be inlined: a simple one reads the table. */
function canInline(view: EditorView, name: string): boolean {
  const g = view.state.field(syntaxField);
  const m = g.byName[name];
  return !!m && (m.f.type || '').trim() === 'derived' && !!m.f.expression;
}

/**
 * Replace a reference with the expression it stands for, then bring the
 * dependency list back in line with what the expression now names.
 */
function inlineDefinition(view: EditorView, pill: PillToken): void {
  const state = view.state;
  const g = state.field(syntaxField);
  const m = g.byName[pill.name];
  if (!m) return;

  const here = state.doc.lineAt(state.selection.main.head).number - 1;
  const owner = ownerAt(g, here);
  const line = state.doc.lineAt(state.selection.main.head);
  const from = line.from + pill.from;
  const to = line.from + pill.to;
  if (state.doc.sliceString(from, to) !== pill.name) return;

  const expr = (m.f.expression || '').trim();
  view.dispatch({
    changes: { from, to, insert: `(${expr})` },
    selection: { anchor: from, head: from + expr.length + 2 },
    scrollIntoView: true,
  });
  if (owner) syncRequires(view, owner.name);
  view.focus();
}

/**
 * Lift the selected sub-expression into its own measure and leave a reference
 * behind. Both halves are plain text edits the author can read in the diff.
 */
function extractSelection(view: EditorView): void {
  const state = view.state;
  const g = state.field(syntaxField);
  const sel = state.selection.main;
  const text = state.doc.sliceString(sel.from, sel.to).trim();
  if (!text) return;

  const here = state.doc.lineAt(sel.head).number - 1;
  const owner = [...g.measures].reverse().find((m) => m.line <= here);
  if (!owner) return;

  const base = `${owner.name}_part`;
  let name = base;
  let n = 2;
  while (g.byName[name]) name = `${base}${n++}`;

  const referenced = (text.match(/[A-Za-z_][A-Za-z0-9_]*/g) || [])
    .filter(isReferenceName)
    .filter((x) => g.byName[x] || EXTERNAL[x])
    .filter((x, i, a) => a.indexOf(x) === i);

  const block = [
    '',
    `  - name: ${name}`,
    '    type: derived',
    `    requires: [${referenced.join(', ')}]`,
    '    expression: >',
    `      ${text}`,
    '',
  ].join('\n');

  const anchor = state.doc.line(Math.max(1, owner.line + 1)).from;

  // Replace the selection first, then insert above it, so neither edit shifts
  // the other's coordinates.
  view.dispatch({
    changes: [
      { from: sel.from, to: sel.to, insert: name },
      { from: anchor, insert: `${block.replace(/^\n/, '')}\n` },
    ],
    scrollIntoView: true,
  });
  syncRequires(view, owner.name);
  view.focus();
}

function makeTooltip(pos: number, ctxField: ContextField): Tooltip {
  return {
    pos,
    above: false,
    arrow: false,
    create: (view) => {
      const dom = document.createElement('div');
      dom.className = 'cm-mdl-actions';

      const target = targetAt(view, ctxField);
      const fixes = target.diagnostics.filter((d) => d.fix);
      const close = () => view.dispatch({ effects: toggleQuickActions.of(false) });

      const header = (text: string) => {
        const h = document.createElement('div');
        h.className = 'cm-mdl-actions-head';
        h.textContent = text;
        dom.appendChild(h);
      };

      const item = (label: string, hint: string, run: () => void) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'cm-mdl-action';
        const l = document.createElement('span');
        l.textContent = label;
        b.appendChild(l);
        const h = document.createElement('span');
        h.className = 'cm-mdl-action-hint';
        h.textContent = hint;
        b.appendChild(h);
        b.addEventListener('mousedown', (e) => {
          e.preventDefault();
          run();
        });
        dom.appendChild(b);
      };

      if (fixes.length) {
        header('Fix');
        fixes.forEach((d) => {
          item(d.fixLabel || 'Quick fix', d.code, () => {
            close();
            applyFixToView(view, d.fix!);
          });
        });
      }

      // §5.4 — extract a piece of an expression into its own measure. Offered
      // only with a selection, because the selection *is* the thing extracted.
      if (target.selection) {
        header('Selection');
        item('Extract to a new measure', '', () => {
          close();
          extractSelection(view);
        });
      }

      const pill = target.pill;
      if (pill) {
        header(pill.name);
        item('Go to definition', '⌘-click', () => {
          close();
          view.state.field(ctxField).handlers.onGoToDefinition(pill.name);
        });
        item('Show dependents', '', () => {
          close();
          view.state.field(ctxField).handlers.onShowDependents(pill.name);
        });
        if (canInline(view, pill.name)) {
          item('Inline definition', '', () => {
            close();
            inlineDefinition(view, pill);
          });
        }
        item('Rename across references', '', () => {
          dom.innerHTML = '';
          header(`Rename ${pill.name} everywhere`);

          const input = document.createElement('input');
          input.className = 'cm-mdl-action-input';
          input.value = pill.name;
          input.spellcheck = false;
          dom.appendChild(input);

          const note = document.createElement('div');
          note.className = 'cm-mdl-actions-note';
          note.textContent = 'Enter to apply · Esc to cancel';
          dom.appendChild(note);

          input.addEventListener('keydown', (e) => {
            e.stopPropagation();
            if (e.key === 'Enter') {
              e.preventDefault();
              const next = input.value.trim();
              close();
              renameEverywhere(view, pill.name, next);
              view.focus();
            }
            if (e.key === 'Escape') {
              e.preventDefault();
              close();
              view.focus();
            }
          });

          window.setTimeout(() => {
            input.focus();
            input.select();
          }, 0);
        });
      }

      if (!fixes.length && !pill && !target.selection) {
        header('No actions here');
        const note = document.createElement('div');
        note.className = 'cm-mdl-actions-note';
        note.textContent = 'Put the cursor on a pill or a flagged line.';
        dom.appendChild(note);
      }

      return { dom };
    },
  };
}

export function quickActions(ctxField: ContextField): Extension {
  return StateField.define<Tooltip | null>({
    create: () => null,
    update(value, tr) {
      // Any edit or cursor move dismisses it — a stale action menu is worse
      // than no action menu.
      if (tr.docChanged || tr.selection) return null;
      for (const e of tr.effects) {
        if (e.is(toggleQuickActions)) {
          return e.value ? makeTooltip(tr.state.selection.main.head, ctxField) : null;
        }
      }
      return value;
    },
    provide: (f) => showTooltip.from(f),
  });
}
