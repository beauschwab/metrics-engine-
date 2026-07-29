/**
 * `where:` is a real predicate, not a string that gets pasted into SQL.
 *
 * It parses to an AST first and the row-level closure is derived from that,
 * which is the whole architectural point: the same tree that decides a row in
 * the browser is what the compiler walks to emit SQL, Polars and PySpark. One
 * definition, one parse, several targets — with no second implementation to
 * drift against.
 *
 * When it cannot read the filter it says which part failed in plain words —
 * that message becomes KEEL052.
 */

import type { Row } from './fixtures';

export type Scalar = string | number | boolean | null;

/** The parsed shape of a predicate. Emitters and the evaluator both walk this. */
export type PredNode =
  | { t: 'and'; left: PredNode; right: PredNode }
  | { t: 'or'; left: PredNode; right: PredNode }
  | { t: 'not'; node: PredNode }
  | { t: 'cmp'; col: string; op: string; value: Scalar }
  | { t: 'in'; col: string; values: Scalar[] }
  | { t: 'null'; col: string; negated: boolean }
  /** An empty or unreadable predicate — matches everything. */
  | { t: 'always' };

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
  /** The parsed tree, for the compiler. `always` when the filter was empty. */
  ast: PredNode;
  empty?: boolean;
}

const TOKEN_RE = /'[^']*'|>=|<=|!=|<>|[<>=()]|[A-Za-z_][A-Za-z0-9_]*|-?\d+\.?\d*/g;
const COMPARISONS = ['=', '!=', '<>', '>', '<', '>='];

const OPERATOR_TOKENS: Record<string, true> = {
  '=': true, '!=': true, '<>': true, '>': true, '<': true, '>=': true, '<=': true,
};

const ALWAYS: PredNode = { t: 'always' };

export function parsePredicate(src: string): { ast: PredNode; err: string | null; cols: string[] } {
  const text = (src || '').replace(/\s+/g, ' ').trim();
  if (!text) return { ast: ALWAYS, err: null, cols: [] };

  const toks = text.match(TOKEN_RE) || [];
  let p = 0;
  let err: string | null = null;
  const cols: string[] = [];
  const kw = () => (toks[p] || '').toLowerCase();

  function orE(): PredNode {
    let v = andE();
    while (kw() === 'or') {
      p++;
      v = { t: 'or', left: v, right: andE() };
    }
    return v;
  }

  function andE(): PredNode {
    let v = notE();
    while (kw() === 'and') {
      p++;
      v = { t: 'and', left: v, right: notE() };
    }
    return v;
  }

  function notE(): PredNode {
    if (kw() === 'not') {
      p++;
      return { t: 'not', node: notE() };
    }
    return prim();
  }

  function prim(): PredNode {
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
      return ALWAYS;
    }
    if (/^[A-Za-z_]/.test(left)) cols.push(left);

    const op = toks[p++];
    if (op === undefined) {
      err = err || `nothing to compare “${left}” against`;
      return ALWAYS;
    }

    if (op.toLowerCase() === 'is') {
      let negated = false;
      if (kw() === 'not') {
        negated = true;
        p++;
      }
      p++; // consume `null`
      return { t: 'null', col: left, negated };
    }

    if (op.toLowerCase() === 'in') {
      const values: Scalar[] = [];
      if (toks[p] === '(') p++;
      while (toks[p] !== ')' && toks[p] !== undefined) {
        const v = literalOf(toks[p++]);
        if (v !== undefined) values.push(v);
      }
      if (toks[p] === ')') p++;
      else err = err || 'the value list is not closed';
      return { t: 'in', col: left, values };
    }

    if (COMPARISONS.indexOf(op) < 0 && op !== '<=') {
      err = err || `“${op}” is not a comparison`;
      return ALWAYS;
    }

    const raw = toks[p++];
    // An operator sitting where a value belongs is a typo, not a string. Without
    // this, `is_encumbered <<` silently compiles to `is_encumbered < '<'` and
    // the filter reads as valid while matching nothing meaningful.
    if (raw !== undefined && (OPERATOR_TOKENS[raw] || raw === '(' || raw === ')')) {
      err = err || `“${raw}” is not a value to compare “${left}” against`;
      return ALWAYS;
    }
    const value = literalOf(raw);
    if (value === undefined) {
      err = err || `no value after “${op}”`;
      return ALWAYS;
    }
    return { t: 'cmp', col: left, op, value };
  }

  const ast = orE();
  if (p < toks.length) err = err || `unexpected “${toks[p]}” at the end`;
  return { ast, err, cols };
}

/** Turn a parsed predicate into a row test. */
export function evalNode(node: PredNode, row: Row): boolean {
  switch (node.t) {
    case 'and':
      return evalNode(node.left, row) && evalNode(node.right, row);
    case 'or':
      return evalNode(node.left, row) || evalNode(node.right, row);
    case 'not':
      return !evalNode(node.node, row);
    case 'cmp':
      return compare(row[node.col], node.op, node.value);
    case 'in':
      return node.values.some((v) => compare(row[node.col], '=', v));
    case 'null':
      return (row[node.col] === null || row[node.col] === undefined) !== node.negated;
    default:
      return true;
  }
}

export function compilePredicate(src: string): CompiledPredicate {
  const { ast, err, cols } = parsePredicate(src);
  const empty = !(src || '').trim();

  // A filter we could not read must not silently drop rows — it fails open and
  // raises a diagnostic instead, so the number stays honest about being wrong.
  return {
    fn: err ? () => true : (row: Row) => evalNode(ast, row),
    err,
    cols,
    ast: err ? ALWAYS : ast,
    empty,
  };
}
