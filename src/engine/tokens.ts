/**
 * Deciding what becomes a pill.
 *
 * A pill means: the registry knows what this is and can tell you about it.
 * Literals, operators and YAML keys never become pills. Each token carries its
 * column range so the editor can place a widget exactly over the source text
 * and take it away again when the cursor enters.
 */

import type { Evaluator } from './evaluate';
import { fmt } from './format';
import type { Graph } from './parse';
import {
  COLUMNS, DIMS, EXTERNAL, FUNCS, HUE, KEYWORDS, KIND_LABEL, LITERALS, PILL_KEYS,
  RESTRICTED, STATE_LABEL, type PillKind, type PillState,
} from './vocab';

const HUE_BY_KIND: Record<PillKind, string> = {
  measure: HUE.measure,
  dimension: HUE.dimension,
  func: HUE.func,
  column: HUE.column,
};

/** State overrides kind: a failed reference is red whatever it was going to be. */
export function pillHue(kind: PillKind, state: PillState): string {
  if (state === 'unresolved' || state === 'circular') return HUE.unresolved;
  if (state === 'deprecated') return HUE.warn;
  if (state === 'restricted') return HUE.column;
  return HUE_BY_KIND[kind];
}

export interface PillToken {
  /** Column offsets within the line. */
  from: number;
  to: number;
  /** Source text — the identifier as written. */
  name: string;
  /** What is rendered: `hidden` when the author lacks field access. */
  label: string;
  kind: PillKind;
  state: PillState;
  glyph: string;
  /** Closing bracket / deprecation mark. */
  post: string;
  /** SR 11-7 tier; the badge dot renders for 1 and 2 only. */
  tier: number;
  value: string;
  ariaLabel: string;
}

const IDENT_RE = /[A-Za-z_][A-Za-z0-9_]*/g;

export function classify(word: string, key: string | null, g: Graph): PillKind | null {
  if (word.toLowerCase() in KEYWORDS) return null;
  if (word in FUNCS) return 'func';
  if (g.byName[word] || EXTERNAL[word]) return 'measure';
  if (DIMS[word]) return 'dimension';
  if ((COLUMNS[g.view.source] || []).indexOf(word) >= 0) return 'column';
  if (word in LITERALS || /^\d/.test(word)) return null;
  // Inside a slot that must resolve, an unknown name is a failure worth showing.
  if (key === 'requires' || key === 'expression' || key === 'field' || key === 'weight') {
    return 'unresolved' as unknown as PillKind;
  }
  return null;
}

export interface PillStateOptions {
  /** Measure the state switcher is demonstrating on, and the state to force. */
  overrideName?: string;
  override?: PillState;
}

export function pillStateOf(
  name: string,
  kind: PillKind | 'unresolved',
  ev: Evaluator,
  opts: PillStateOptions = {},
): PillState {
  if (opts.override && opts.override !== 'resolved' && name === opts.overrideName) {
    return opts.override;
  }
  if (kind === 'unresolved') return 'unresolved';
  if (RESTRICTED[name]) return 'restricted';
  if (EXTERNAL[name] && EXTERNAL[name].deprecated) return 'deprecated';
  if (ev.value(name).cyclic) return 'circular';
  return 'resolved';
}

export function glyphFor(kind: PillKind, state: PillState): string {
  if (state === 'unresolved') return '?';
  if (state === 'circular') return '↻';
  if (state === 'restricted') return '⊠';
  if (kind === 'func') return 'ƒ';
  if (kind === 'dimension') return '▤';
  if (kind === 'column') return '·';
  return '⟨';
}

/** Pills on one line, in source order. */
export function tokenizeLine(
  lineIndex: number,
  g: Graph,
  ev: Evaluator,
  opts: PillStateOptions = {},
): PillToken[] {
  const raw = g.lines[lineIndex];
  const info = g.info[lineIndex];
  if (raw === undefined || !info || !info.key || !(info.key in PILL_KEYS)) return [];

  const body = raw.slice(info.valueFrom);
  const out: PillToken[] = [];

  IDENT_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = IDENT_RE.exec(body)) !== null) {
    const word = match[0];
    const kind = classify(word, info.key, g);
    if (!kind) continue;

    const state = pillStateOf(word, kind, ev, opts);
    const realKind: PillKind = (kind as string) === 'unresolved' ? 'measure' : kind;
    const glyph = glyphFor(realKind, state);
    const post =
      realKind === 'measure' && state !== 'unresolved' && state !== 'circular' && state !== 'restricted'
        ? '⟩'
        : state === 'deprecated'
          ? '⊘'
          : '';

    const m = g.byName[word];
    const tier = m ? parseInt(m.f.sr_11_7_tier || '0', 10) : 0;
    const v = ev.value(word);
    const valueText = fmt(v.v, v.format);

    out.push({
      from: info.valueFrom + match.index,
      to: info.valueFrom + match.index + word.length,
      name: word,
      label: state === 'restricted' ? 'restricted' : word,
      kind: realKind,
      state,
      glyph,
      post,
      tier,
      value: valueText,
      // §10 — the accessible name states type, tier, state and current value.
      ariaLabel:
        `${KIND_LABEL[realKind]} ${state === 'restricted' ? 'restricted' : word}, ` +
        `${tier ? `oversight level ${tier}, ` : ''}${STATE_LABEL[state]}` +
        `${state === 'resolved' ? `, currently ${valueText}` : ''}`,
    });
  }

  return out;
}
