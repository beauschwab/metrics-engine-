/**
 * Source bindings — the same rule, over differently-shaped client tables.
 *
 * The rules are written once, against canonical names: `balance_usd`,
 * `segment`, `is_secured`. A client system rarely has those. Murex calls the
 * balance `BAL_AMT_USD` and spells the segment `RTL`; a data-vault warehouse
 * has neither name anywhere. The naive fix — rewrite the compiled plan per
 * system — produces N variant plans, which is N things to keep conformant, and
 * the entire point of the compiler is that there is one.
 *
 * So a binding does the opposite: it generates an **adapter view** that
 * presents the client's table under the canonical names, and the canonical
 * plan runs on top, byte-identical everywhere. The mapping is a governed
 * artifact like any other — `kind: source_binding`, revisioned, releasable —
 * because a wrong mapping changes what a number means exactly as much as a
 * wrong rule does.
 *
 * Two kinds of difference are handled, because both are real:
 *
 * **Names.** `BAL_AMT_USD → balance_usd`. A rename in the view.
 *
 * **Vocabularies.** The client says `RTL` where the rules say `RETAIL`. A
 * `map:` on the column becomes a CASE in the adapter — with **no ELSE
 * fallthrough of the raw value**: an unmapped client code arrives as NULL, so
 * it lands in classification coverage as unmapped rather than silently failing
 * every rule while looking like data.
 *
 * `checkBinding` is the part that makes this safe to serve: an adapter that
 * misses a column the rules read, or maps a vocabulary that can never produce
 * a value some rule tests for, is refused with the list — not emitted and left
 * to fail at 2am in the client's pipeline.
 */

import { compilePredicate, type PredNode, type Scalar } from './predicate';
import { sectionBlocks, type Graph } from './parse';
import { resolveClassification, type Registry } from './registry';
import { derivationsFor } from './rows';

export interface ColumnBinding {
  /** The name the rules use. */
  canonical: string;
  /** The name the client system has. */
  column: string;
  /** Client value → canonical value, when the vocabularies differ too. */
  map: Record<string, string> | null;
  note: string;
}

export interface BindingSpec {
  name: string;
  displayName: string;
  /** The canonical source table this stands in for. */
  binds: string;
  /** The client-side table the adapter reads. */
  table: string;
  columns: ColumnBinding[];
}

export interface BindingIssue {
  sev: 'error' | 'warn' | 'info';
  message: string;
}

