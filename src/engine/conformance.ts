/**
 * The conformance harness — the part that stops the compiler from being a
 * claim.
 *
 * Everything up to here emits plans and asserts their *shape*: the CASE arms
 * are in declared order, the rate table is inlined, each derivation gets its
 * own stage. Shape assertions catch typos. They do not catch a backend whose
 * `date_diff` counts the other direction, whose `SUM` treats NULL as zero, or
 * whose grouping folds NULL into the empty string. Those produce a plan that
 * looks exactly right and files a different number.
 *
 * So this module exists to run the compiled plan on a real engine and compare
 * it, row for row, against the in-browser evaluator. DuckDB is the reference
 * target — it is the one engine we can seed, execute and tear down inside a
 * unit test, and per the spec it is the conformance reference the other
 * backends are measured against.
 *
 * Nothing here imports a database driver. Seeding is emitted as text and
 * comparison is done on plain rows, so this file stays usable from the browser
 * bundle and from a Python leg that never touches Node at all.
 */

import type { Row } from './fixtures';

// ---------------------------------------------------------------------------
// Fixture → DDL
// ---------------------------------------------------------------------------

export interface Column {
  name: string;
  /** DuckDB type. Deliberately the narrow set the fixtures actually use. */
  type: 'DATE' | 'DOUBLE' | 'BOOLEAN' | 'VARCHAR';
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Infer a schema from fixture rows.
 *
 * Dates arrive as strings and open positions arrive as the empty string, so a
 * column is only DATE when at least one value is a real date and none of the
 * non-empty values are anything else. Without the "at least one" clause every
 * all-empty column would qualify vacuously — `bucket_code` on the position
 * fixture is exactly that.
 */
export function inferSchema(rows: Row[]): Column[] {
  const names: string[] = [];
  const seen: Record<string, true> = {};
  rows.forEach((r) => {
    Object.keys(r).forEach((k) => {
      if (!seen[k]) {
        seen[k] = true;
        names.push(k);
      }
    });
  });

  return names.map((name) => {
    let dates = 0;
    let nonDate = false;
    let numeric = false;
    let boolean = false;
    let other = false;

    rows.forEach((r) => {
      const v = r[name];
      if (v === undefined || v === null || v === '') return;
      if (typeof v === 'number') {
        numeric = true;
        nonDate = true;
      } else if (typeof v === 'boolean') {
        boolean = true;
        nonDate = true;
      } else if (ISO_DATE.test(v)) {
        dates++;
      } else {
        other = true;
        nonDate = true;
      }
    });

    if (dates > 0 && !nonDate) return { name, type: 'DATE' as const };
    if (numeric && !boolean && !other) return { name, type: 'DOUBLE' as const };
    if (boolean && !numeric && !other) return { name, type: 'BOOLEAN' as const };
    return { name, type: 'VARCHAR' as const };
  });
}

function sqlLiteral(v: unknown, type: Column['type']): string {
  if (v === undefined || v === null) return 'NULL';
  if (type === 'DATE') return v === '' ? 'NULL' : `DATE '${v}'`;
  if (type === 'BOOLEAN') return v ? 'TRUE' : 'FALSE';
  if (type === 'DOUBLE') {
    const n = Number(v);
    return Number.isFinite(n) ? String(n) : 'NULL';
  }
  return `'${String(v).replace(/'/g, "''")}'`;
}

/**
 * Statements that materialise a fixture table.
 *
 * Inserts are chunked because a single VALUES list of a hundred thousand rows
 * is a parser stress test rather than a data load, and a failure there would
 * read as a conformance failure.
 */
export function seedStatements(source: string, rows: Row[], chunk = 500): string[] {
  const dot = source.lastIndexOf('.');
  const schema = dot > 0 ? source.slice(0, dot) : null;
  const cols = inferSchema(rows);

  const out: string[] = [];
  if (schema) out.push(`CREATE SCHEMA IF NOT EXISTS ${schema}`);
  out.push(
    `CREATE OR REPLACE TABLE ${source} (\n  ` +
      cols.map((c) => `${c.name} ${c.type}`).join(',\n  ') +
      '\n)',
  );

  for (let i = 0; i < rows.length; i += chunk) {
    const values = rows
      .slice(i, i + chunk)
      .map((r) => `(${cols.map((c) => sqlLiteral(r[c.name], c.type)).join(', ')})`)
      .join(',\n  ');
    out.push(`INSERT INTO ${source} VALUES\n  ${values}`);
  }

  return out;
}

// ---------------------------------------------------------------------------
// Compiled plan → executable statement
// ---------------------------------------------------------------------------

/**
 * The readable part of a compiled plan.
 *
 * `compileReport` appends a materialize tail — `INSERT OVERWRITE … PARTITION`,
 * `write_iceberg`, `writeTo(...).overwritePartitions()` — that writes to a
 * table the harness has no reason to create, and in SQL's case is Spark/Trino
 * syntax DuckDB does not accept. The conformance question is whether the read
 * produces the right rows; where they land afterwards is a separate concern
 * with its own failure modes.
 */
export function executableQuery(compiled: string): string {
  return splitPlan(compiled).query;
}

/**
 * A compiled plan in its two halves.
 *
 * The read and the write have different prerequisites — the write needs a sink
 * that already exists, with a partition spec — so a harness that wants to
 * exercise both has to be able to put something between them. Splitting on the
 * marker is what makes that possible without editing either half.
 */
export function splitPlan(compiled: string): { query: string; materialize: string } {
  let cut = -1;
  ['\n\n-- materialize', '\n\n# materialize'].forEach((marker) => {
    const at = compiled.indexOf(marker);
    if (at >= 0 && (cut < 0 || at < cut)) cut = at;
  });
  if (cut < 0) return { query: compiled.trim(), materialize: '' };
  return { query: compiled.slice(0, cut).trim(), materialize: compiled.slice(cut).trim() };
}

// ---------------------------------------------------------------------------
// Retargeting the reader
// ---------------------------------------------------------------------------

const POLARS_DTYPE: Record<Column['type'], string> = {
  DATE: 'pl.Date',
  DOUBLE: 'pl.Float64',
  BOOLEAN: 'pl.Boolean',
  VARCHAR: 'pl.String',
};

/**
 * Point a compiled Polars plan at a CSV instead of an Iceberg catalogue.
 *
 * Only the reader is rewritten. Every derivation, every rule arm, every rate
 * and every aggregate is the compiler's own output, unmodified — which is the
 * whole point: if the harness were allowed to touch the logic, agreement would
 * prove nothing.
 *
 * A miss throws rather than returning the plan unchanged. Silently executing an
 * un-retargeted plan would fail on the catalogue lookup and read as an
 * environment problem, when what actually happened is that the compiler started
 * emitting a reader this function no longer recognises.
 */
export function retargetPolars(plan: string, csvPath: string, schema: Column[]): string {
  const body = executableQuery(plan);
  const overrides = schema.map((c) => `"${c.name}": ${POLARS_DTYPE[c.type]}`).join(', ');
  const reader = `pl.scan_csv(r"${csvPath}", schema_overrides={${overrides}})`;
  const out = body.replace(/pl\.scan_iceberg\([^)]*\)/, reader);
  if (out === body) throw new Error('no pl.scan_iceberg reader found in the compiled plan');
  return `${out}\n\nimport sys\nsys.stdout.write(df.collect().write_ndjson())\n`;
}

