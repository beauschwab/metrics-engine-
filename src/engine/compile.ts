/**
 * The compiler: one definition, several execution targets.
 *
 * This is the part that makes a registry more than a document store. The
 * derivations, the rule set, the rate table and the measures are walked once
 * and emitted as SQL, Polars or PySpark — so the pipeline that writes Iceberg
 * every night runs the same logic the author verified in the browser, rather
 * than a second implementation of it.
 *
 * Two decisions worth stating:
 *
 * Rule sets compile to a nested CASE in declared order. First-match-wins is
 * therefore preserved by construction on every backend rather than depending
 * on each one evaluating branches the same way.
 *
 * Parameter sets are *inlined* as literal mappings, not joined. The table is
 * bounded, so a join would buy nothing and cost a fan-out risk that has to be
 * reasoned about on four engines. Inlining also keeps the regulatory rates
 * inside the compiled artifact, where an auditor reading the plan can see them.
 */

import type { PredNode, Scalar } from './predicate';
import { compilePredicate } from './predicate';
import { derivationsOf, type DerivationSpec } from './rows';
import { reqs, sectionBlocks, type Graph, type Measure } from './parse';
import {
  resolveClassification, resolveParameterSet, type Classification,
  type ParameterSet, type Registry,
} from './registry';
import { MATURITY_LADDERS, OPEN_BUCKET } from './vocab';
import { AS_OF } from './fixtures';

export type Backend = 'sql' | 'polars' | 'pyspark';

export const BACKEND_LABEL: Record<Backend, string> = {
  sql: 'SQL',
  polars: 'Polars',
  pyspark: 'PySpark',
};

// ---------------------------------------------------------------------------
// Literals and predicates
// ---------------------------------------------------------------------------

function lit(v: Scalar, backend: Backend): string {
  if (v === null) return backend === 'sql' ? 'NULL' : 'None';
  if (typeof v === 'boolean') {
    return backend === 'sql' ? String(v).toUpperCase() : v ? 'True' : 'False';
  }
  if (typeof v === 'number') return String(v);
  return `'${v.replace(/'/g, "''")}'`;
}

function col(name: string, backend: Backend): string {
  if (backend === 'sql') return name;
  if (backend === 'polars') return `pl.col("${name}")`;
  return `F.col("${name}")`;
}

const SQL_OP: Record<string, string> = { '!=': '<>' };

/**
 * Emit a predicate for one backend.
 *
 * Both expression backends use `&` / `|` / `~`, which bind tighter than
 * comparison in Python — every operand is parenthesised for that reason, not
 * for style.
 */
export function emitPredicate(node: PredNode, backend: Backend): string {
  switch (node.t) {
    case 'always':
      return backend === 'sql' ? 'TRUE' : 'pl.lit(True)';

    case 'and':
    case 'or': {
      const join = backend === 'sql'
        ? node.t === 'and' ? ' AND ' : ' OR '
        : node.t === 'and' ? ' & ' : ' | ';
      return `(${emitPredicate(node.left, backend)}${join}${emitPredicate(node.right, backend)})`;
    }

    case 'not':
      return backend === 'sql'
        ? `NOT (${emitPredicate(node.node, backend)})`
        : `~(${emitPredicate(node.node, backend)})`;

    case 'cmp': {
      const op = backend === 'sql' ? (SQL_OP[node.op] || node.op) : node.op === '<>' ? '!=' : node.op;
      const python = op === '=' ? '==' : op;
      return backend === 'sql'
        ? `${col(node.col, backend)} ${op} ${lit(node.value, backend)}`
        : `(${col(node.col, backend)} ${python} ${lit(node.value, backend)})`;
    }

    case 'in': {
      const values = node.values.map((v) => lit(v, backend)).join(', ');
      if (backend === 'sql') return `${node.col} IN (${values})`;
      if (backend === 'polars') return `${col(node.col, backend)}.is_in([${values}])`;
      return `${col(node.col, backend)}.isin([${values}])`;
    }

    case 'null': {
      if (backend === 'sql') return `${node.col} IS ${node.negated ? 'NOT ' : ''}NULL`;
      const test = backend === 'polars'
        ? `${col(node.col, backend)}.is_null()`
        : `${col(node.col, backend)}.isNull()`;
      return node.negated ? `~(${test})` : test;
    }
  }
}

