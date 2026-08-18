/**
 * The signed-off-measure banner (§11).
 *
 * Editing a validated measure is permitted — the diagnostic and the audit
 * record are the control, not a lock, because a lock gets routed around by
 * copying the file. So this is an inline banner above the measure, never a
 * modal, and it appears only for the measure the cursor is actually in.
 */

import { Decoration, EditorView, WidgetType, type DecorationSet } from '@codemirror/view';
import { StateField, type EditorState, type Extension } from '@codemirror/state';
import { ownerAt } from 'keel-engine/parse';
import { syntaxField, type ContextField } from './context';

class BannerWidget extends WidgetType {
  constructor(
    readonly text: string,
    readonly ticket: string,
  ) {
    super();
  }

  eq(other: BannerWidget) {
    return this.text === other.text && this.ticket === other.ticket;
  }

  toDOM() {
    const el = document.createElement('div');
    el.className = 'cm-mdl-banner';
    el.setAttribute('role', 'note');

    const mark = document.createElement('span');
    mark.className = 'cm-mdl-banner-mark';
    mark.textContent = '●';
    mark.setAttribute('aria-hidden', 'true');
    el.appendChild(mark);

    const text = document.createElement('span');
    text.textContent = this.text;
    el.appendChild(text);

    if (this.ticket) {
      const ticket = document.createElement('span');
      ticket.className = 'cm-mdl-banner-ticket';
      ticket.textContent = this.ticket;
      el.appendChild(ticket);
    }
    return el;
  }

  ignoreEvent() {
    return true;
  }
}

function build(state: EditorState, ctxField: ContextField): DecorationSet {
  void ctxField;
  const g = state.field(syntaxField);
  const here = state.doc.lineAt(state.selection.main.head).number - 1;
  const owner = ownerAt(g, here);
  if (!owner) return Decoration.none;
  if ((owner.f.validation_status || '').trim() !== 'validated') return Decoration.none;

  const ticket = (owner.f.change_ticket || '').trim();
  const line = state.doc.line(Math.min(owner.line + 1, state.doc.lines));

  return Decoration.set([
    Decoration.widget({
      widget: new BannerWidget(
        ticket
          ? `${owner.name} is signed off. This edit is tracked against`
          : `${owner.name} is signed off — editing it needs a change ticket. You can still edit it.`,
        ticket,
      ),
      block: true,
      side: -1,
    }).range(line.from),
  ]);
}

export function validatedBanner(ctxField: ContextField): Extension {
  return StateField.define<DecorationSet>({
    create: (state) => build(state, ctxField),
    update(value, tr) {
      if (!tr.docChanged && !tr.selection && !tr.effects.length) return value;
      return build(tr.state, ctxField);
    },
    provide: (f) => EditorView.decorations.from(f),
  });
}