/** `{RTL: RETAIL, WSL: WHOLESALE}` — inline flow-map syntax, nothing more. */
function parseMap(raw: string): Record<string, string> | null {
  const text = (raw || '').trim();
  if (!text) return null;
  const inner = /^\{(.*)\}$/.exec(text);
  if (!inner) return null;
  const out: Record<string, string> = {};
  inner[1].split(',').forEach((pair) => {
    const [k, v] = pair.split(':').map((x) => x.trim().replace(/^['"]|['"]$/g, ''));
    if (k && v) out[k] = v;
  });
  return Object.keys(out).length ? out : null;
}

export function readBinding(g: Graph): BindingSpec {
  return {
    name: g.docName,
    displayName: (g.view.display_name || '').trim(),
    binds: (g.view.binds || '').trim(),
    table: (g.view.table || '').trim(),
    columns: sectionBlocks(g, 'columns').map((b) => ({
      canonical: b.name,
      column: (b.f.column || '').trim(),
      map: parseMap(b.f.map || ''),
      note: (b.f.note || '').trim(),
    })),
  };
}

// ---------------------------------------------------------------------------
// What the rules actually read
// ---------------------------------------------------------------------------

function predicateCols(when: string): string[] {
  const p = compilePredicate(when);
  return p.err || p.empty ? [] : p.cols;
}

/** String literals a predicate compares a column against, per column. */
function literalsByColumn(ast: PredNode, into: Record<string, Set<string>>): void {
  const add = (col: string, v: Scalar) => {
    if (typeof v === 'string') (into[col] ||= new Set()).add(v);
  };
  switch (ast.t) {
    case 'and':
    case 'or':
      literalsByColumn(ast.left, into);
      literalsByColumn(ast.right, into);
      return;
    case 'not':
      literalsByColumn(ast.node, into);
      return;
    case 'cmp':
      add(ast.col, ast.value);
      return;
    case 'in':
      ast.values.forEach((v) => add(ast.col, v));
      return;
    default:
  }
}

export interface SourceUsage {
  /** Source columns the view, its rules and its measures actually read. */
  needed: string[];
  /** Column → canonical string values some rule or filter tests for. */
  literals: Record<string, string[]>;
}

/**
 * The source columns a view genuinely depends on.
 *
 * Derived columns are excluded: `product_id` is computed by the
 * classification, so no client table needs to provide it. Getting this wrong
 * in either direction makes the completeness check useless — too wide and
 * every binding fails, too narrow and a broken one passes.
 */
export function sourceUsage(
  view: Graph,
  registry: Registry,
  asOf: string,
  /**
   * Columns the consuming report additionally reads — its grouping keys. The
   * view itself never touches `currency` or `entity_id`, but the compiled plan
   * SELECTs them straight off the source, so an adapter that skips them fails
   * on the first run. This parameter is why the check is done per report.
   */
  alsoReads: string[] = [],
): SourceUsage {
  const derived = new Set<string>();
  const needed = new Set<string>();
  const literalSets: Record<string, Set<string>> = {};

  const derivations = derivationsFor(view, registry, asOf);
  derivations.forEach((d) => derived.add(d.name));

  const take = (col: string) => {
    if (col && !derived.has(col)) needed.add(col);
  };
  const takeWhere = (when: string) => {
    predicateCols(when).forEach(take);
    const p = compilePredicate(when);
    if (!p.err && !p.empty) {
      const sets: Record<string, Set<string>> = {};
      literalsByColumn(p.ast, sets);
      Object.entries(sets).forEach(([col, vals]) => {
        if (derived.has(col)) return;
        vals.forEach((v) => (literalSets[col] ||= new Set()).add(v));
      });
    }
  };

  derivations.forEach((d) => {
    take(d.field);
    take(d.anchor);
    d.keys.forEach((k) => {
      if (!derived.has(k)) needed.add(k);
    });
    if (d.op === 'classify' && d.using) {
      const c = resolveClassification(registry, d.using, asOf);
      c?.rules.forEach((r) => takeWhere(r.when));
      if (c?.notional) take(c.notional);
    }
    if (d.op === 'expr' && d.expression) {
      // Row arithmetic references columns bare; anything not derived is source.
      (d.expression.match(/[A-Za-z_][A-Za-z0-9_]*/g) || []).forEach(take);
    }
  });

  sectionBlocks(view, 'measures').forEach((m) => {
    take((m.f.field || '').trim());
    if (m.f.where) takeWhere(m.f.where);
  });

  alsoReads.forEach(take);

  const asOfField = (view.view['grain.as_of_field'] || 'as_of_date').trim();
  needed.add(asOfField);

  return {
    needed: [...needed].sort(),
    literals: Object.fromEntries(
      Object.entries(literalSets).map(([k, v]) => [k, [...v].sort()]),
    ),
  };
}

// ---------------------------------------------------------------------------
// The completeness check
// ---------------------------------------------------------------------------

/**
 * Whether this binding can faithfully stand in for the canonical source.
 *
 * Errors here refuse the adapter. Serving one that misses a needed column
 * fails loudly in the client's engine, which is survivable; serving one whose
 * vocabulary map can never produce `'SMALL_BUSINESS'` fails *silently* — the
 * rule that tests for it simply never fires, on this one system, forever.
 * That second failure is the reason this function exists.
 */
export function checkBinding(
  binding: BindingSpec,
  usage: SourceUsage,
): BindingIssue[] {
  const issues: BindingIssue[] = [];
  const byCanonical = new Map(binding.columns.map((c) => [c.canonical, c]));

  if (!binding.table) issues.push({ sev: 'error', message: 'the binding names no client table' });
  if (!binding.binds) issues.push({ sev: 'error', message: 'the binding names no canonical source it stands in for' });

  usage.needed.forEach((col) => {
    const bound = byCanonical.get(col);
    if (!bound || !bound.column) {
      issues.push({
        sev: 'error',
        message: `the rules read ${col}, and this binding does not map it`,
      });
    }
  });

  binding.columns.forEach((c) => {
    if (!usage.needed.includes(c.canonical)) {
      issues.push({
        sev: 'info',
        message: `${c.canonical} is mapped but nothing reads it`,
      });
    }
  });

  // A vocabulary that cannot produce a value the rules test for.
  Object.entries(usage.literals).forEach(([col, values]) => {
    const bound = byCanonical.get(col);
    if (!bound?.map) return;
    const produced = new Set(Object.values(bound.map));
    values.forEach((v) => {
      if (!produced.has(v)) {
        issues.push({
          sev: 'error',
          message: `the rules test ${col} = '${v}', and no client value maps to it — `
            + `that rule can never fire on ${binding.name}`,
        });
      }
    });
  });

  return issues;
}

// ---------------------------------------------------------------------------
// The adapter
// ---------------------------------------------------------------------------

const q = (s: string) => `'${s.replace(/'/g, "''")}'`;

/**
 * The adapter view: the client table, presented under canonical names.
 *
 * `ELSE NULL` on a mapped vocabulary is deliberate. Passing the raw client
 * code through would make an unknown code fail every rule while looking like
 * data; NULL sends it to classification coverage as unmapped, which is the
 * place this surface already makes gaps visible.
 */
export function emitAdapterSql(binding: BindingSpec): string {
  const cols = binding.columns.map((c) => {
    if (!c.map) {
      return c.column === c.canonical
        ? `  ${c.column}`
        : `  ${c.column} AS ${c.canonical}`;
    }
    const arms = Object.entries(c.map)
      .map(([from, to]) => `    WHEN ${q(from)} THEN ${q(to)}`)
      .join('\n');
    return `  CASE ${c.column}\n${arms}\n    ELSE NULL\n  END AS ${c.canonical}`;
  });

  // No semicolon anywhere in this prose. A generated artifact is copied into
  // tools that split on `;` to find statement boundaries, and a semicolon
  // inside a comment turns the rest of the sentence into a syntax error at the
  // consumer. Cost me one — see `adapterStatements`, which is the real fix.
  const header = [
    `-- adapter: ${binding.name} → ${binding.binds}`,
    '--',
    '-- Generated from the source binding. The canonical plan runs unchanged on',
    '-- top of this view. Do not edit it — edit the binding and regenerate.',
  ].join('\n');

  // The canonical name is usually schema-qualified, and a client database has
  // no reason to already hold that schema — its tables live under its own. An
  // adapter that assumes `alm` exists fails on the first genuinely foreign
  // system, which is exactly the system bindings are for.
  const dot = binding.binds.lastIndexOf('.');
  const schema = dot > 0
    ? `CREATE SCHEMA IF NOT EXISTS ${binding.binds.slice(0, dot)};\n`
    : '';

  return `${header}\n${schema}CREATE OR REPLACE VIEW ${binding.binds} AS\nSELECT\n${cols.join(',\n')}\nFROM ${binding.table};\n`;
}

/**
 * The adapter as executable statements, ready to run in order.
 *
 * `emitAdapterSql` is for a human to read and for a migration file. This is
 * what a client executes, and it exists because the alternative — handing over
 * one blob and letting every client split it on `;` — makes each of them a
 * small, wrong SQL parser. A semicolon inside a string literal or a comment
 * breaks that split, which is not hypothetical: the header comment above used
 * to contain one.
 */
export function adapterStatements(binding: BindingSpec): string[] {
  const out: string[] = [];
  const dot = binding.binds.lastIndexOf('.');
  if (dot > 0) out.push(`CREATE SCHEMA IF NOT EXISTS ${binding.binds.slice(0, dot)}`);

  const view = emitAdapterSql(binding);
  const at = view.indexOf('CREATE OR REPLACE VIEW');
  out.push(view.slice(at).replace(/;\s*$/, ''));
  return out;
}

/**
 * The same adapter as data, for clients that reshape a DataFrame instead of
 * standing up a view — a rename dict plus per-column value maps.
 */
export function adapterModel(binding: BindingSpec): {
  table: string;
  binds: string;
  renames: Record<string, string>;
  maps: Record<string, Record<string, string>>;
} {
  const renames: Record<string, string> = {};
  const maps: Record<string, Record<string, string>> = {};
  binding.columns.forEach((c) => {
    if (c.column !== c.canonical) renames[c.column] = c.canonical;
    if (c.map) maps[c.canonical] = c.map;
  });
  return { table: binding.table, binds: binding.binds, renames, maps };
}