// ---------------------------------------------------------------------------
// Derivations
// ---------------------------------------------------------------------------

interface CaseArm {
  cond: string;
  value: string;
  /** Provenance, emitted as a trailing comment so the plan carries its citation. */
  note?: string;
}

/**
 * An ordered set of conditions, in every backend's spelling.
 *
 * The three languages agree on the semantics and disagree on every detail of
 * the syntax: SQL wants `WHEN … THEN …` inside one `CASE`, Polars wants
 * `pl.when(c).then(v)` chained by `.when(…)`, PySpark wants `F.when(c, v)` with
 * the value as a second argument. Emitting each arm independently — which is
 * what this used to do — produces Python that is not even parseable, because
 * two `pl.when(…)` expressions on consecutive lines are two statements rather
 * than one chain. Nothing short of executing the plan catches that.
 */
function emitCaseChain(
  arms: CaseArm[],
  otherwise: string | null,
  backend: Backend,
  indent: string,
): string {
  if (backend === 'sql') {
    const body = arms.map(
      (a) => `${indent}  WHEN ${a.cond}\n${indent}    THEN ${a.value}${a.note ? `  -- ${a.note}` : ''}`,
    );
    const tail = otherwise === null ? '' : `\n${indent}  ELSE ${otherwise}`;
    return `CASE\n${body.join('\n')}${tail}\n${indent}END`;
  }

  const body = arms.map((a, i) => {
    const head = i === 0 ? (backend === 'polars' ? 'pl.when' : 'F.when') : '.when';
    const call = backend === 'polars'
      ? `${head}(${a.cond}).then(${a.value})`
      : `${head}(${a.cond}, ${a.value})`;
    return `${indent}  ${call}${a.note ? `  # ${a.note}` : ''}`;
  });
  const tail = otherwise === null ? '' : `\n${indent}  .otherwise(${otherwise})`;
  return `(\n${body.join('\n')}${tail}\n${indent})`;
}

function litExpr(v: Scalar, backend: Backend): string {
  if (backend === 'sql') return lit(v, 'sql');
  return `${backend === 'polars' ? 'pl.lit' : 'F.lit'}(${lit(v, backend)})`;
}

/** An ordered rule set becomes a nested CASE, preserving first-match-wins. */
function emitClassify(c: Classification, backend: Backend, indent: string): string {
  const arms = c.rules
    .filter((r) => !compilePredicate(r.when).err)
    .map<CaseArm>((r) => ({
      cond: emitPredicate(compilePredicate(r.when).ast, backend),
      value: litExpr(r.emit, backend),
      note: backend === 'sql' ? `${r.id} · ${r.citation}` : r.id,
    }));

  // No ELSE: an unmatched record must arrive as NULL and be caught, not be
  // swept into a bucket the author never chose.
  return emitCaseChain(arms, null, backend, indent);
}

/** A bounded rate table becomes a literal mapping — no join, no fan-out. */
function emitParamLookup(
  ps: ParameterSet,
  keys: string[],
  backend: Backend,
  indent: string,
): string {
  const entries = ps.entries.map((e) => ({
    key: keys.map((k) => (e.f[k] || '').trim()),
    value: parseFloat((e.f[ps.value] || '').trim()),
    citation: (e.f.citation || '').trim(),
  }));

  if (backend === 'polars') {
    // A dict plus a strict replace keeps the rates legible as data rather than
    // burying them in a hundred-branch expression. `default=None` matters: an
    // unlisted key has no rate, and a missing rate is not a zero.
    const pairs = entries.map((e) => `${indent}    ${lit(e.key.join('|'), backend)}: ${e.value},`);
    const dict = `{\n${pairs.join('\n')}\n${indent}  }`;
    const keyExpr = keys.length === 1
      ? col(keys[0], backend)
      : `pl.concat_str([${keys.map((k) => col(k, backend)).join(', ')}], separator="|")`;
    return `${keyExpr}.replace_strict(${dict}, default=None)`;
  }

  // SQL and Spark both get a condition chain. Spark has no column-level
  // mapping operator — `Column.replace` does not exist, only the DataFrame one
  // — so a dict here would compile to an AttributeError at run time.
  const arms = entries.map<CaseArm>((e) => ({
    cond: backend === 'sql'
      ? keys.map((k, i) => `${k} = ${lit(e.key[i], 'sql')}`).join(' AND ')
      : keys.map((k, i) => `(${col(k, backend)} == ${lit(e.key[i], backend)})`).join(' & '),
    value: backend === 'sql' ? String(e.value) : `F.lit(${e.value})`,
    note: backend === 'sql' ? e.citation : e.key.join('|'),
  }));
  return emitCaseChain(arms, null, backend, indent);
}

