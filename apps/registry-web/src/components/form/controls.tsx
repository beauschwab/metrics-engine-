/**
 * The form's control primitives.
 *
 * Small on purpose. Each one exists because the surface needs a version of a
 * native control that carries a *hint* — the plain-language gloss that is the
 * whole reason form mode is legible to somebody who does not read YAML. A bare
 * `<select>` of `sum / avg / last` teaches nothing; `sum — adds every row` does.
 *
 * They are deliberately not a design-system port. The repo already has its
 * token layer and its focus treatment in `app.css`; these compose those rather
 * than introducing a second styling vocabulary.
 */

import type { ReactNode } from 'react';
import type { Diagnostic, Fix } from 'keel-engine/diagnostics';

export interface Choice {
  value: string;
  /** The plain-language gloss shown beside the value. */
  hint?: string;
}

interface FieldProps {
  label: string;
  hint?: string;
  /** Notes belonging to this field — rendered under it, never in a banner. */
  notes?: Diagnostic[];
  onFix?(fix: Fix, diagnostic: Diagnostic): void;
  children: ReactNode;
}

/**
 * One labelled control with its validation attached.
 *
 * The label turns red when the field has an error, so the eye finds the field
 * before it reads the note — the note explains, the colour locates.
 */
export function Field({ label, hint, notes = [], onFix, children }: FieldProps) {
  const invalid = notes.some((n) => n.sev === 'error');
  return (
    <div className="mdl-f" data-invalid={invalid}>
      <div className="mdl-f-label">
        <span className="mdl-f-name">{label}</span>
        {hint ? <span className="mdl-f-hint">{hint}</span> : null}
      </div>
      {children}
      {notes.map((n) => (
        <Note key={`${n.code}-${n.line}-${n.message}`} note={n} onFix={onFix} />
      ))}
    </div>
  );
}

/**
 * A validation note.
 *
 * A left rail in the severity hue plus the text — never colour alone, and never
 * a toast. Validation is a persistent property of the document; something that
 * disappears on a timer is not a property.
 */
export function Note({
  note,
  onFix,
}: {
  note: Diagnostic;
  onFix?(fix: Fix, diagnostic: Diagnostic): void;
}) {
  return (
    <div className="mdl-note" data-sev={note.sev}>
      <span className="mdl-note-code mono">{note.code}</span>
      <span className="mdl-note-text">{note.message}</span>
      {note.fix && onFix ? (
        <button
          type="button"
          className="mdl-fix"
          onClick={() => onFix(note.fix!, note)}
        >
          {/* The specific action, never a generic "Fix" — the label is what
              tells the reader whether they want it. */}
          {note.fixLabel || 'Apply'}
        </button>
      ) : null}
    </div>
  );
}

export function Picker({
  value,
  choices,
  onChange,
  invalid,
  ariaLabel,
  width,
}: {
  value: string;
  choices: Choice[];
  onChange(v: string): void;
  invalid?: boolean;
  ariaLabel: string;
  width?: number;
}) {
  return (
    <select
      className="mdl-select mdl-f-control"
      data-invalid={!!invalid}
      aria-label={ariaLabel}
      value={value}
      style={width ? { width, flex: 'none' } : undefined}
      onChange={(e) => onChange(e.target.value)}
    >
      {/* An unset value has to be selectable, or the control silently reports a
          choice the document has not made. */}
      {choices.some((c) => c.value === value) ? null : <option value={value}>{value || '—'}</option>}
      {choices.map((c) => (
        <option key={c.value} value={c.value}>
          {c.value || '—'}
          {c.hint ? `  ·  ${c.hint}` : ''}
        </option>
      ))}
    </select>
  );
}

export function TextBox({
  value,
  onChange,
  onCommit,
  onRevert,
  invalid,
  ariaLabel,
  mono,
}: {
  value: string;
  onChange(v: string): void;
  /** Present when the field is a draft — commits on blur and Enter. */
  onCommit?(): void;
  onRevert?(): void;
  invalid?: boolean;
  ariaLabel: string;
  mono?: boolean;
}) {
  return (
    <input
      type="text"
      className={`mdl-input mdl-f-control${mono ? ' mono' : ''}`}
      data-invalid={!!invalid}
      aria-label={ariaLabel}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onBlur={onCommit}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && onCommit) {
          e.preventDefault();
          (e.target as HTMLInputElement).blur();
        }
        if (e.key === 'Escape' && onRevert) {
          e.preventDefault();
          onRevert();
        }
      }}
    />
  );
}

/**
 * A drop target with a keyboard-reachable equivalent beneath it.
 *
 * Drag is an accelerator, never the only path — a control you can only operate
 * with a mouse is a control some people cannot operate.
 */
export function DropZone({
  chip,
  placeholder,
  accepts,
  onDrop,
}: {
  chip: ReactNode | null;
  placeholder: string;
  accepts: 'column' | 'measure';
  onDrop(name: string): void;
}) {
  return (
    <div
      className="mdl-drop"
      data-filled={!!chip}
      onDragOver={(e) => {
        // Without preventDefault the browser refuses the drop and the gesture
        // silently does nothing.
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
      }}
      onDrop={(e) => {
        e.preventDefault();
        const raw = e.dataTransfer.getData('application/x-mdl') || '';
        const [kind, name] = raw.split(':');
        if (kind === accepts && name) onDrop(name);
      }}
    >
      {chip || <span className="mdl-drop-hint">{placeholder}</span>}
    </div>
  );
}

/**
 * A reference chip.
 *
 * Each class carries a distinct leading glyph as well as a hue, so the taxonomy
 * survives deuteranopia — colour is never the only channel.
 */
export function Chip({
  text,
  kind,
  onClick,
  onDragStart,
  title,
  ariaLabel,
}: {
  text: string;
  kind: 'measure' | 'function' | 'keyword' | 'plain' | 'column';
  onClick?(): void;
  onDragStart?(e: React.DragEvent): void;
  title?: string;
  ariaLabel?: string;
}) {
  const Tag = onClick ? 'button' : 'span';
  return (
    <Tag
      className="mdl-chip"
      data-kind={kind}
      type={onClick ? 'button' : undefined}
      title={title}
      aria-label={ariaLabel}
      draggable={!!onDragStart}
      onDragStart={onDragStart}
      onClick={onClick}
    >
      {text}
    </Tag>
  );
}

export function PaletteRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="mdl-palette-row">
      <span className="mdl-palette-label">{label}</span>
      <div className="mdl-palette-items">{children}</div>
    </div>
  );
}
