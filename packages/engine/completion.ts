/**
 * Context-aware completion.
 *
 * Completion is scoped to the YAML path the cursor sits in. Offering the wrong
 * vocabulary is worse than offering none — it teaches the author that the tool
 * does not understand the document.
 *
 * Two details carry disproportionate weight: `where:` offers the values
 * actually present in the test data, which kills the commonest silent error
 * (a predicate matching nothing); and `format:` renders a live sample of *this
 * measure's* number beside each option, so the choice needs no docs lookup.
 */

import type { Evaluator } from './evaluate';
import { distinctValues } from './fixtures';
import { fmt } from './format';
import { ownerAt, reqs, type Graph } from './parse';
import {
  COLUMNS, DIMS, ENUMS, ENUM_HELP, ENUM_LABEL, EXTERNAL, FUNCS, WINDOW_HELP,
  type FixtureName,
} from './vocab';

export type CandidateKind = 'measure' | 'func' | 'column' | 'dimension' | 'enum';

export interface Candidate {
  n: string;
  k: CandidateKind;
  /** Right-aligned hint: a live value, a sample, or plain-English help. */
  h?: string;
}

export interface CandidateSet {
  scope: string;
  list: Candidate[];
  word: string;
  /** Set when the line already holds a legal value — marked with a ✓. */
  current: string | null;
  key: string | null;
  /** True for closed-choice keys, where picking commits the line immediately. */
  isEnum: boolean;
}

const EMPTY: CandidateSet = { scope: '', list: [], word: '', current: null, key: null, isEnum: false };

const ENUM_KEYS = ['type', 'format', 'sr_11_7_tier', 'window.op', 'window.over'];

export function candidates(
  g: Graph,
  ev: Evaluator,
  fixture: FixtureName,
  lineIndex: number,
  textBefore: string,
): CandidateSet {
  const info = g.info[lineIndex];
  if (!info) return EMPTY;
  const key = info.key;
  if (!key) return EMPTY;

  const word = (textBefore.match(/[A-Za-z0-9_]+$/) || [''])[0];
  const owner = ownerAt(g, lineIndex);

  let pool: Candidate[] = [];
  let scope = '';
  let isEnum = false;

  if (key === 'requires') {
    pool = Object.keys(g.byName)
      .concat(Object.keys(EXTERNAL))
      // Cycle-aware by construction: a measure can never require itself, which
      // makes KEEL002 nearly unreachable rather than merely detectable.
      .filter((n) => !owner || n !== owner.name)
      .map((n) => ({ n, k: 'measure' as const }));
    scope = 'measures you can reference here';
  } else if (key === 'expression') {
    const rq = owner ? reqs(owner) : [];
    pool = ([] as Candidate[])
      .concat(rq.map((n) => ({ n, k: 'measure' })))
      .concat(Object.keys(FUNCS).map((n) => ({ n, k: 'func' })))
      .concat(['case', 'when', 'then', 'else', 'end'].map((n) => ({ n, k: 'enum', h: 'condition' })));
    scope = 'names from requires, functions, then case';
  } else if (key === 'field' || key === 'weight') {
    pool = (COLUMNS[g.view.source] || []).map((n) => ({ n, k: 'column' as const }));
    scope = `columns in ${g.view.source}`;
  } else if (key === 'where') {
    const cols = COLUMNS[g.view.source] || [];
    const val = /([a-z_0-9]+)\s*(=|!=|<>|>=|<=|>|<)\s*'?[A-Za-z0-9_]*$/.exec(textBefore);
    const opAfter = /([a-z_0-9]+)\s+$/.exec(textBefore);

    if (val && cols.indexOf(val[1]) >= 0) {
      pool = distinctValues(fixture, g.view.source, val[1]).map((n) => ({
        n, k: 'enum' as const, h: 'found in the data',
      }));
      scope = `values of ${val[1]} in this test data`;
      if (!pool.length) {
        pool = cols.map((n) => ({ n, k: 'column' as const }));
        scope = `columns in ${g.view.source}`;
      }
    } else if (opAfter && cols.indexOf(opAfter[1]) >= 0) {
      pool = ['=', '!=', '>', '<', '>=', '<=', 'in', 'is null'].map((n) => ({
        n, k: 'enum' as const, h: 'comparison',
      }));
      scope = `how to compare ${opAfter[1]}`;
    } else {
      pool = (cols.map((n) => ({ n, k: 'column' as const })) as Candidate[]).concat(
        ['and', 'or', 'not'].map((n) => ({ n, k: 'enum' as const, h: 'joins conditions' })),
      );
      scope = 'columns, then and / or';
    }
  } else if (key === 'agg') {
    pool = ENUMS.agg.map((n) => ({ n, k: 'func' as const, h: ENUM_HELP[n] }));
    scope = 'how rows are combined';
    isEnum = true;
  } else if (key === 'type' || ENUM_KEYS.indexOf(key) >= 0) {
    // `type:` means two different things depending on where it sits.
    const set = key === 'type' && !info.inMeasure ? 'grain_type' : key;
    pool = ENUMS[set].map((n) => ({
      n,
      k: 'enum' as const,
      h: key === 'format' && owner
        ? fmt(ev.value(owner.name).v, n)
        : set === 'window.op'
          ? WINDOW_HELP[n]
          : set === 'window.over'
            ? `trailing ${parseInt(n, 10)} days`
            : ENUM_HELP[n],
    }));
    scope = `${ENUM_LABEL[set]} — pick one`;
    isEnum = true;
  } else if (
    key === 'partition_by' || key === 'order_by' ||
    key === 'window.partition_by' || key === 'window.order_by'
  ) {
    pool = (Object.keys(DIMS).map((n) => ({ n, k: 'dimension' as const })) as Candidate[]).concat(
      (COLUMNS[g.view.source] || []).map((n) => ({ n, k: 'column' as const })),
    );
    scope = 'groupings — time first';
  } else {
    return EMPTY;
  }

  const inPool = pool.some((p) => p.n === word);

  // When the line already holds a legal value, show the whole list rather than
  // the accidental prefix siblings — `currency_usd` must not hide behind
  // `currency_usd_mm` just because one is a prefix of the other.
  if (!word || inPool) {
    return { scope, list: pool.slice(0, 8), word, current: inPool ? word : null, key, isEnum };
  }

  let list = pool.filter((p) => p.n.indexOf(word) === 0 && p.n !== word);
  if (!list.length) list = pool;
  return { scope, list: list.slice(0, 8), word, current: null, key, isEnum };
}

/**
 * Ghost text: a single high-confidence candidate, accepted with Tab.
 * Never inside `expression` — predicting arithmetic invites an author to accept
 * a formula they did not reason about, which is the failure this tool exists
 * to prevent.
 */
export function ghostFor(c: CandidateSet): string {
  if (!c.word || c.current || c.key === 'expression' || c.key === 'where') return '';
  if (c.list.length !== 1) return '';
  const only = c.list[0].n;
  return only.indexOf(c.word) === 0 ? only.slice(c.word.length) : '';
}