function emitBucket(spec: DerivationSpec, backend: Backend, indent: string): string {
  const ladder = MATURITY_LADDERS[spec.ladder] || [];
  const days = `${spec.name}__days`;

  // A position with no stated maturity is open, not zero-days. That arm has to
  // come first, before any day-count comparison can claim it.
  const isNull = backend === 'sql'
    ? `${spec.field} IS NULL`
    : backend === 'polars'
      ? `${col(spec.field, backend)}.is_null()`
      : `${col(spec.field, backend)}.isNull()`;

  const arms: CaseArm[] = [{ cond: isNull, value: litExpr(OPEN_BUCKET, backend) }].concat(
    ladder
      .filter((b) => Number.isFinite(b.maxDays))
      .map((b) => ({
        cond: backend === 'sql'
          ? `${days} <= ${b.maxDays}`
          : `(${col(days, backend)} <= ${b.maxDays})`,
        value: litExpr(b.name, backend),
      })),
  );

  const last = ladder[ladder.length - 1];
  return emitCaseChain(arms, litExpr(last.name, backend), backend, indent);
}

function emitDaysBetween(spec: DerivationSpec, backend: Backend): string {
  const anchor = spec.anchor || 'as_of_date';
  if (backend === 'sql') {
    // An open position is demandable now, so a null maturity is zero days —
    // not a null that would drop out of a `<= 30` filter.
    return `COALESCE(DATE_DIFF('day', ${anchor}, ${spec.field}), 0)`;
  }
  if (backend === 'polars') {
    return `(${col(spec.field, backend)} - ${col(anchor, backend)}).dt.total_days().fill_null(0)`;
  }
  return `F.coalesce(F.datediff(${col(spec.field, backend)}, ${col(anchor, backend)}), F.lit(0))`;
}

/** Row arithmetic — our expression syntax is already close to all three. */
function emitExpr(expression: string, backend: Backend): string {
  if (backend === 'sql') return expression;
  return expression.replace(/[A-Za-z_][A-Za-z0-9_]*/g, (name) =>
    /^\d/.test(name) ? name : col(name, backend));
}

interface DerivedColumn {
  name: string;
  expr: string;
  /** Extra columns this one needs computed first (bucketing needs its day count). */
  prelude?: { name: string; expr: string };
}

function emitDerivations(
  g: Graph,
  registry: Registry,
  backend: Backend,
  indent: string,
): DerivedColumn[] {
  return derivationsOf(g).flatMap<DerivedColumn>((spec) => {
    switch (spec.op) {
      case 'days_between':
        return [{ name: spec.name, expr: emitDaysBetween(spec, backend) }];

      case 'date_bucket':
        return [{
          name: spec.name,
          expr: emitBucket(spec, backend, indent),
          prelude: {
            name: `${spec.name}__days`,
            expr: emitDaysBetween({ ...spec, anchor: spec.anchor || 'as_of_date' }, backend),
          },
        }];

      case 'classify': {
        const c = resolveClassification(registry, spec.using, AS_OF);
        return c ? [{ name: spec.name, expr: emitClassify(c, backend, indent) }] : [];
      }

      case 'param_lookup': {
        const ps = resolveParameterSet(registry, spec.using, AS_OF);
        const keys = spec.keys.length ? spec.keys : ps?.keys || [];
        return ps ? [{ name: spec.name, expr: emitParamLookup(ps, keys, backend, indent) }] : [];
      }

      case 'expr':
        return [{ name: spec.name, expr: emitExpr(spec.expression, backend) }];

      default:
        return [];
    }
  });
}

// ---------------------------------------------------------------------------
// Measures
// ---------------------------------------------------------------------------

const SQL_AGG: Record<string, string> = {
  sum: 'SUM', avg: 'AVG', min: 'MIN', max: 'MAX', count: 'COUNT',
  first: 'MIN', last: 'MAX',
};

