/**
 * Form mode — the same document, edited through controls instead of text.
 *
 * The governing constraint is that there is **no parallel model**. Every control
 * writes back into the same YAML lines the editor shows, so validation,
 * evaluation, the derivation trace and the blast radius all run off one engine
 * and cannot disagree with each other. A user can build a rule in the form, flip
 * to YAML, and read exactly what they produced.
 *
 * That is why this file is a set of *document operations* rather than a state
 * container. Nothing here holds a draft of a measure; each function takes lines
 * and returns lines. The alternative — a form model that syncs back on save —
 * is the design where the two views drift, and drift between an author's mental
 * model and the filed artifact is the failure this whole surface exists to
 * prevent.
 *
 * Three things in here are load-bearing and easy to get wrong:
 *
 * **The line prefix.** A measure's first line is `  - name: hqla_total`. Writing
 * it back with only the leading whitespace preserved drops the `- `, which
 * deletes the measure from the parsed document and causes its remaining fields
 * to be absorbed by the measure above it. `parse.ts` already spells the prefix
 * correctly and `diagnostics.ts` already writes lines through it; this file
 * reuses both rather than spelling a fourth regex.
 *
 * **A filter that cannot be represented is not rewritten.** A `where` clause
 * with parentheses, `in`, `not` or `is null` has no faithful row form. It is
 * shown read-only with a pointer to YAML. Round-tripping it through a lossy
 * model would silently change what a rule counts.
 *
 * **Dropping a measure into a formula also adds it to the dependency list**, in
 * one transaction, so `KEEL005` — used in the expression but missing from
 * `requires` — cannot be constructed by the form at all.
 */

import { applyFix, type Diagnostic } from './diagnostics';
import { AS_OF, TABLES, type Row } from './fixtures';
import { fmt } from './format';
import { parse, type Graph, type Measure } from './parse';
import { FUNCS, KEYWORDS, WINDOW_HELP, type FixtureName } from './vocab';

// ---------------------------------------------------------------------------
// What a measure is, in the user's words
// ---------------------------------------------------------------------------

export type MeasureKind = 'simple' | 'derived' | 'windowed';

/**
 * The badge and the choice cards. `type:` is the engine's word; these are the
 * user's, and the mapping is the whole reason form mode is legible to somebody
 * who does not read YAML.
 */
export const KIND_LABEL: Record<MeasureKind, string> = {
  simple: 'Reads a column',
  derived: 'Combines measures',
  windowed: 'Looks across dates',
};

export const KIND_CHOICE: Record<MeasureKind, { title: string; help: string }> = {
  simple: { title: 'Read a column', help: 'reads one column' },
  derived: { title: 'Combine measures', help: 'combines other measures' },
  windowed: { title: 'Look across dates', help: 'looks across dates' },
};

export const KINDS: MeasureKind[] = ['simple', 'derived', 'windowed'];

/** `sum` reads as "adds up" in a sentence and "adds every row" in a hint. */
const AGG_VERB: Record<string, string> = {
  sum: 'Adds up',
  avg: 'Averages',
  last: 'Takes the latest',
  first: 'Takes the earliest',
  max: 'Takes the largest',
  min: 'Takes the smallest',
  count: 'Counts the rows of',
};

export function kindOf(m: Measure): MeasureKind {
  const t = (m.f.type || '').trim();
  return t === 'derived' || t === 'windowed' ? t : 'simple';
}

