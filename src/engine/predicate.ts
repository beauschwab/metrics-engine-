/**
 * `where:` is a real predicate, not a string that gets pasted into SQL.
 *
 * Recursive descent over `= != <> > < >= <=`, `in (…)`, `is [not] null`,
 * `and` / `or` / `not` and brackets. When it cannot read the filter it says
 * which part failed in plain words — that message becomes KEEL052.
 */

import type { Row } from './fixtures';

export type Scalar = string | number | boolean | null;

export function literalOf(t: string | undefined): Scalar | undefined {
  if (t === undefined) return undefined;
  if (/^'/.test(t)) return t.slice(1, -1);
  if (/^-?\d/.test(t)) return parseFloat(t);
  const l = t.toLowerCase();
  if (l === 'true') return true;
  if (l === 'false') return false;
  if (l === 'null') return null;
  return t;
}

export function compare(a: unknown, op: string, b: unknown): boolean {
  if (op === '=') return a === b || String(a) === String(b);
  if (op === '!=' || op === '<>') return !(a === b || String(a) === String(b));
  const x = Number(a);
  const y = Number(b);
  if (op === '>') return x > y;
  if (op === '<') return x < y;
  if (op === '>=') return x >= y;
  if (op === '<=') return x <= y;
  return false;
}

export interface CompiledPredicate {
  fn: (row: Row) => boolean;
  err: string | null;
  /** Identifiers read as columns — checked against the bound source for KEEL050. */
  cols: string[];
  empty?: boolean;
}

const TOKEN_RE = /'[^']*'|>=|<=|!=|<>|[<>=()]|[A-Za-z_][A-Za-z0-9_]*|-?\d+\.?\d*/g;
const COMPARISONS = ['=', '!=', '<>', '>', '<', '>='];

const OPERATOR_TOKENS: Record<string, true> = {
  '=': true, '!=': true, '<>': true, '>': true, '<': true, '>=': true, '<=': true,
};

export function compilePredicate(src: string): CompiledPredicate {
  const text = (src || '').replace(/\s+/g, ' ').trim();
  if (!text) return { fn: () => true, err: null, cols: [], empty: true };

  const toks = text.match(TOKEN_RE) || [];
  let p = 0;
  let err: string | null = null;
  const cols: string[] = [];
  const kw = () => (toks[p] || '').toLowerCase();

  type Pred = (row: Row) => boolean;

  function orE(): Pred {
    let v = andE();
    while (kw() === 'or') {
      p++;
      const r = andE();
      const a = v;
      v = (row) => a(row) || r(row);
    }
    return v;
  }

  function andE(): Pred {
    let v = notE();
    while (kw() === 'and') {
      p++;
      const r = notE();
      const a = v;
      v = (row) => a(row) && r(row);
    }
    return v;
  }

  function notE(): Pred {
    if (kw() === 'not') {
      p++;
      const r = notE();
      return (row) => !r(row);
    }
    return prim();
  }

  function prim(): Pred {
    if (toks[p] === '(') {
      p++;
      const v = orE();
      if (toks[p] === ')') p++;
      else err = err || 'a bracket is not closed';
      return v;
    }

    const left = toks[p++];
    if (left === undefined) {
      err = err || 'the filter ends before the condition does';
      return () => true;
    }
    if (/^[A-Za-z_]/.test(left)) cols.push(left);

    const op = toks[p++];
    if (op === undefined) {
      err = err || `nothing to compare “${left}” against`;
      return () => true;
    }

    if (op.toLowerCase() === 'is') {
      let neg = false;
      if (kw() === 'not') {
        neg = true;
        p++;
      }
      p++; // consume `null`
      return (row) => (row[left] === null || row[left] === undefined) !== neg;
    }

    if (op.toLowerCase() === 'in') {
      const list: Array<Scalar | undefined> = [];
      if (toks[p] === '(') p++;
      while (toks[p] !== ')' && toks[p] !== undefined) list.push(literalOf(toks[p++]));
      if (toks[p] === ')') p++;
      else err = err || 'the value list is not closed';
      return (row) => list.some((v) => compare(row[left], '=', v));
    }

    if (COMPARISONS.indexOf(op) < 0 && op !== '<=') {
      err = err || `“${op}” is not a comparison`;
      return () => true;
    }

    const raw = toks[p++];
    // An operator sitting where a value belongs is a typo, not a string. Without
    // this, `is_encumbered <<` silently compiles to `is_encumbered < '<'` and
    // the filter reads as valid while matching nothing meaningful.
    if (raw !== undefined && (OPERATOR_TOKENS[raw] || raw === '(' || raw === ')')) {
      err = err || `“${raw}” is not a value to compare “${left}” against`;
      return () => true;
    }
    const lit = literalOf(raw);
    if (lit === undefined) {
      err = err || `no value after “${op}”`;
      return () => true;
    }
    return (row) => compare(row[left], op, lit);
  }

  const fn = orE();
  if (p < toks.length) err = err || `unexpected “${toks[p]}” at the end`;

  // A filter we could not read must not silently drop rows — it fails open and
  // raises a diagnostic instead, so the number stays honest about being wrong.
  return { fn: err ? () => true : fn, err, cols };
}