// ---------------------------------------------------------------------------
// Comparison
// ---------------------------------------------------------------------------

export type Tolerance = 'exact' | 'currency' | 'ratio';

/**
 * How a measure's format decides what "equal" means.
 *
 * Counts are identities and must match exactly. Currency is now *also* exact,
 * to the cent: since the emitters round every filed amount to the minor unit,
 * "close enough" is no longer a thing two engines are allowed to be. This used
 * to be a ±$0.005 tolerance, which quietly conceded that the backends did not
 * actually agree — a submission that reconciles only approximately is a finding.
 * Ratios stay relative, because they are not amounts and are not rounded.
 */
export function toleranceFor(format: string): Tolerance {
  if (/^count/.test(format) || format === 'integer') return 'exact';
  if (/^currency/.test(format)) return 'currency';
  return 'ratio';
}

const RATIO_EPS = 1e-9;
/**
 * Both sides have rounded to the cent, so any difference is a real disagreement.
 * The allowance left is a tenth of a cent, purely so that two values that *are*
 * the same cent cannot fail on the float64 representation of that cent.
 */
const CENT = 0.001;

export function withinTolerance(a: number, b: number, kind: Tolerance): boolean {
  const aNull = a === null || a === undefined || Number.isNaN(a);
  const bNull = b === null || b === undefined || Number.isNaN(b);
  if (aNull || bNull) return aNull && bNull;
  if (a === b) return true;

  switch (kind) {
    case 'exact':
      return false;
    case 'currency':
      return Math.abs(a - b) <= CENT;
    case 'ratio': {
      const scale = Math.max(Math.abs(a), Math.abs(b));
      return Math.abs(a - b) <= RATIO_EPS * Math.max(scale, 1);
    }
  }
}

