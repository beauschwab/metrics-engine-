/**
 * Pills as true inline widgets.
 *
 * `Decoration.replace({ widget })` substitutes the source range with a rendered
 * element; `EditorView.atomicRanges` makes arrow keys and Backspace treat that
 * range as one unit; and the decoration is dropped whenever the selection
 * enters the range, which restores the raw text for editing. The three
 * together are the reason this is CodeMirror and not a styled text range.
 */

import { EditorState, RangeSetBuilder, StateEffect, StateField, type Extension } from '@codemirror/state';
import { Decoration, EditorView, WidgetType, type DecorationSet } from '@codemirror/view';
import { pillHue, tokenizeLine, type PillToken } from '../engine/tokens';
import { PILL_KEYS, type PillState } from '../engine/vocab';
import type { ContextField } from './context';
import { syntaxField } from './context';

/**
 * Opening a pill for text editing.
 *
 * Atomic ranges are what stop arrow keys from landing inside a reference —
 * which is the behaviour §5.4 asks for, and also the reason the cursor can
 * never wander in on its own. So entering the text is made explicit:
 * double-click, or Enter on a selected pill. While a range is open it is
 * neither decorated nor atomic, so it edits exactly like plain text; it closes
 * again as soon as the selection leaves.
 */
const openPill = StateEffect.define<{ from: number; to: number } | null>();

const openPillField = StateField.define<{ from: number; to: number } | null>({
  create: () => null,
  update(value, tr) {
    for (const e of tr.effects) if (e.is(openPill)) return e.value;
    if (!value) return null;

    // Only edits made *inside* the reference keep it open. A quick fix that
    // rewrites the line would otherwise stretch the open range across the
    // whole line and silently suppress every pill on it.
    let outside = false;
    tr.changes.iterChangedRanges((fromA, toA) => {
      if (fromA < value.from || toA > value.to) outside = true;
    });
    if (outside) return null;

    const from = tr.changes.mapPos(value.from, -1);
    const to = tr.changes.mapPos(value.to, 1);
    if (to <= from) return null;

    const sel = tr.state.selection.main;
    if (sel.head < from || sel.head > to) return null;
    return { from, to };
  },
});

class PillWidget extends WidgetType {
  constructor(
    readonly tok: PillToken,
    readonly focused: boolean,
    readonly ctxField: ContextField,
  ) {
    super();
  }

  eq(other: PillWidget): boolean {
    const a = this.tok;
    const b = other.tok;
    return (
      a.name === b.name && a.label === b.label && a.kind === b.kind && a.state === b.state &&
      a.tier === b.tier && a.value === b.value && a.glyph === b.glyph && a.post === b.post &&
      this.focused === other.focused
    );
  }