export function requiresOf(m: Measure): string[] {
  return (m.f.requires || '')
    .replace(/[[\]]/g, '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * The rule, restated as a sentence, with its current value.
 *
 * It rewrites itself on every edit, which is what makes the form self-checking:
 * a user who reads "Adds up hqla_eligible_amount, across every row" and expected
 * a filter has found their own mistake without running anything.
 */
export function sentenceFor(m: Measure, value: number, format?: string): string {
  const shown = fmt(value, format ?? (m.f.format || '').trim());
  const kind = kindOf(m);

  if (kind === 'simple') {
    const verb = AGG_VERB[(m.f.agg || 'sum').trim()] || 'Adds up';
    const field = (m.f.field || '?').trim();
    const where = (m.f.where || '').trim();
    // No pill glyphs here: this is prose, and a leading `·` on a column name
    // reads as a typo rather than as a taxonomy.
    const clause = where ? `, counting only rows where ${where}` : ', across every row';
    return `${verb} ${field}${clause}. Shown as ${shown}.`;
  }

  if (kind === 'windowed') {
    const op = (m.f['window.op'] || '').trim();
    const over = (m.f['window.over'] || '1d').trim();
    const input = requiresOf(m)[0] || '?';
    return `Takes the ${WINDOW_HELP[op] || 'calculation'} of ⟨${input}⟩, `
      + `over the trailing ${over}. Currently ${shown}.`;
  }

  const n = requiresOf(m).length;
  return `Combines ${n} other ${n === 1 ? 'measure' : 'measures'} — currently ${shown}.`;
}

// ---------------------------------------------------------------------------
// Filters
// ---------------------------------------------------------------------------

export interface ConditionRow {
  /** `and` / `or`, empty on the first row. */
  join: string;
  col: string;
  op: string;
  val: string;
}

export interface FilterModel {
  rows: ConditionRow[];
  /**
   * True when the clause cannot be represented as rows. The raw text is shown
   * read-only rather than approximated — a filter the form rewrote into
   * something simpler would change what the measure counts, silently.
   */
  advanced: boolean;
  raw: string;
}

export const COMPARISONS = ['=', '!=', '>', '<', '>=', '<='];

const CONDITION_RE = /^([A-Za-z_][A-Za-z0-9_]*)\s*(>=|<=|!=|<>|=|>|<)\s*(.+)$/;
const NOT_FLAT = /[()]|\bnot\b|\bin\b|is\s+not?\s*null/i;

/** A `where` clause as rows, when it is a flat AND/OR chain and only then. */
export function filterRows(where: string): FilterModel {
  const text = (where || '').trim();
  if (!text) return { rows: [], advanced: false, raw: '' };
  if (NOT_FLAT.test(text)) return { rows: [], advanced: true, raw: text };

  const parts = text.split(/\s+(and|or)\s+/i);
  const rows: ConditionRow[] = [];
  for (let i = 0; i < parts.length; i += 2) {
    const hit = CONDITION_RE.exec(parts[i].trim());
    if (!hit) return { rows: [], advanced: true, raw: text };
    rows.push({
      join: i ? parts[i - 1].toLowerCase() : '',
      col: hit[1],
      op: hit[2],
      val: hit[3].trim(),
    });
  }
  return { rows, advanced: false, raw: text };
}

/** Rows back to a clause. Empty rows mean the key is removed, not blanked. */
export function writeWhere(rows: ConditionRow[]): string | null {
  if (!rows.length) return null;
  const parts: string[] = [];
  rows.forEach((r, i) => {
    if (i) parts.push(r.join || 'and');
    parts.push(`${r.col} ${r.op} ${r.val}`);
  });
  return parts.join(' ');
}

/**
 * The distinct values a column actually holds in the bound test data.
 *
 * This is the point of the condition builder rather than a nicety. The most
 * common silent error in metric authoring is a predicate that matches nothing —
 * `segment = 'Retail'` against a book that says `RETAIL` — and it produces a
 * confident zero rather than an error. Offering only observed values makes that
 * class of mistake unconstructible.
 *
 * Numeric columns are deliberately excluded: a hundred distinct balances is not
 * a menu, and `> 1000000` is the shape of a numeric filter anyway.
 */
export function observedValues(
  fixture: FixtureName,
  source: string,
  column: string,
  limit = 40,
): string[] {
  const rows: Row[] = TABLES[fixture]?.[source]?.[AS_OF] || [];
  if (!rows.length) return [];

  const seen = new Set<string>();
  for (const row of rows) {
    const v = row[column];
    if (v === null || v === undefined || v === '') continue;
    if (typeof v === 'number') return [];
    seen.add(typeof v === 'boolean' ? String(v) : String(v));
    if (seen.size > limit) return [];
  }
  // Quoted the way the predicate compiler expects, so a value picked from the
  // menu is a value the compiler can read back.
  return [...seen].sort().map((v) => (v === 'true' || v === 'false' ? v : `'${v}'`));
}

// ---------------------------------------------------------------------------
// Formulas
// ---------------------------------------------------------------------------

export type TokenClass = 'measure' | 'function' | 'keyword' | 'plain';

const TOKEN_RE = /'[^']*'|>=|<=|!=|<>|[A-Za-z_][A-Za-z0-9_]*|\d+\.?\d*|[-+*/(),<>=]/g;

export function formulaTokens(expression: string): string[] {
  return (expression || '').trim().match(TOKEN_RE) || [];
}

export function tokenClass(token: string, known: (name: string) => boolean): TokenClass {
  if (known(token)) return 'measure';
  if (token in FUNCS) return 'function';
  if (KEYWORDS[token.toLowerCase()]) return 'keyword';
  return 'plain';
}

/** How a token reads on a chip — the glyph carries the class without colour. */
export function tokenText(token: string, known: (name: string) => boolean): string {
  const cls = tokenClass(token, known);
  if (cls === 'measure') return `⟨${token}⟩`;
  if (cls === 'function') return `ƒ${token}`;
  return token;
}

export const PALETTE: Array<{ label: string; items: string[] }> = [
  { label: 'Arithmetic', items: ['+', '-', '*', '/', '(', ')', ','] },
  { label: 'Conditions', items: ['case', 'when', 'then', 'else', 'end', '>', '<', '='] },
  { label: 'Functions', items: ['greatest', 'least', 'nullif', 'coalesce', 'abs'] },
];

/**
 * Tokens back to an expression, with the spacing a reader expects.
 *
 * Built token by token rather than joined-then-patched. A join with regex
 * fix-ups gets `nullif (a, 0)` — a space between a function and its arguments —
 * because "no space before `(`" and "space before `(`" are both right depending
 * on what precedes it: a function call closes up, `and (a > 1)` does not.
 * Encoding that as a rule is shorter than the two regexes it replaces and it is
 * the only version that round-trips an expression unchanged.
 */
export function writeFormula(tokens: string[]): string {
  let out = '';
  tokens.forEach((token, i) => {
    if (i === 0) {
      out += token;
      return;
    }
    const prev = tokens[i - 1];
    const tight =
      token === ',' || token === ')'
      || prev === '('
      // A function call closes up; a bracket after a keyword or operator does not.
      || (token === '(' && /^[A-Za-z_][A-Za-z0-9_]*$/.test(prev) && !KEYWORDS[prev.toLowerCase()]);
    out += tight ? token : ` ${token}`;
  });
  return out.trim();
}

// ---------------------------------------------------------------------------
// Document operations
// ---------------------------------------------------------------------------

/**
 * Where a new key goes: after the measure's last existing field line.
 *
 * Appending at the end of the block rather than in a sorted position keeps a
 * document's field order stable across edits, which is what makes a YAML diff
 * of a form edit readable.
 */
function lastLineOf(m: Measure, lines: string[]): number {
  let at = m.line;
  Object.values(m.lineOf).forEach((l) => {
    if (typeof l === 'number' && l > at) at = l;
  });
  // Block scalars run past the key line; walk to the end of the continuation.
  while (at + 1 < lines.length) {
    const next = lines[at + 1];
    if (!next.trim()) break;
    if (/^\s*(?:-\s*)?[a-z_0-9.]+:/.test(next)) break;
    at++;
  }
  return at;
}

/**
 * Set, or remove, one scalar field on one measure.
 *
 * `null` removes the key rather than writing an empty string — an empty
 * `description:` satisfies nothing and reads as an answered question.
 */
export function setField(
  lines: string[],
  measure: string,
  key: string,
  value: string | null,
): string[] {
  const g = parse(lines);
  const m = g.byName[measure];
  if (!m) return lines;

  const at = m.lineOf[key];
  if (at !== undefined) {
    if (value === null) {
      const next = lines.slice();
      next.splice(at, 1);
      return next;
    }
    // Through the existing writer, which already preserves the `- ` prefix.
    return applyFix(lines, { kind: 'setValue', line: at, value }, g);
  }

  if (value === null) return lines;
  return applyFix(
    lines,
    { kind: 'insertAfter', line: lastLineOf(m, lines), lines: [`    ${key}: ${value}`] },
    g,
  );
}

/**
 * Replace a measure's `expression:` block scalar.
 *
 * A block scalar is a header line plus every indented line under it, so
 * replacing it means replacing all of them. Writing only the header leaves the
 * previous body in place and the measure silently keeps computing the old
 * formula underneath a new one.
 */
export function setExpression(lines: string[], measure: string, text: string): string[] {
  const g = parse(lines);
  const m = g.byName[measure];
  if (!m) return lines;

  const next = lines.slice();
  const head = m.lineOf.expression;

  if (head === undefined) {
    next.splice(lastLineOf(m, lines) + 1, 0, '    expression: >', `      ${text}`);
    return next;
  }

  let n = 0;
  while (head + 1 + n < next.length) {
    const line = next[head + 1 + n];
    if (!line.trim()) break;
    if (/^\s{0,5}\S/.test(line)) break;
    if (/^\s*(?:-\s*)?[a-z_0-9.]+:/.test(line)) break;
    n++;
  }
  next.splice(head, 1 + n, '    expression: >', `      ${text}`);
  return next;
}

/**
 * Rename a measure and every reference to it, in one transaction.
 *
 * Step two is the one that matters. A rename that rewrites only the `name:`
 * line leaves every downstream `requires:` and every formula pointing at a
 * measure that no longer exists — the document still parses, the surface still
 * renders, and a set of measures has quietly stopped computing. The references
 * are rewritten inside the *other* measures' blocks only, so a substring of an
 * unrelated identifier is never touched.
 */
export function renameMeasure(lines: string[], from: string, to: string): string[] {
  if (!to || from === to) return lines;
  const g = parse(lines);
  if (!g.byName[from]) return lines;

  const next = lines.slice();
  const re = new RegExp(`\\b${from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'g');

  g.measures.forEach((other) => {
    if (other.name === from) return;
    (['requires', 'expression'] as const).forEach((key) => {
      const at = other.lineOf[key];
      if (at === undefined) return;
      for (let i = at; i < next.length; i++) {
        if (i > at && (!next[i].trim() || /^\s*(?:-\s*)?[a-z_0-9.]+:/.test(next[i]))) break;
        next[i] = next[i].replace(re, to);
      }
    });
  });

  const nameLine = g.byName[from].lineOf.name;
  if (nameLine === undefined) return next;
  next[nameLine] = next[nameLine].replace(/^(\s*(?:-\s*)?name:).*$/, `$1 ${to}`);
  return next;
}

/** Set `requires:` from a list, removing the key when the list empties. */
export function setRequires(lines: string[], measure: string, names: string[]): string[] {
  return setField(lines, measure, 'requires', names.length ? `[${names.join(', ')}]` : null);
}

/**
 * Add a token to a formula — and, when it is a measure, to `requires` too.
 *
 * One transaction, deliberately. `KEEL005` ("used in the formula but missing
 * from its dependency list") is a real and common mistake in the text editor;
 * doing both halves here means the form cannot construct it.
 */
export function appendToFormula(
  lines: string[],
  measure: string,
  token: string,
  isMeasure: boolean,
): string[] {
  const g = parse(lines);
  const m = g.byName[measure];
  if (!m) return lines;

  const tokens = [...formulaTokens(m.f.expression || ''), token];
  let next = setExpression(lines, measure, writeFormula(tokens));

  if (isMeasure) {
    const reqs = requiresOf(m);
    if (!reqs.includes(token)) next = setRequires(next, measure, [...reqs, token]);
  }
  return next;
}

// ---------------------------------------------------------------------------
// Routing diagnostics to fields
// ---------------------------------------------------------------------------

/**
 * Which control a diagnostic belongs beside.
 *
 * Validation is a persistent property of the document, so it belongs *attached
 * to the thing that is wrong* rather than in a banner at the top of the card. A
 * banner makes the reader hunt; a note under the field is the answer in the
 * place the question was asked.
 */
export const FIELD_OF_CODE: Record<string, string> = {
  KEEL001: 'expression',
  KEEL002: 'requires',
  KEEL004: 'field',
  KEEL005: 'expression',
  KEEL006: 'requires',
  KEEL007: 'expression',
  KEEL021: 'expression',
  KEEL025: 'window.op',
  KEEL026: 'window.over',
  KEEL027: 'requires',
  KEEL030: 'description',
  KEEL031: 'citation',
  KEEL035: 'expression',
  KEEL041: 'name',
  KEEL042: 'format',
  KEEL050: 'where',
  KEEL051: 'where',
  KEEL052: 'where',
};

/** Every field key the form renders a control for, in card order. */
export const FORM_FIELDS = [
  'name', 'label', 'description',
  'type', 'agg', 'field', 'where', 'expression', 'requires',
  'window.op', 'window.over',
  'format', 'sr_11_7_tier', 'citation',
];

export interface RoutedDiagnostics {
  /** Field key → the notes that belong under it. */
  byField: Record<string, Diagnostic[]>;
  /**
   * Everything that could not be placed. Rendered in a short list at the
   * *bottom* of the card — visible, but not competing with the fields for the
   * top of the reader's attention.
   */
  unrouted: Diagnostic[];
}

/**
 * Route this measure's diagnostics to fields.
 *
 * The code table places most of them. Anything left over falls back to the
 * measure's own field-to-line map, which catches codes this table has not heard
 * of — including any added after it was written, which is the failure mode a
 * hardcoded table has.
 */
export function routeDiagnostics(
  diagnostics: Diagnostic[],
  m: Measure,
  blockEnd: number,
): RoutedDiagnostics {
  const byField: Record<string, Diagnostic[]> = {};
  const unrouted: Diagnostic[] = [];

  const lineToField = new Map<number, string>();
  Object.entries(m.lineOf).forEach(([key, line]) => {
    if (typeof line === 'number') lineToField.set(line, key);
  });

  diagnostics
    .filter((d) => d.line >= m.line && d.line < blockEnd)
    .forEach((d) => {
      const field = FIELD_OF_CODE[d.code] ?? lineToField.get(d.line);
      if (field && FORM_FIELDS.includes(field)) {
        (byField[field] ||= []).push(d);
      } else {
        unrouted.push(d);
      }
    });

  return { byField, unrouted };
}

/** The line a measure's block ends at, for scoping its diagnostics. */
export function blockEndOf(g: Graph, index: number): number {
  return index + 1 < g.measures.length ? g.measures[index + 1].line : g.lines.length;
}
