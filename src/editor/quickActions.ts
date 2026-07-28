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
import type { Diagnostic } from '../engine/diagnostics';
import { applyFixToView, renameEverywhere } from './apply';
import { syntaxField, type ContextField } from './context';

export const toggleQuickActions = StateEffect.define<boolean>();

interface Target {
  diagnostics: Diagnostic[];
  pill: PillToken | null;
}

function targetAt(view: EditorView, ctxField: ContextField): Target {
  const state = view.state;
  const ctx = state.field(ctxField);
  const g = state.field(syntaxField);
  const sel = state.selection.main;
  const line = state.doc.lineAt(sel.head);
  const lineIndex = line.number - 1;
  const col = sel.head - line.from;

  const toks = tokenizeLine(lineIndex, g, ctx.evaluator);

  return {
    diagnostics: ctx.diagnostics.filter((d) => d.line === lineIndex),
    pill: toks.find((t) => col >= t.from && col <= t.to) || null,
  };
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

      if (!fixes.length && !pill) {
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
