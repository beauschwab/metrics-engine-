/**
 * Publishing a definition to the layer people actually read.
 *
 * The compiler emits SQL, Polars and PySpark — three ways of running a plan in a
 * pipeline. None of them is what a dashboard consumes, so the last hop of a
 * governed number has always been a human retyping it: `lcr_pct` is defined
 * here, under an SR 11-7 tier with a citation and a revision history, and then
 * somebody writes `100.0 * [HQLA] / [Net Outflows]` into a Tableau calculated
 * field and *that* is the number the committee sees.
 *
 * The two then drift. Not dramatically — a rounding rule here, a filter there —
 * and the drift is undetectable because nothing compares them. **Drift you
 * cannot detect is worse than a wrong number you can**, which is the whole
 * argument for this file existing.
 *
 * Two targets, because BI stacks split roughly two ways:
 *
 * **A view.** `CREATE OR REPLACE VIEW` against the warehouse. Universally
 * consumable — every BI tool can point at a view — and it makes the governed
 * definition the only definition, because there is nothing left for the
 * dashboard to compute.
 *
 * **A dbt semantic model.** For stacks that already have a metric layer, where a
 * view would be redundant and a metric definition is what the tooling wants.
 *
 * What this deliberately does not do is guess. The expression language is
 * SQL-shaped by design, so most of a derived measure passes through unchanged —
 * but `ema()` has no standard SQL form, and emitting *something* for it would
 * produce a dashboard that is confidently wrong. Unsupported constructs are
 * refused by name.
 */

import { compilePredicate } from './predicate';
import { emitPredicate } from './compile';
import { isCurrency } from './money';
import { sectionBlocks, type Graph, type Measure } from './parse';

export type SemanticTarget = 'view' | 'dbt';

export const SEMANTIC_LABEL: Record<SemanticTarget, string> = {
  view: 'SQL view',
  dbt: 'dbt semantic model',
};

/** Something that cannot be published, and why — never silently dropped. */
export interface SemanticIssue {
  measure: string;
  reason: string;
}

export interface SemanticPlan {
  text: string;
  issues: SemanticIssue[];
  /** Measures that made it into the published artifact. */
  published: string[];
}

/**
 * Functions with the same meaning in the expression language and in SQL.
 *
 * `max`/`min` are here as *scalar* functions — that is what they are in this
 * language, where `max(a, b)` picks the larger of two values. In SQL those names
 * are aggregates, so they are rewritten rather than passed through; emitting
 * `MAX(a, b)` would be a syntax error on some engines and a silent aggregate on
 * others, which is worse.
 */
const RENAME: Record<string, string> = { max: 'GREATEST', min: 'LEAST' };

const PASS_THROUGH = new Set([
  'greatest', 'least', 'nullif', 'coalesce', 'abs', 'round', 'floor', 'ceil',
]);

/**
 * Functions the evaluator knows and SQL does not.
 *
 * `ema` is the honest one: the browser approximates it as `x * 0.981` for the
 * preview, which is fine for a sparkline and is not a definition anybody should
 * publish. `sum`/`avg`/`last`/`first` used inside a *derived* expression are
 * likewise not scalar SQL — the aggregation already happened a stage earlier.
 */
const UNSUPPORTED: Record<string, string> = {
  ema: 'ema() is a preview approximation, not a definition — there is no portable SQL for it',
  last: 'last() is a window function over the series, which a single-row view cannot express',
  first: 'first() is a window function over the series, which a single-row view cannot express',
};