export interface Divergence {
  key: string;
  measure: string;
  expected: number | null;
  actual: number | null;
  /** Absolute difference, or null when one side has no row at all. */
  delta: number | null;
  reason: 'value' | 'missing_in_engine' | 'missing_in_evaluator';
}

export interface TableRow {
  key: string[];
  values: Record<string, number>;
}

/**
 * The separator inside a composite key.
 *
 * A literal control character rather than a space, because a grouping value may
 * contain a space and `['a b', 'c']` must not collide with `['a', 'b c']`. It is
 * written as an escape: this was an unescaped raw byte for a while, which made
 * the file read as binary to every tool that looked at it — `grep` refused to
 * search it — and left two invisible characters in the source.
 */
const KEY_SEP = '\u001f';

/**
 * A grouping key as a comparable string.
 *
 * SQL returns an unmatched classification as NULL; the evaluator writes the
 * empty string. They mean the same thing — no rule fired — and folding them
 * together here is the one normalisation this comparison performs. Anything
 * else that differs is a real divergence.
 */
export function keyOf(parts: Array<unknown>): string {
  return parts.map((p) => (p === null || p === undefined ? '' : String(p))).join(KEY_SEP);
}

export function compareTables(
  expected: TableRow[],
  actual: TableRow[],
  measures: string[],
  tolerance: Record<string, Tolerance>,
): Divergence[] {
  const byKey = (rows: TableRow[]) => {
    const m: Record<string, TableRow> = {};
    rows.forEach((r) => {
      m[keyOf(r.key)] = r;
    });
    return m;
  };

  const e = byKey(expected);
  const a = byKey(actual);
  const keys = Object.keys(e).concat(Object.keys(a).filter((k) => !(k in e)));
  const out: Divergence[] = [];

  keys.forEach((k) => {
    const label = k.split(KEY_SEP).map((p) => p || '∅').join(' · ');
    if (!(k in a)) {
      out.push({
        key: label, measure: '*', expected: null, actual: null, delta: null,
        reason: 'missing_in_engine',
      });
      return;
    }
    if (!(k in e)) {
      out.push({
        key: label, measure: '*', expected: null, actual: null, delta: null,
        reason: 'missing_in_evaluator',
      });
      return;
    }
    measures.forEach((m) => {
      const x = e[k].values[m];
      const y = a[k].values[m];
      if (withinTolerance(x, y, tolerance[m] || 'ratio')) return;
      out.push({
        key: label,
        measure: m,
        expected: Number.isFinite(x) ? x : null,
        actual: Number.isFinite(y) ? y : null,
        delta: Number.isFinite(x) && Number.isFinite(y) ? Math.abs(x - y) : null,
        reason: 'value',
      });
    });
  });

  return out;
}

/** A divergence list rendered for a test failure message. */
export function explain(divergences: Divergence[], limit = 8): string {
  if (!divergences.length) return 'conformant';
  const shown = divergences.slice(0, limit).map((d) => {
    if (d.reason !== 'value') {
      return `  ${d.key} — ${d.reason === 'missing_in_engine'
        ? 'evaluator produced this group, engine did not'
        : 'engine produced this group, evaluator did not'}`;
    }
    return `  ${d.key} · ${d.measure}: evaluator ${d.expected} vs engine ${d.actual}` +
      ` (Δ ${d.delta?.toExponential(3)})`;
  });
  const more = divergences.length > limit ? `\n  … ${divergences.length - limit} more` : '';
  return `${divergences.length} divergence(s):\n${shown.join('\n')}${more}`;
}

// ---------------------------------------------------------------------------
// CSV, for legs that run outside Node
// ---------------------------------------------------------------------------

/** Fixture rows as CSV — the handoff to a Polars or Spark leg. */
export function toCsv(rows: Row[], schema: Column[] = inferSchema(rows)): string {
  const cell = (v: unknown, type: Column['type']): string => {
    if (v === undefined || v === null || v === '') return '';
    if (type === 'BOOLEAN') return v ? 'true' : 'false';
    const s = String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const head = schema.map((c) => c.name).join(',');
  const body = rows.map((r) => schema.map((c) => cell(r[c.name], c.type)).join(','));
  return [head].concat(body).join('\n');
}
