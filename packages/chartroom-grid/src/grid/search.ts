/**
 * The quick filter's grammar (ADR-73). A quick filter is still one string in
 * the view — `globalFilter`, unchanged since Phase 1 — but the string now
 * reads as tokens:
 *
 *   Credit                free text, matched against every column
 *   desk:Credit           a dimension contains the text (case-insensitive)
 *   desk=Credit           a dimension equals the text (case-insensitive)
 *   desk!=Credit          a dimension is anything else
 *   ccy:EUR               a column is named by its id or its label
 *   notional>1bn          a measure compared to a number, with k / m / bn
 *   yield>=3.5            or a plain number; a trailing % is dropped
 *   "front office"        quotes keep spaces together, in any position
 *
 * Every token must hold (AND). A token whose column the grid does not know
 * is free text, so a reader typing an odd word is not silently told there
 * is no such row. A known measure given something that is not a number is
 * *unknown*: it matches nothing and the filter bar shows it struck through,
 * because "notional > abc" has no honest answer.
 *
 * The same parse drives the client filter, the compiled SQL and the filter
 * bar, so the three never disagree on what a token means.
 */

import type { Row } from '@tanstack/table-core';
import { TREASURY_SCHEMA } from '../data/treasury';
import type { ColumnMeta } from './meta';
import type { GridSchema } from './schema';

export type SearchOp = ':' | '=' | '!=' | '>' | '>=' | '<' | '<=';

export interface SearchTerm {
  kind: 'term';
  column: string;
  op: SearchOp;
  /** A string for a dimension, a number for a measure. */
  value: string | number;
  /** The token as typed, so the bar can remove exactly it. */
  raw: string;
}

export interface SearchText {
  kind: 'text';
  value: string;
  raw: string;
}

export interface SearchUnknown {
  kind: 'unknown';
  column: string;
  raw: string;
  reason: string;
}

export type SearchToken = SearchTerm | SearchText | SearchUnknown;

export interface SearchQuery {
  tokens: SearchToken[];
  terms: SearchTerm[];
  text: SearchText[];
  unknown: SearchUnknown[];
}

const EMPTY: SearchQuery = { tokens: [], terms: [], text: [], unknown: [] };

/** Column ids and labels, lowercased and without spaces, to what they name — once per schema. */
const names = new WeakMap<GridSchema, ReadonlyMap<string, string>>();
function columnNames(schema: GridSchema): ReadonlyMap<string, string> {
  let m = names.get(schema);
  if (!m) {
    m = new Map(schema.order.flatMap((id) => [
      [id.toLowerCase(), id] as const,
      [(schema.columns[id]?.label ?? id).toLowerCase().replace(/\s+/g, ''), id] as const,
    ]));
    names.set(schema, m);
  }
  return m;
}

/** The column a token names, by id or label, or undefined. */
export function resolveSearchColumn(name: string, schema: GridSchema = TREASURY_SCHEMA): string | undefined {
  return columnNames(schema).get(name.toLowerCase().replace(/\s+/g, ''));
}

const OPS: SearchOp[] = ['!=', '>=', '<=', ':', '=', '>', '<'];
const SUFFIX: Record<string, number> = { k: 1e3, m: 1e6, mm: 1e6, b: 1e9, bn: 1e9, t: 1e12, tn: 1e12 };

/** `1.5bn`, `250m`, `-3`, `3.5%` → the number; anything else undefined. */
export function parseSearchNumber(text: string): number | undefined {
  const m = /^([-+]?\d[\d,]*(?:\.\d+)?|[-+]?\.\d+)\s*(k|mm?|bn?|tn?)?%?$/i.exec(text.trim());
  if (!m) return undefined;
  const n = Number(m[1]!.replace(/,/g, ''));
  if (!Number.isFinite(n)) return undefined;
  return n * (m[2] ? SUFFIX[m[2].toLowerCase()]! : 1);
}

/**
 * Split on whitespace, keeping quoted runs together: a token is a run of
 * unquoted characters and quoted strings, so `desk:"front office"` is one
 * token and `"two words"` another. The quotes stay in the raw token; the
 * parser strips them from the value.
 */
