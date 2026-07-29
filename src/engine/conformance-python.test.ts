/**
 * The Python backends.
 *
 * DuckDB proves the SQL emitter. It says nothing about the Polars one, and the
 * two are different code paths that only look alike — SQL builds one `CASE`,
 * Polars builds a chained expression; SQL sums to NULL over an empty group,
 * Polars sums to zero; SQL inlines rates as branches, Polars maps a dict. Every
 * one of those is a place the same definition can produce two different numbers.
 *
 * Polars gets the full treatment: write the fixture out, run the compiler's own
 * plan with only the reader swapped, compare the result to the evaluator.
 *
 * PySpark gets a syntax gate and nothing more, because a JVM Spark session is
 * not something a unit test should be starting. That is a real limit and it is
 * stated rather than papered over — the PySpark emitter is checked for *valid,
 * chained* Python, not for producing the right numbers. What makes the gate
 * worth having anyway is that the bug it catches is the one that was actually
 * there: consecutive `when` calls emitted as separate expressions, which reads
 * perfectly and evaluates to only the last arm.
 *
 * Both skip themselves when the toolchain is missing rather than failing. A
 * contributor without Python should still be able to run the suite; CI has one,
 * and that is where the gate matters.
 */

import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { compileReport, readReport, type ReportSpec } from './compile';
import {
  compareTables, executableQuery, explain, inferSchema, retargetPolars, toCsv,
  toleranceFor, type TableRow, type Tolerance,
} from './conformance';
import { INITIAL_DOCS } from './documents';
import { AS_OF, TABLES } from './fixtures';
import { parseDoc, type Graph } from './parse';
import { buildRegistry } from './registry';
import { runReport } from './report';

const SOURCE = 'alm.fct_2052a_positions';