function emitMeasure(m: Measure, backend: Backend): string | null {
  const type = (m.f.type || '').trim();
  if (type !== 'simple') return null;

  const agg = (m.f.agg || 'sum').trim();
  const field = (m.f.field || '').trim();
  const pred = compilePredicate(m.f.where || '');
  const filtered = !pred.empty && !pred.err;

  // A sum over no rows is zero; an average over no rows is not a number. Every
  // engine has an opinion here and they do not agree — SQL and Spark return
  // NULL from an empty SUM, Polars returns 0 — so the emitter states the
  // convention rather than inheriting whichever one the backend happens to
  // hold. A filed row reading "0" where another engine files a blank is a
  // reconciliation break, and the conformance suite catches it as one.
  const zeroWhenEmpty = agg === 'sum';

  if (backend === 'sql') {
    const fn = SQL_AGG[agg] || 'SUM';
    // FILTER (WHERE …) rather than a CASE, so a row excluded by the predicate
    // does not become a zero inside an average.
    const where = filtered ? ` FILTER (WHERE ${emitPredicate(pred.ast, 'sql')})` : '';
    const expr = `${fn}(${field})${where}`;
    return `${zeroWhenEmpty ? `COALESCE(${expr}, 0)` : expr} AS ${m.name}`;
  }

  if (backend === 'polars') {
    const base = filtered
      ? `pl.col("${field}").filter(${emitPredicate(pred.ast, 'polars')})`
      : `pl.col("${field}")`;
    const expr = `${base}.${agg === 'count' ? 'len' : agg}()`;
    return `${zeroWhenEmpty ? `${expr}.fill_null(0)` : expr}.alias("${m.name}")`;
  }

  const inner = filtered
    ? `F.when(${emitPredicate(pred.ast, 'pyspark')}, F.col("${field}"))`
    : `F.col("${field}")`;
  const expr = `F.${agg}(${inner})`;
  return `${zeroWhenEmpty ? `F.coalesce(${expr}, F.lit(0))` : expr}.alias("${m.name}")`;
}

// ---------------------------------------------------------------------------
// Reports
// ---------------------------------------------------------------------------

export interface ReportSpec {
  name: string;
  view: string;
  grouping: string[];
  measures: string[];
  target: string;
  table: string;
  partitionBy: string[];
  mode: string;
}

function listItems(raw: string): string[] {
  return (raw || '').replace(/[[\]]/g, '').split(',').map((s) => s.trim()).filter(Boolean);
}

export function readReport(g: Graph): ReportSpec {
  return {
    name: g.docName,
    view: (g.view.view || '').trim(),
    grouping: listItems(g.view.grouping || ''),
    measures: listItems(g.view.measures || ''),
    target: (g.view['materialize.target'] || '').trim(),
    table: (g.view['materialize.table'] || '').trim(),
    partitionBy: listItems(g.view['materialize.partition_by'] || ''),
    mode: (g.view['materialize.mode'] || 'overwrite_partitions').trim(),
  };
}

/**
 * Compile a report to one backend.
 *
 * Derivations become chained CTEs on SQL rather than one flat SELECT, because
 * a projection cannot reference an alias declared beside it — `outflow_rate`
 * has to exist before `balance * outflow_rate` can read it.
 */
export function compileReport(
  report: ReportSpec,
  view: Graph,
  registry: Registry,
  backend: Backend,
): string {
  const source = view.view.source;
  const measures = report.measures
    .map((name) => view.byName[name])
    .filter((m): m is Measure => !!m);

  if (backend === 'sql') return compileSql(report, view, registry, source, measures);
  return compilePython(report, view, registry, source, measures, backend);
}

function compileSql(
  report: ReportSpec,
  view: Graph,
  registry: Registry,
  source: string,
  measures: Measure[],
): string {
  const derived = emitDerivations(view, registry, 'sql', '    ');
  const ctes: string[] = [
    `base AS (\n  SELECT * FROM ${source}\n  WHERE as_of_date = DATE '${AS_OF}'\n)`,
  ];

  let prev = 'base';
  let n = 0;
  const stage = (expr: string, as: string) => {
    const name = `d${++n}`;
    ctes.push(`${name} AS (\n  SELECT *,\n    ${expr} AS ${as}\n  FROM ${prev}\n)`);
    prev = name;
  };

  derived.forEach((d) => {
    // A helper column gets its own stage. SQL cannot reference an alias
    // declared beside it, so emitting the day count next to the CASE that
    // reads it produces a query that fails on every engine.
    if (d.prelude) stage(d.prelude.expr, d.prelude.name);
    stage(d.expr, d.name);
  });

  const select = report.grouping
    .concat(measures.map((m) => emitMeasure(m, 'sql') || `NULL AS ${m.name}`))
    .join(',\n  ');
  const groupBy = report.grouping.map((_, i) => i + 1).join(', ');

  const query =
    `WITH ${ctes.join(',\n')}\nSELECT\n  ${select}\nFROM ${prev}\n` +
    `GROUP BY ${groupBy}\nORDER BY ${groupBy}`;

  const write = report.table
    ? `\n\n-- materialize\nINSERT OVERWRITE ${report.table}\n  PARTITION (${report.partitionBy.join(', ')})\n${query};`
    : '';

  return `-- ${report.name} · compiled for SQL (Spark / Trino / DuckDB)\n${query}${write}`;
}

