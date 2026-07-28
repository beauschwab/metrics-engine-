/**
 * Diagnostics as a persistent property of the document.
 *
 * Inline treatment is a wavy underline in the severity hue beneath the
 * offending range only — never a full-line highlight, which would obscure the
 * pills. Errors never appear as toasts or modals: they live in the gutter, the
 * underline and the problems strip, and nowhere else.
 */

import { linter, type Diagnostic as CMDiagnostic } from '@codemirror/lint';
import type { Extension } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import type { Diagnostic } from '../engine/diagnostics';
import type { ContextField } from './context';
import { setContext, syntaxField } from './context';
import { applyFixToView } from './apply';

const SEVERITY = { error: 'error', warn: 'warning', info: 'info' } as const;

/** Where to draw the squiggle: the named token, else the scalar, else the line. */
function rangeFor(view: EditorView, d: Diagnostic): { from: number; to: number } | null {
  const doc = view.state.doc;
  if (d.line < 0 || d.line >= doc.lines) return null;

  const line = doc.line(d.line + 1);
  const g = view.state.field(syntaxField);
  const info = g.info[d.line];

  if (d.token) {
    const idx = line.text.indexOf(d.token, info ? info.valueFrom : 0);
    if (idx >= 0) return { from: line.from + idx, to: line.from + idx + d.token.length };
  }

  const start = info && info.valueFrom < line.text.length ? info.valueFrom : 0;
  const trimmedEnd = line.text.replace(/\s+$/, '').length;
  if (trimmedEnd <= start) {
    // A key with no value yet — underline the key itself so there is something to see.
    return { from: line.from, to: line.from + Math.max(1, trimmedEnd) };
  }
  return { from: line.from + start, to: line.from + trimmedEnd };
}

export function mdlLinter(ctxField: ContextField): Extension {
  return linter(
    (view) => {
      const ctx = view.state.field(ctxField);
      const out: CMDiagnostic[] = [];

      ctx.diagnostics.forEach((d) => {
        const range = rangeFor(view, d);
        if (!range) return;
        out.push({
          from: range.from,
          to: range.to,
          severity: SEVERITY[d.sev],
          source: d.code,
          message: `${d.code} · ${d.message}`,
          actions: d.fix
            ? [{
                name: d.fixLabel || 'Quick fix',
                apply: (v) => applyFixToView(v, d.fix!),
              }]
            : undefined,
        });
      });

      return out;
    },
    {
      delay: 50,
      // Diagnostics arrive with the evaluation loop, not with the keystroke, so
      // the linter has to re-read when context lands as well as on doc change.
      needsRefresh: (u) => u.transactions.some((tr) => tr.effects.some((e) => e.is(setContext))),
    },
  );
}