const IDENT_CALL = /([A-Za-z_][A-Za-z0-9_]*)\s*\(/g;

/**
 * Rewrite a derived expression to SQL, or say why it cannot be.
 *
 * A token-level rewrite rather than a parse, and that is a deliberate limit
 * rather than laziness: the grammar is already SQL — arithmetic, comparisons,
 * `case when … then … else … end` — so the only things needing translation are
 * function names. Anything not recognised is refused rather than guessed at.
 */
export function expressionToSql(expr: string): { sql: string; reason?: string } {
  const src = expr.trim();
  if (!src) return { sql: '', reason: 'the expression is empty' };

  for (const [, name] of src.matchAll(IDENT_CALL)) {
    const lower = name.toLowerCase();
    if (UNSUPPORTED[lower]) return { sql: '', reason: UNSUPPORTED[lower] };
    if (!PASS_THROUGH.has(lower) && !RENAME[lower]) {
      return { sql: '', reason: `${name}() has no known SQL equivalent` };
    }
  }

  const sql = src
    .replace(IDENT_CALL, (whole, name: string) => {
      const mapped = RENAME[name.toLowerCase()];
      return mapped ? `${mapped}(` : whole;
    })
    .replace(/\s+/g, ' ')
    .trim();

  return { sql };
}

export interface Staged {
  simple: Measure[];
  derived: Measure[];
  issues: SemanticIssue[];
}

/**
 * Split a view's measures into what aggregates and what computes on top, in
 * dependency order.
 *
 * `lcr_buffer` requires `lcr_pct` requires `hqla_total`, so emitting them in
 * document order produces SQL that references a column declared beside it. The
 * ordering is a plain Kahn walk over `requires:`, and a measure in a cycle is
 * refused rather than dropped — the diagnostics layer already names the cycle,
 * and silently omitting a measure from a published view is how a dashboard ends
 * up missing a number nobody notices is gone.
 */
export function stage(view: Graph): Staged {
  const measures = sectionBlocks(view, 'measures');
  const simple: Measure[] = [];
  const pending: Measure[] = [];
  const issues: SemanticIssue[] = [];

  measures.forEach((m) => {
    const type = (m.f.type || '').trim();
    if (type === 'simple') simple.push(m);
    else if (type === 'derived') pending.push(m);
    else issues.push({ measure: m.name, reason: `type '${type || 'unset'}' cannot be published` });
  });

  const ready = new Set(simple.map((m) => m.name));
  const derived: Measure[] = [];
  let progress = true;

  while (progress && pending.length) {
    progress = false;
    for (let i = pending.length - 1; i >= 0; i--) {
      const m = pending[i];
      const needs = (m.f.requires || '')
        .replace(/[[\]]/g, '').split(',').map((s) => s.trim()).filter(Boolean);
      if (needs.every((n) => ready.has(n))) {
        derived.push(m);
        ready.add(m.name);
        pending.splice(i, 1);
        progress = true;
      }
    }
  }

  pending.forEach((m) => issues.push({
    measure: m.name,
    reason: 'depends on a measure that is not published, or on itself',
  }));

  return { simple, derived, issues };
}

/** The aggregate for one simple measure, as SQL. */
export function aggregate(m: Measure): { sql: string; reason?: string } {
  const agg = (m.f.agg || 'sum').trim().toUpperCase();
  const field = (m.f.field || '').trim();
  if (!field) return { sql: '', reason: 'no field to aggregate' };
  if (!['SUM', 'AVG', 'MIN', 'MAX', 'COUNT'].includes(agg)) {
    return { sql: '', reason: `aggregate '${agg}' is not portable` };
  }

  const pred = compilePredicate(m.f.where || '');
  if (pred.err) return { sql: '', reason: `the where clause does not compile: ${pred.err}` };
  const where = !pred.empty ? ` FILTER (WHERE ${emitPredicate(pred.ast, 'sql')})` : '';

  // The same convention the pipeline emitters state: a sum over nothing is
  // zero, and a filed amount is the correctly-rounded amount in the minor unit.
  // A published view that rounds differently from the filed table is precisely
  // the drift this file exists to stop.
  let sql = `${agg}(${field})${where}`;
  if (agg === 'SUM') sql = `COALESCE(${sql}, 0)`;
  if (isCurrency(m.f.format)) sql = `ROUND(${sql}, 2)`;
  return { sql };
}

/**
 * A governed view: the definition, as something a BI tool can point at.
 *
 * Grain is the view's own as-of field. There is no `WHERE as_of_date = …` here,
 * unlike the report emitters — a dashboard reads a range, and pinning the view
 * to a single day would make it useless for the trend that is the reason
 * somebody opened it.
 */
export function emitViewDdl(view: Graph, schema = 'analytics'): SemanticPlan {
  const name = (view.view.view || view.docName || 'unnamed').trim();
  const source = (view.view.source || '').trim();
  const asOf = (view.view['grain.as_of_field'] || 'as_of_date').trim();

  const { simple, derived, issues } = stage(view);
  const published: string[] = [];

  const aggLines: string[] = [];
  simple.forEach((m) => {
    const { sql, reason } = aggregate(m);
    if (reason) {
      issues.push({ measure: m.name, reason });
      return;
    }
    aggLines.push(`    ${sql} AS ${m.name}`);
    published.push(m.name);
  });

  // Each derived measure gets its own stage, for the same reason the report
  // compiler chains CTEs: SQL cannot reference an alias declared beside it, so
  // `lcr_buffer` needs `lcr_pct` to already exist as a column.
  const stages: string[] = [];
  let prev = 'agg';
  let n = 0;
  derived.forEach((m) => {
    const { sql, reason } = expressionToSql(m.f.expression || '');
    if (reason) {
      issues.push({ measure: m.name, reason });
      return;
    }
    const cte = `d${++n}`;
    stages.push(`${cte} AS (\n  SELECT *,\n    ${sql} AS ${m.name}\n  FROM ${prev}\n)`);
    prev = cte;
    published.push(m.name);
  });

  if (!aggLines.length) {
    return {
      text: `-- ${name}: nothing publishable\n`
        + '-- Every measure was refused; see the issues list.\n',
      issues,
      published: [],
    };
  }

  const ctes = [
    `agg AS (\n  SELECT\n    ${asOf},\n${aggLines.join(',\n')}\n  FROM ${source}\n  GROUP BY 1\n)`,
    ...stages,
  ];

  const cols = [asOf, ...published].join(',\n  ');

  const header = [
    `-- ${name} · published for the semantic layer`,
    '--',
    '-- Generated from the governed definition. Editing this file forks the',
    '-- number: the definition it came from will keep changing and this will not,',
    '-- and nothing compares them. Regenerate instead.',
    view.view['governance.owner'] ? `-- Owner: ${view.view['governance.owner']}` : '',
    view.view['governance.citation'] ? `-- Citation: ${view.view['governance.citation']}` : '',
  ].filter(Boolean).join('\n');

  return {
    text: `${header}\nCREATE OR REPLACE VIEW ${schema}.${name} AS\nWITH ${ctes.join(',\n')}\n`
      + `SELECT\n  ${cols}\nFROM ${prev};\n`,
    issues,
    published,
  };
}

/**
 * A dbt semantic model, for stacks that already have a metric layer.
 *
 * Simple measures become `measures:`, derived measures become `metrics:` of
 * type `derived` — which is dbt's own split and happens to be exactly the one
 * the documents already make.
 */
export function emitDbtModel(view: Graph): SemanticPlan {
  const name = (view.view.view || view.docName || 'unnamed').trim();
  const source = (view.view.source || '').trim();
  const asOf = (view.view['grain.as_of_field'] || 'as_of_date').trim();
  const { simple, derived, issues } = stage(view);
  const published: string[] = [];

  const quote = (s: string) => (/[:#{}[\],&*?|<>=!%@`"']/.test(s) ? JSON.stringify(s) : s);

  const lines: string[] = [
    `# ${name} · published for the semantic layer`,
    '#',
    '# Generated from the governed definition. Regenerate rather than edit —',
    '# an edited copy forks the number and nothing compares the two.',
    'semantic_models:',
    `  - name: ${name}`,
    `    model: ref('${source.replace(/^.*\./, '')}')`,
  ];

  const description = (view.view.display_name || '').trim();
  if (description) lines.push(`    description: ${quote(description)}`);

  lines.push(
    '    defaults:',
    `      agg_time_dimension: ${asOf}`,
    '    dimensions:',
    `      - name: ${asOf}`,
    '        type: time',
    '        type_params:',
    '          time_granularity: day',
    '    measures:',
  );

  simple.forEach((m) => {
    const agg = (m.f.agg || 'sum').trim();
    const field = (m.f.field || '').trim();
    if (!field) {
      issues.push({ measure: m.name, reason: 'no field to aggregate' });
      return;
    }
    lines.push(
      `      - name: ${m.name}`,
      `        agg: ${agg}`,
      `        expr: ${field}`,
    );
    // A filter is part of the measure, not a note about it. dbt carries it as
    // an `expr`, so an unfiltered copy of a filtered measure is not published.
    const pred = compilePredicate(m.f.where || '');
    if (!pred.empty && !pred.err) {
      lines[lines.length - 1] =
        `        expr: CASE WHEN ${emitPredicate(pred.ast, 'sql')} THEN ${field} END`;
    }
    if ((m.f.description || '').trim()) {
      lines.push(`        description: ${quote(m.f.description.trim())}`);
    }
    published.push(m.name);
  });

  const metrics: string[] = [];
  simple.forEach((m) => {
    metrics.push(
      `  - name: ${m.name}`,
      '    type: simple',
      '    type_params:',
      `      measure: ${m.name}`,
    );
  });

  derived.forEach((m) => {
    const { sql, reason } = expressionToSql(m.f.expression || '');
    if (reason) {
      issues.push({ measure: m.name, reason });
      return;
    }
    const needs = (m.f.requires || '')
      .replace(/[[\]]/g, '').split(',').map((s) => s.trim()).filter(Boolean);
    metrics.push(
      `  - name: ${m.name}`,
      '    type: derived',
      '    type_params:',
      `      expr: ${quote(sql)}`,
      '      metrics:',
      ...needs.map((d) => `        - name: ${d}`),
    );
    published.push(m.name);
  });

  return {
    text: `${lines.join('\n')}\n\nmetrics:\n${metrics.join('\n')}\n`,
    issues,
    published,
  };
}

export function emitSemantic(view: Graph, target: SemanticTarget): SemanticPlan {
  return target === 'dbt' ? emitDbtModel(view) : emitViewDdl(view);
}