function compilePython(
  report: ReportSpec,
  view: Graph,
  registry: Registry,
  source: string,
  measures: Measure[],
  backend: Backend,
): string {
  const derived = emitDerivations(view, registry, backend, '    ');
  const polars = backend === 'polars';

  const head = polars
    ? `df = (\n  pl.scan_iceberg("${source}")\n` +
      `  .filter(pl.col("as_of_date") == date.fromisoformat("${AS_OF}"))`
    : `df = (\n  spark.table("${source}")\n` +
      `  .where(F.col("as_of_date") == F.lit("${AS_OF}"))`;

  const withCol = polars ? '.with_columns' : '.withColumn';
  const steps = derived.flatMap((d) => {
    const rows: string[] = [];
    if (d.prelude) {
      rows.push(polars
        ? `  ${withCol}((${d.prelude.expr}).alias("${d.prelude.name}"))`
        : `  ${withCol}("${d.prelude.name}", ${d.prelude.expr})`);
    }
    rows.push(polars
      ? `  ${withCol}((${d.expr}).alias("${d.name}"))`
      : `  ${withCol}("${d.name}", ${d.expr})`);
    return rows;
  });

  const group = polars
    ? `  .group_by([${report.grouping.map((g) => `"${g}"`).join(', ')}])`
    : `  .groupBy(${report.grouping.map((g) => `"${g}"`).join(', ')})`;

  const aggs = measures
    .map((m) => emitMeasure(m, backend))
    .filter(Boolean)
    .map((a) => `    ${a},`);

  const agg = `  .agg(\n${aggs.join('\n')}\n  )`;

  const write = report.table
    ? polars
      ? `\n\n# materialize\ndf.collect().write_iceberg("${report.table}", mode="${report.mode}")`
      : `\n\n# materialize\n(\n  df.writeTo("${report.table}")\n` +
        `    .partitionedBy(${report.partitionBy.map((p) => `"${p}"`).join(', ')})\n` +
        `    .${report.mode === 'append' ? 'append()' : 'overwritePartitions()'}\n)`
    : '';

  const imports = polars
    ? 'import polars as pl\nfrom datetime import date'
    : 'from pyspark.sql import functions as F';

  return `# ${report.name} · compiled for ${BACKEND_LABEL[backend]}\n${imports}\n\n` +
         `${head}\n${steps.join('\n')}\n${group}\n${agg}\n)${write}`;
}

/** Reports declared in a workspace, keyed by name. */
export function reportsIn(registry: Registry): Record<string, { spec: ReportSpec; graph: Graph }> {
  const out: Record<string, { spec: ReportSpec; graph: Graph }> = {};
  Object.keys(registry.graphs).forEach((file) => {
    const g = registry.graphs[file];
    if (g.kind !== 'report') return;
    out[g.docName] = { spec: readReport(g), graph: g };
  });
  return out;
}

/** Measures a report names that its view does not define. */
export function missingMeasures(report: ReportSpec, view: Graph | null): string[] {
  if (!view) return report.measures;
  return report.measures.filter((m) => !view.byName[m]);
}

/** Grouping columns that are neither source columns nor derived. */
export function missingGrouping(
  report: ReportSpec,
  view: Graph | null,
  sourceColumns: string[],
): string[] {
  if (!view) return report.grouping;
  const derived = derivationsOf(view).map((d) => d.name);
  return report.grouping.filter((c) => sourceColumns.indexOf(c) < 0 && derived.indexOf(c) < 0);
}

export { reqs, sectionBlocks };