function pythonHas(module: string): boolean {
  try {
    execFileSync('python3', ['-c', `import ${module}`], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

const HAS_POLARS = pythonHas('polars');
const dir = mkdtempSync(join(tmpdir(), 'keel-conformance-'));

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

function runPython(code: string): string {
  const script = join(dir, 'plan.py');
  writeFileSync(script, code);
  return execFileSync('python3', [script], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
}

const registry = buildRegistry(INITIAL_DOCS as unknown as Record<string, string>);
const view = parseDoc(INITIAL_DOCS.fr2052a_outflows);
const spec = readReport(parseDoc(INITIAL_DOCS.fr2052a_submission));

function tolerances(s: ReportSpec, target: Graph): Record<string, Tolerance> {
  const out: Record<string, Tolerance> = {};
  s.measures.forEach((m) => {
    out[m] = toleranceFor((target.byName[m]?.f.format || '').trim());
  });
  return out;
}

// ---------------------------------------------------------------------------

describe.skipIf(!HAS_POLARS)('polars conformance', () => {
  const rows = TABLES.nominal[SOURCE][AS_OF];
  const schema = inferSchema(rows);
  const csv = join(dir, 'positions.csv');
  writeFileSync(csv, toCsv(rows, schema));

  function engineTable(): TableRow[] {
    const plan = compileReport(spec, view, registry, 'polars');
    const out = runPython(retargetPolars(plan, csv, schema));
    return out
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        const r = JSON.parse(line) as Record<string, unknown>;
        return {
          key: spec.grouping.map((g) => (r[g] === null || r[g] === undefined ? '' : String(r[g]))),
          values: Object.fromEntries(spec.measures.map((m) => [m, Number(r[m])])),
        };
      });
  }

  it('produces a plan Python can parse', () => {
    // Chained `when` arms are the failure this catches: two `pl.when(...)`
    // calls on consecutive lines parse as two expression statements, and the
    // first is evaluated and thrown away. The plan still *reads* correctly.
    const target = join(dir, 'target.py');
    writeFileSync(target, retargetPolars(compileReport(spec, view, registry, 'polars'), csv, schema));
    expect(() =>
      runPython(`import ast\nast.parse(open(${JSON.stringify(target)}).read())`),
    ).not.toThrow();
  });

  it('reads the fixture back with the types the plan assumes', () => {
    const out = runPython(
      `import polars as pl\n` +
      `df = pl.scan_csv(r"${csv}", schema_overrides={${schema
        .map((c) => `"${c.name}": ${{ DATE: 'pl.Date', DOUBLE: 'pl.Float64', BOOLEAN: 'pl.Boolean', VARCHAR: 'pl.String' }[c.type]}`)
        .join(', ')}}).collect()\n` +
      `print(df.height)\nprint(df["maturity_date"].null_count())`,
    ).trim().split('\n');

    expect(Number(out[0])).toBe(rows.length);
    // Open positions have to survive the CSV round trip as nulls, not as the
    // string "", or the bucketing arm that reads for null never fires.
    expect(Number(out[1])).toBe(rows.filter((r) => !r.maturity_date).length);
  });

  it('agrees with the evaluator on the filed table', () => {
    const expected = runReport(spec, view, registry, 'nominal', AS_OF);
    const actual = engineTable();
    const divergences = compareTables(
      expected.rows.map((r) => ({ key: r.key, values: r.values })),
      actual,
      expected.measures,
      tolerances(spec, view),
    );
    expect(actual.length).toBeGreaterThan(20);
    expect(explain(divergences)).toBe('conformant');
  });

  it('agrees with the evaluator on the totals', () => {
    const expected = runReport(spec, view, registry, 'nominal', AS_OF);
    const actual = engineTable();
    expected.measures.forEach((m) => {
      const a = expected.rows.reduce((s, r) => s + (Number.isFinite(r.values[m]) ? r.values[m] : 0), 0);
      const b = actual.reduce((s, r) => s + (Number.isFinite(r.values[m]) ? r.values[m] : 0), 0);
      expect(a).toBeGreaterThan(0);
      expect(Math.abs(a - b), `${m}: ${a} vs ${b}`).toBeLessThanOrEqual(0.005);
    });
  });

  it('leaves the compiled logic untouched — only the reader is swapped', () => {
    const plan = compileReport(spec, view, registry, 'polars');
    const code = retargetPolars(plan, csv, schema);
    expect(code).not.toContain('scan_iceberg');
    expect(code).toContain('scan_csv');
    // Every line of the plan that is not the reader survives verbatim.
    executableLines(executableQuery(plan)).forEach((line) => {
      if (line.includes('scan_iceberg')) return;
      expect(code).toContain(line);
    });
  });

  it('refuses to run a plan whose reader it does not recognise', () => {
    expect(() => retargetPolars('df = (\n  pl.read_parquet("x")\n)', csv, schema)).toThrow(/reader/);
  });
});

function executableLines(plan: string): string[] {
  return plan.split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
}

// ---------------------------------------------------------------------------
// PySpark — syntax only
// ---------------------------------------------------------------------------

const HAS_PYTHON = (() => {
  try {
    execFileSync('python3', ['--version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
})();

describe.skipIf(!HAS_PYTHON)('pyspark emission', () => {
  const plan = compileReport(spec, view, registry, 'pyspark');

  it('is valid Python', () => {
    const target = join(dir, 'spark_plan.py');
    writeFileSync(target, plan);
    expect(() =>
      runPython(`import ast\nast.parse(open(${JSON.stringify(target)}).read())`),
    ).not.toThrow();
  });

  it('chains its conditions instead of restating them', () => {
    // A rule set is one expression. Two arms on consecutive lines must be
    // joined by `.when(` — a second `F.when(` starts a new expression, and the
    // arms before it become dead code that Python evaluates and discards. The
    // plan still reads exactly right, which is why only a parser or an engine
    // ever finds this.
    const isArm = (s: string) => /^\.?(F\.)?when\(/.test(s);
    const lines = executableLines(plan);
    const arms = lines.filter(isArm);
    expect(arms.length).toBeGreaterThan(10);
    expect(arms.filter((l) => l.startsWith('.when(')).length).toBeGreaterThan(10);

    lines.forEach((l, i) => {
      if (i === 0 || !isArm(l) || !isArm(lines[i - 1])) return;
      expect(l.startsWith('.when('), `arm ${i} starts a new chain: ${l.slice(0, 60)}`).toBe(true);
    });
  });

  it('does not reach for a column-level replace, which Spark does not have', () => {
    // `Column.replace` is a DataFrame method in disguise; calling it on a
    // column raises at run time, and no amount of reading the plan reveals it.
    expect(plan).not.toMatch(/\.replace\(\{/);
    expect(plan).toContain('F.lit(0.03)');
  });

  it('states the empty-sum convention explicitly', () => {
    expect(plan).toContain('F.coalesce(F.sum(');
  });
});

describe.skipIf(HAS_POLARS)('polars conformance (skipped)', () => {
  it('reports why it did not run', () => {
    expect(HAS_POLARS).toBe(false);
  });
});