export function tokenizeSearch(input: string): string[] {
  return input.match(/(?:[^\s"']+|"[^"]*"?|'[^']*'?)+/g) ?? [];
}

const unquote = (s: string): string => (/^(["']).*\1$/.test(s) && s.length >= 2 ? s.slice(1, -1) : s);

function parseToken(raw: string, schema: GridSchema): SearchToken {
  const m = /^([A-Za-z_][\w ]*?)(!=|>=|<=|:|=|>|<)(.+)$/s.exec(raw);
  if (m) {
    const column = resolveSearchColumn(m[1]!, schema);
    const op = m[2] as SearchOp;
    const rest = unquote(m[3]!);
    if (column && OPS.includes(op)) {
      const meta = schema.columns[column] as ColumnMeta;
      if (meta.kind === 'dimension') {
        if (op === ':' || op === '=' || op === '!=') return { kind: 'term', column, op, value: rest, raw };
        return { kind: 'unknown', column, raw, reason: `${meta.label} is text; use :, = or !=` };
      }
      const n = parseSearchNumber(rest);
      if (n === undefined) return { kind: 'unknown', column, raw, reason: `${meta.label} needs a number` };
      return { kind: 'term', column, op: op === ':' ? '=' : op, value: n, raw };
    }
  }
  return { kind: 'text', value: unquote(raw), raw };
}

/** Parse the quick filter; an empty or blank string is the empty query. */
export function parseSearch(input: string, schema: GridSchema = TREASURY_SCHEMA): SearchQuery {
  if (input.trim() === '') return EMPTY;
  const tokens = tokenizeSearch(input).map((raw) => parseToken(raw, schema));
  return {
    tokens,
    terms: tokens.filter((t): t is SearchTerm => t.kind === 'term'),
    text: tokens.filter((t): t is SearchText => t.kind === 'text'),
    unknown: tokens.filter((t): t is SearchUnknown => t.kind === 'unknown'),
  };
}

/** The quick filter without one token, as the reader typed the rest. */
export function withoutSearchToken(input: string, raw: string): string {
  return tokenizeSearch(input).filter((t) => t !== raw).join(' ');
}

/** The quick filter with one more token, kept as the reader typed the rest. */
export function withSearchToken(input: string, raw: string): string {
  const tokens = tokenizeSearch(input);
  return [...tokens.filter((t) => t !== raw), raw].join(' ');
}

const fold = (v: unknown): string => (v === null || v === undefined ? '' : String(v).toLowerCase());

/** Whether a term holds for one cell value. */
export function termMatches(term: SearchTerm, value: unknown): boolean {
  if (typeof term.value === 'string') {
    const cell = fold(value);
    const want = term.value.toLowerCase();
    switch (term.op) {
      case ':': return cell.includes(want);
      case '=': return cell === want;
      case '!=': return cell !== want;
      default: return false;
    }
  }
  if (typeof value !== 'number' || Number.isNaN(value)) return false;
  switch (term.op) {
    case '=': return value === term.value;
    case '!=': return value !== term.value;
    case '>': return value > term.value;
    case '>=': return value >= term.value;
    case '<': return value < term.value;
    case '<=': return value <= term.value;
    default: return false;
  }
}

/**
 * Whether a row satisfies the whole query: every term on its column, every
 * free word somewhere in the row, and nothing unknown.
 */
export function rowMatchesSearch(query: SearchQuery, get: (id: string) => unknown, schema: GridSchema = TREASURY_SCHEMA): boolean {
  if (query.unknown.length > 0) return false;
  for (const term of query.terms) if (!termMatches(term, get(term.column))) return false;
  for (const word of query.text) {
    const want = word.value.toLowerCase();
    if (want === '') continue;
    let found = false;
    for (const id of schema.order) {
      if (fold(get(id)).includes(want)) { found = true; break; }
    }
    if (!found) return false;
  }
  return true;
}

/** One line for a term, the way the filter bar and the agent say it. */
export function describeSearchToken(token: SearchToken, schema: GridSchema = TREASURY_SCHEMA): string {
  if (token.kind === 'text') return `“${token.value}”`;
  const label = schema.columns[token.column]?.label ?? token.column;
  if (token.kind === 'unknown') return `${label}: ${token.raw} (${token.reason})`;
  const op = token.op === ':' ? 'contains' : token.op === '=' ? 'is' : token.op === '!=' ? 'is not' : token.op;
  return `${label} ${op} ${String(token.value)}`;
}

interface ResolvedSearch {
  input: string;
  /** The parse, once the table's columns are known: keyed by table. */
  parsed: WeakMap<object, { query: SearchQuery; schema: GridSchema }>;
  /** One verdict per row: the table asks once per globally filterable column. */
  memo: WeakMap<object, boolean>;
}

interface SearchTable { getAllLeafColumns(): ReadonlyArray<{ id: string; columnDef: { meta?: ColumnMeta } }> }

/** The schema a table's own columns describe — calculated and pivot columns included. */
const tableSchemas = new WeakMap<object, { key: string; schema: GridSchema }>();
function schemaOfTable(table: SearchTable): GridSchema {
  const cols = table.getAllLeafColumns().filter((c) => c.columnDef.meta);
  const key = cols.map((c) => c.id).join('|');
  const cached = tableSchemas.get(table);
  if (cached && cached.key === key) return cached.schema;
  const columns: Record<string, ColumnMeta> = {};
  for (const c of cols) columns[c.id] = c.columnDef.meta!;
  const schema: GridSchema = { columns, order: cols.map((c) => c.id), rowId: cols[0]?.id ?? '' };
  tableSchemas.set(table, { key, schema });
  return schema;
}

/**
 * The table's global filter. v9 runs the global filter once per column and
 * stops at the first column that says yes, so a row-level grammar answers
 * for the whole row on the first ask and remembers the verdict for the
 * other columns. The grammar reads the table's own columns, so a token can
 * name whatever the table shows. Registered as `search` in the registry.
 */
export const searchFilterFn = Object.assign(
  (row: Row<any, any>, _columnId: string, resolved: ResolvedSearch): boolean => {
    const known = resolved.memo.get(row);
    if (known !== undefined) return known;
    const table = row.table as unknown as SearchTable;
    let p = resolved.parsed.get(table);
    if (!p) {
      const schema = schemaOfTable(table);
      p = { query: parseSearch(resolved.input, schema), schema };
      resolved.parsed.set(table, p);
    }
    const verdict = rowMatchesSearch(p.query, (id) => row.getValue(id), p.schema);
    resolved.memo.set(row, verdict);
    return verdict;
  },
  {
    resolveFilterValue: (value: unknown): ResolvedSearch => ({
      input: typeof value === 'string' ? value : '',
      parsed: new WeakMap(),
      memo: new WeakMap(),
    }),
    autoRemove: (value: unknown) => typeof value !== 'string' || value.trim() === '',
  },
);
