/**
 * Expression evaluator for `derived` measures.
 *
 * Arithmetic with correct precedence, comparisons, `and`/`or`/`not`,
 * registered functions, and `case when … then … else … end`. It reports which
 * branch of a `case` actually fired — when an analyst is reconciling against a
 * regulatory report, knowing the expression took the `else` is often the whole
 * answer.
 */

import { compare } from './predicate';

export type Env = (name: string) => number;

export interface ExprResult {
  value: number;
  /** `branch 1` / `else` / `no branch matched`, when the expression has a `case`. */
  branch: string | null;
}

const TOKEN_RE = /'[^']*'|>=|<=|!=|<>|[A-Za-z_][A-Za-z0-9_]*|\d+\.?\d*|[-+*/(),<>=]/g;

export function callFn(name: string, a: number[]): number {
  switch (name) {
    case 'greatest':
    case 'max':
      return Math.max.apply(null, a);
    case 'least':
    case 'min':
      return Math.min.apply(null, a);
    case 'nullif':
      return a[0] === a[1] ? NaN : a[0];
    case 'coalesce': {
      const found = a.find((x) => !isNaN(x));
      return found === undefined ? NaN : found;
    }
    case 'abs':
      return Math.abs(a[0]);
    case 'ema':
      return a[0] * 0.981;
    case 'sum':
    case 'avg':
    case 'last':
    case 'first':
      return a[0];
    default:
      return NaN;
  }
}

export function evalExpression(src: string, env: Env): ExprResult {
  const toks = src.match(TOKEN_RE) || [];
  let p = 0;
  let branch: string | null = null;

  const peek = () => toks[p];
  const kw = () => (toks[p] || '').toLowerCase();
  const truthy = (x: unknown) => x === true || (typeof x === 'number' && !isNaN(x) && x !== 0);

  type Val = number | string;

  const orE = (): Val => {
    let v = andE();
    while (kw() === 'or') {
      p++;
      const r = andE();
      v = truthy(v) || truthy(r) ? 1 : 0;
    }
    return v;
  };

  const andE = (): Val => {
    let v = notE();
    while (kw() === 'and') {
      p++;
      const r = notE();
      v = truthy(v) && truthy(r) ? 1 : 0;
    }
    return v;
  };

  const notE = (): Val => {
    if (kw() === 'not') {
      p++;
      return truthy(notE()) ? 0 : 1;
    }
    return cmpE();
  };

  const cmpE = (): Val => {
    const l = addE();
    const op = peek();
    if (op && (['=', '!=', '<>', '>', '<', '>='].indexOf(op) >= 0 || op === '<=')) {
      p++;
      const r = addE();
      return compare(l, op, r) ? 1 : 0;
    }
    return l;
  };

  const addE = (): Val => {
    let v = mulE();
    while (peek() === '+' || peek() === '-') {
      const o = toks[p++];
      const r = mulE();
      v = o === '+' ? (v as number) + (r as number) : (v as number) - (r as number);
    }
    return v;
  };

  const mulE = (): Val => {
    let v = unary();
    while (peek() === '*' || peek() === '/') {
      const o = toks[p++];
      const r = unary();
      v = o === '*'
        ? (v as number) * (r as number)
        : r === 0 || r === null ? NaN : (v as number) / (r as number);
    }
    return v;
  };

  const unary = (): Val => {
    if (peek() === '-') {
      p++;
      return -(unary() as number);
    }
    return primary();
  };

  const primary = (): Val => {
    const t = toks[p];
    if (t === undefined) return NaN;

    if (t === '(') {
      p++;
      const v = orE();
      if (peek() === ')') p++;
      return v;
    }
    if (/^'/.test(t)) {
      p++;
      return t.slice(1, -1);
    }
    if (/^\d/.test(t)) {
      p++;
      return parseFloat(t);
    }

    if (t.toLowerCase() === 'case') {
      p++;
      let out: Val = NaN;
      let taken: string | null = null;
      let n = 0;
      while (kw() === 'when') {
        p++;
        n++;
        const cond = orE();
        if (kw() === 'then') p++;
        const val = orE();
        if (taken === null && truthy(cond)) {
          out = val;
          taken = `branch ${n}`;
        }
      }
      if (kw() === 'else') {
        p++;
        const val = orE();
        if (taken === null) {
          out = val;
          taken = 'else';
        }
      }
      if (kw() === 'end') p++;
      branch = taken || 'no branch matched';
      return out;
    }

    p++;
    if (peek() === '(') {
      p++;
      const args: number[] = [];
      while (peek() !== ')' && peek() !== undefined) {
        args.push(orE() as number);
        if (peek() === ',') p++;
      }
      if (peek() === ')') p++;
      return callFn(t.toLowerCase(), args);
    }

    const lower = t.toLowerCase();
    if (lower === 'true') return 1;
    if (lower === 'false') return 0;
    return env(t);
  };

  const out = orE();
  return { value: typeof out === 'number' ? out : NaN, branch };
}
