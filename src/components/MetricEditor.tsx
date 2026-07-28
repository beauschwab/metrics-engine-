/**
 * The CodeMirror host.
 *
 * React owns the document text and the evaluation results; CodeMirror owns
 * everything inside the editor viewport. The two meet at exactly two points —
 * an `onChange` out, and a `setContext` effect in.
 */

import { useEffect, useImperativeHandle, useRef, type Ref } from 'react';
import { closeBrackets } from '@codemirror/autocomplete';
import { history, historyKeymap, defaultKeymap } from '@codemirror/commands';
import { lintKeymap } from '@codemirror/lint';
import { EditorState } from '@codemirror/state';
import { EditorView, drawSelection, highlightSpecialChars, keymap, lineNumbers } from '@codemirror/view';
import type { Fix } from '../engine/diagnostics';
import { ownerAt } from '../engine/parse';
import { applyFixToView } from '../editor/apply';
import { activeMeasureGutter, chrome, pillMarkGutter, severityGutter } from '../editor/chrome';
import { contextField, setContext, syntaxField, type EditorContext } from '../editor/context';
import { ghostText } from '../editor/ghost';
import { dropInsert, mdlKeymap } from '../editor/keymap';
import { mdlLinter } from '../editor/lint';
import { mdlCompletion } from '../editor/completion';
import { peekPane } from '../editor/peek';
import { pills } from '../editor/pills';
import { quickActions } from '../editor/quickActions';
import { mdlTheme } from '../editor/theme';

export interface MetricEditorHandle {
  /** Put the cursor on a line and reveal it — used by the problems strip. */
  goToLine(line: number): void;
  /** Reveal the `- name:` line of a measure — used by ⌘-click and the tree. */
  goToMeasure(name: string): void;
  /**
   * Apply a quick fix. Document mutations all go through the view, which owns
   * the text; React's copy is a mirror kept current by `onChange`. Editing the
   * mirror instead would leave the editor showing something else.
   */
  applyFix(fix: Fix): void;
}

interface Props {
  doc: string;
  context: EditorContext;
  onChange(doc: string): void;
  onCursorMeasure(name: string): void;
  handle?: Ref<MetricEditorHandle>;
}

export function MetricEditor({ doc, context, onChange, onCursorMeasure, handle }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);

  // Handlers and context change every render; the extensions read them through
  // a ref so the editor is never torn down and rebuilt.
  const latest = useRef(context);
  latest.current = context;
  const emit = useRef({ onChange, onCursorMeasure });
  emit.current = { onChange, onCursorMeasure };

  useEffect(() => {
    if (!host.current) return;

    const ctxField = contextField(latest.current);
    const ghost = ghostText(ctxField);

    const state = EditorState.create({
      doc,
      extensions: [
        ctxField,
        syntaxField,
        lineNumbers(),
        severityGutter(ctxField),
        pillMarkGutter(ctxField),
        activeMeasureGutter(ctxField),
        chrome(ctxField),
        pills(ctxField),
        peekPane(ctxField),
        mdlLinter(ctxField),
        mdlCompletion(ctxField),
        ghost.extension,
        quickActions(ctxField),
        mdlKeymap(ctxField, ghost.current),
        dropInsert(),
        history(),
        closeBrackets(),
        drawSelection(),
        highlightSpecialChars(),
        EditorView.lineWrapping,
        keymap.of([...defaultKeymap, ...historyKeymap, ...lintKeymap]),
        mdlTheme,
        EditorView.updateListener.of((u) => {
          if (u.docChanged) emit.current.onChange(u.state.doc.toString());
          if (u.selectionSet || u.docChanged) {
            const g = u.state.field(syntaxField);
            const line = u.state.doc.lineAt(u.state.selection.main.head).number - 1;
            const owner = ownerAt(g, line);
            if (owner) emit.current.onCursorMeasure(owner.name);
          }
        }),
      ],
    });

    const v = new EditorView({ state, parent: host.current });
    view.current = v;

    return () => {
      v.destroy();
      view.current = null;
    };
    // The document is seeded once; switching files remounts via `key`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Push fresh values, diagnostics and UI state into the editor.
  useEffect(() => {
    const v = view.current;
    if (!v) return;
    v.dispatch({ effects: setContext.of(context) });
  }, [context]);

  useImperativeHandle(
    handle,
    () => ({
      goToLine(line: number) {
        const v = view.current;
        if (!v) return;
        const n = Math.max(1, Math.min(line + 1, v.state.doc.lines));
        const at = v.state.doc.line(n);
        v.dispatch({
          selection: { anchor: at.from + at.text.length },
          scrollIntoView: true,
        });
        v.focus();
      },
      goToMeasure(name: string) {
        const v = view.current;
        if (!v) return;
        const g = v.state.field(syntaxField);
        const m = g.byName[name];
        if (!m) return;
        const at = v.state.doc.line(Math.min(m.line + 1, v.state.doc.lines));
        v.dispatch({ selection: { anchor: at.to }, scrollIntoView: true });
        v.focus();
      },
      applyFix(fix: Fix) {
        const v = view.current;
        if (v) applyFixToView(v, fix);
      },
    }),
    [],
  );

  return <div ref={host} className="mdl-editor-host" />;
}