  toDOM(view: EditorView): HTMLElement {
    const t = this.tok;
    const el = document.createElement('span');
    el.className = `cm-pill cm-pill-${t.kind} cm-pill-${t.state}${this.focused ? ' cm-pill-focused' : ''}`;
    const hue = pillHue(t.kind, t.state);
    el.style.setProperty('--pill-hue', hue);
    // Fill at 14% of the hue, border at 32% — 8-digit hex rather than a
    // colour function so the alpha is exact and cheap to recompute.
    el.style.setProperty('--pill-bg', `${hue}24`);
    el.style.setProperty('--pill-border', `${hue}52`);
    el.setAttribute('role', 'button');
    el.setAttribute('tabindex', '-1');
    el.setAttribute('aria-label', t.ariaLabel);
    el.title = t.ariaLabel;

    const glyph = document.createElement('span');
    glyph.className = 'cm-pill-glyph';
    glyph.textContent = t.glyph;
    glyph.setAttribute('aria-hidden', 'true');
    el.appendChild(glyph);

    el.appendChild(document.createTextNode(t.label));

    if (t.post) {
      const post = document.createElement('span');
      post.className = 'cm-pill-post';
      post.textContent = t.post;
      post.setAttribute('aria-hidden', 'true');
      el.appendChild(post);
    }

    // A constant, non-blocking reminder that this definition is evidence.
    if (t.tier >= 1 && t.tier <= 2) {
      const dot = document.createElement('span');
      dot.className = 'cm-pill-tier';
      dot.setAttribute('aria-hidden', 'true');
      el.appendChild(dot);
    }

    let timer: number | undefined;
    const ctx = () => view.state.field(this.ctxField);

    el.addEventListener('mouseenter', () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        ctx().handlers.onHoverPill({
          name: t.name, kind: t.kind, state: t.state,
          rect: el.getBoundingClientRect(),
        });
      }, 300);
    });

    el.addEventListener('mouseleave', () => {
      window.clearTimeout(timer);
      ctx().handlers.onLeavePill();
    });

    const activate = (e: MouseEvent | KeyboardEvent) => {
      const handlers = ctx().handlers;
      if ((e as MouseEvent).metaKey || (e as MouseEvent).ctrlKey) {
        handlers.onGoToDefinition(t.name);
        return;
      }
      if ((e as MouseEvent).altKey) {
        const pos = view.posAtDOM(el);
        handlers.onPeek(t.name, view.state.doc.lineAt(pos).number - 1);
        return;
      }
      // Plain click selects the pill as an atomic unit, so Backspace removes
      // the whole reference rather than one character of it.
      const pos = view.posAtDOM(el);
      view.dispatch({ selection: { anchor: pos, head: pos + t.name.length } });
      view.focus();
      handlers.onSelectPill(t.name);
    };

    /** Drop the decoration and put the caret in the raw text. */
    const openForEditing = (atEnd: boolean) => {
      const pos = view.posAtDOM(el);
      const range = { from: pos, to: pos + t.name.length };
      view.dispatch({
        effects: openPill.of(range),
        selection: { anchor: atEnd ? range.to : range.from },
      });
      view.focus();
    };

    el.addEventListener('mousedown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      window.clearTimeout(timer);
      if (e.detail > 1) {
        openForEditing(true);
        return;
      }
      activate(e);
    });

    el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        openForEditing(true);
        return;
      }
      if (e.key === ' ') {
        e.preventDefault();
        activate(e);
      }
    });

    return el;
  }

  /** The widget runs its own event handling; CodeMirror should keep out of it. */
  ignoreEvent(): boolean {
    return true;
  }
}

/**
 * The trigger to dissolve back to raw text: the cursor has landed *within* the
 * reference, or a selection cuts across it. A selection that covers the whole
 * reference is the opposite case — that is the pill selected as an atomic
 * unit, and it stays a pill.
 */
function selectionInside(state: EditorState, from: number, to: number): boolean {
  return state.selection.ranges.some((r) => {
    if (r.empty) return r.head > from && r.head < to;
    if (r.from <= from && r.to >= to) return false;
    return r.from < to && r.to > from;
  });
}

/** Cursor adjacent, or the whole reference selected — either way, focused. */
function selectionAdjacent(state: EditorState, from: number, to: number): boolean {
  return state.selection.ranges.some((r) =>
    r.empty ? r.head === from || r.head === to : r.from <= from && r.to >= to,
  );
}

function buildPills(state: EditorState, ctxField: ContextField): DecorationSet {
  const ctx = state.field(ctxField);
  const g = state.field(syntaxField);
  const open = state.field(openPillField);
  const builder = new RangeSetBuilder<Decoration>();

  const opts = {
    overrideName: ctx.pillStateTarget,
    override: ctx.pillStateOverride as PillState,
  };

  for (let i = 0; i < g.lines.length && i < state.doc.lines; i++) {
    const info = g.info[i];
    if (!info || !info.key || !(info.key in PILL_KEYS)) continue;

    const line = state.doc.line(i + 1);
    const toks = tokenizeLine(i, g, ctx.evaluator, opts);

    for (const tok of toks) {
      const from = line.from + tok.from;
      const to = line.from + tok.to;
      if (to > line.to) continue;
      if (open && open.from <= from && open.to >= to) continue;
      if (selectionInside(state, from, to)) continue;

      const focused = tok.state === 'focused' || selectionAdjacent(state, from, to);
      builder.add(from, to, Decoration.replace({
        widget: new PillWidget(tok, focused, ctxField),
      }));
    }
  }

  return builder.finish();
}

export function pills(ctxField: ContextField): Extension {
  const field = StateField.define<DecorationSet>({
    create: (state) => buildPills(state, ctxField),
    update(value, tr) {
      // Selection changes matter as much as document changes here: moving the
      // cursor into a pill is what reveals its text.
      if (!tr.docChanged && !tr.selection && !tr.effects.length) return value;
      return buildPills(tr.state, ctxField);
    },
    provide: (f) => EditorView.decorations.from(f),
  });

  return [
    openPillField,
    field,
    // Only decorated ranges are atomic — an open pill is plain text again.
    EditorView.atomicRanges.of((view) => view.state.field(field)),
  ];
}
