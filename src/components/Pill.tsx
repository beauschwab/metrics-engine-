/**
 * A pill outside the editor.
 *
 * The trace, the blast radius and the definition card all render references,
 * and a reference has to read as the same object wherever it appears — same
 * hue, same glyph, same tier dot, same hover behaviour.
 */

import type { MouseEvent } from 'react';
import { glyphFor, pillHue } from '../engine/tokens';
import { KIND_LABEL, STATE_LABEL, type PillKind, type PillState } from '../engine/vocab';

interface Props {
  name: string;
  kind?: PillKind;
  state?: PillState;
  tier?: number;
  value?: string;
  onEnter?(e: MouseEvent<HTMLElement>): void;
  onLeave?(): void;
  onClick?(): void;
}

export function Pill({
  name, kind = 'measure', state = 'resolved', tier = 0, value,
  onEnter, onLeave, onClick,
}: Props) {
  const hue = pillHue(kind, state);
  const glyph = glyphFor(kind, state);
  const post =
    kind === 'measure' && state !== 'unresolved' && state !== 'circular' && state !== 'restricted'
      ? '⟩'
      : state === 'deprecated'
        ? '⊘'
        : '';

  const label =
    `${KIND_LABEL[kind]} ${name}, ${tier ? `oversight level ${tier}, ` : ''}${STATE_LABEL[state]}` +
    `${value ? `, currently ${value}` : ''}`;

  return (
    <span
      className="mdl-pill"
      role="button"
      tabIndex={0}
      aria-label={label}
      title={label}
      style={{
        // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
        ...({ '--pill-hue': hue, '--pill-bg': `${hue}24`, '--pill-border': `${hue}52` } as Record<string, string>),
      }}
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onClick?.();
        }
      }}
    >
      <span aria-hidden="true">{glyph}</span>
      {kind !== 'measure' ? ' ' : ''}
      {state === 'restricted' ? 'restricted' : name}
      {post ? <span aria-hidden="true">{post}</span> : null}
      {tier >= 1 && tier <= 2 ? <span className="mdl-pill-tier" aria-hidden="true" /> : null}
    </span>
  );
}
