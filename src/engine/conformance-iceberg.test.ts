/**
 * The Iceberg seam.
 *
 * The Polars leg proves the *logic* — same rules, same rates, same numbers as
 * the evaluator. It proves nothing about either end of the plan, because it
 * rewrites `scan_iceberg` to `scan_csv` and throws the materialize step away.
 * Those two lines are precisely where the definition layer touches a data
 * platform, and "registered here, executed in your pipeline, sinking to
 * Iceberg" is the claim the whole architecture rests on.
 *
 * So this file runs the plan whole. It builds a real Iceberg catalogue — a
 * SQLite metastore over a local warehouse — writes the fixture in as a
 * partitioned table, binds `CATALOG` and `SNAPSHOT`, executes the compiler's
 * unmodified output including the write, and then reads the sink table back and
 * reconciles it against the in-browser evaluator.
 *
 * It also checks the two things only a real catalogue can answer: that a
 * pinned snapshot still reproduces a number after the source has moved on, and
 * that filing one day leaves every other day alone.
 *
 * Skips itself when pyiceberg is absent. The dependency chain is heavier than
 * the rest of the suite (pyiceberg, pyarrow, sqlalchemy), and a contributor
 * without it should still be able to run everything else.
 */

import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { compileReport, readReport } from './compile';
import { inferSchema, splitPlan, toCsv, type Column } from './conformance';
import { INITIAL_DOCS } from './documents';
import { AS_OF, TABLES } from './fixtures';
import { parseDoc } from './parse';
import { buildRegistry } from './registry';
import { runReport } from './report';

const SOURCE = 'alm.fct_2052a_positions';
const SINK = 'reg.fr2052a_daily';

function pythonHas(mod: string): boolean {
  try {
    execFileSync('python3', ['-c', `import ${mod}`], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

const HAS_ICEBERG =
  pythonHas('polars') && pythonHas('pyiceberg') && pythonHas('pyarrow') && pythonHas('sqlalchemy');

const dir = mkdtempSync(join(tmpdir(), 'keel-iceberg-'));

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

const registry = buildRegistry(INITIAL_DOCS as unknown as Record<string, string>);
const view = parseDoc(INITIAL_DOCS.fr2052a_outflows);
const spec = readReport(parseDoc(INITIAL_DOCS.fr2052a_submission));

const ICEBERG_TYPE: Record<Column['type'], string> = {
  DATE: 'DateType()',
  DOUBLE: 'DoubleType()',
  BOOLEAN: 'BooleanType()',
  VARCHAR: 'StringType()',
};

/**
 * A catalogue, and the source table inside it.
 *
 * Emitted as Python rather than driven through a binding, because the point is
 * that a pipeline written in Python can host the compiled plan unchanged. The
 * source is partitioned by `as_of_date` the way a real position table would be,
 * so partition pruning and snapshot pinning both have something to act on.
 */
function preamble(schema: Column[], csv: string): string {
  const fields = schema
    .map((c, i) => `    NestedField(${i + 1}, "${c.name}", ${ICEBERG_TYPE[c.type]}, required=False),`)
    .join('\n');
  const dtypes = schema
    .map((c) => `"${c.name}": ${{ DATE: 'pl.Date', DOUBLE: 'pl.Float64', BOOLEAN: 'pl.Boolean', VARCHAR: 'pl.String' }[c.type]}`)
    .join(', ');
  const asOfId = schema.findIndex((c) => c.name === 'as_of_date') + 1;

  return `import os, json, sys
import polars as pl
from pyiceberg.catalog.sql import SqlCatalog
from pyiceberg.schema import Schema
from pyiceberg.types import NestedField, DateType, DoubleType, BooleanType, StringType
from pyiceberg.partitioning import PartitionSpec, PartitionField
from pyiceberg.transforms import IdentityTransform

WAREHOUSE = os.path.join(r"${dir}", "warehouse")
os.makedirs(WAREHOUSE, exist_ok=True)
CATALOG = SqlCatalog(
    "conformance",
    uri="sqlite:///" + os.path.join(r"${dir}", "catalog.db"),
    warehouse="file://" + WAREHOUSE,
)

SOURCE_SCHEMA = Schema(
${fields}
)
SOURCE_SPEC = PartitionSpec(
    PartitionField(source_id=${asOfId}, field_id=1000, transform=IdentityTransform(), name="as_of_date_part")
)

def ensure(identifier, schema, spec):
    ns = identifier.split(".")[0]
    CATALOG.create_namespace_if_not_exists(ns)
    try:
        return CATALOG.load_table(identifier)
    except Exception:
        return CATALOG.create_table(identifier, schema=schema, partition_spec=spec)

def ensure_sink(identifier, lf, partition_by):
    """Create the sink from the plan's own output schema.

    dynamic_partition_overwrite needs a table that already exists and is
    partitioned — the compiled plan writes, it does not provision. A pipeline
    bootstraps the sink from the shape the definition produces, which is what
    a zero-row collect gives without running the aggregation.
    """
    ns = identifier.split(".")[0]
    CATALOG.create_namespace_if_not_exists(ns)
    try:
        return CATALOG.load_table(identifier)
    except Exception:
        pass
    t = CATALOG.create_table(identifier, schema=lf.limit(0).collect().to_arrow().schema)
    with t.update_spec() as us:
        for c in partition_by:
            us.add_field(c, IdentityTransform(), c + "_part")
    return CATALOG.load_table(identifier)

def load_fixture():
    t = ensure("${SOURCE}", SOURCE_SCHEMA, SOURCE_SPEC)
    if t.current_snapshot() is None:
        df = pl.read_csv(r"${csv}", schema_overrides={${dtypes}})
        t.append(df.to_arrow().cast(t.schema().as_arrow()))
        t = CATALOG.load_table("${SOURCE}")
    return t

SOURCE_TABLE = load_fixture()
SNAPSHOT = None
`;
}

function runPython(code: string, name: string): string {
  const script = join(dir, `${name}.py`);
  writeFileSync(script, code);
  return execFileSync('python3', [script], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
}

/**
 * The compiled plan in the two halves the harness needs — otherwise verbatim.
 *
 * Nothing is stripped, including the imports. Re-importing polars after the
 * preamble already did is harmless, and filtering lines out of the plan is how
 * a harness ends up testing something the compiler did not emit: an earlier
 * version of this dropped every `import` line and took `from datetime import
 * date` with it, which the as-of filter needs.
 */
function halves(): { query: string; materialize: string } {
  return splitPlan(compileReport(spec, view, registry, 'polars'));
}

/** The read half, ready to execute. */
function plan(): string {
  return halves().query;
}

// ---------------------------------------------------------------------------

describe.skipIf(!HAS_ICEBERG)('iceberg conformance', () => {
  const rows = TABLES.nominal[SOURCE][AS_OF];
  const schema = inferSchema(rows);
  const csv = join(dir, 'positions.csv');
  writeFileSync(csv, toCsv(rows, schema));
  const head = preamble(schema, csv);

  it('reads the fixture back out of a real catalogue', () => {
    const out = runPython(
      `${head}
lf = pl.scan_iceberg("${SOURCE}", catalog=CATALOG, snapshot_id=SNAPSHOT)
df = lf.collect()
print(df.height)
print(df["maturity_date"].null_count())
print(SOURCE_TABLE.spec().fields[0].name)
`,
      'read',
    ).trim().split('\n');

    expect(Number(out[0])).toBe(rows.length);
    // Open positions have to survive as nulls through Arrow and Parquet, or the
    // bucketing arm that reads for null never fires.
    expect(Number(out[1])).toBe(rows.filter((r) => !r.maturity_date).length);
    expect(out[2]).toBe('as_of_date_part');
  });

  it('runs the compiled plan against Iceberg and files the same rows', () => {
    const out = runPython(
      `${head}
${plan()}

res = df.collect().sort(["product_id", "maturity_bucket", "currency", "entity_id"])
sys.stdout.write(res.write_ndjson())
`,
      'query',
    );

    const actual = out.split('\n').filter(Boolean).map((l) => JSON.parse(l) as Record<string, unknown>);
    const expected = runReport(spec, view, registry, 'nominal', AS_OF);

    const key = (r: Record<string, unknown>) =>
      spec.grouping.map((g) => (r[g] === null || r[g] === undefined ? '' : String(r[g]))).join(' ');
    const byKey: Record<string, Record<string, unknown>> = {};
    actual.forEach((r) => {
      byKey[key(r)] = r;
    });

    expect(actual.length).toBe(expected.rows.length);
    expected.rows.forEach((r) => {
      const there = byKey[r.key.join(' ')];
      expect(there, `missing group ${r.key.join(' · ')}`).toBeTruthy();
      expected.measures.forEach((m) => {
        expect(Math.abs(Number(there[m]) - r.values[m]), `${r.key.join(' · ')} ${m}`)
          .toBeLessThanOrEqual(0.005);
      });
    });
  });

  it('carries the partition column the sink is partitioned by', () => {
    // The report groups at the grain it is read at, which does not include
    // `as_of_date`; the sink is partitioned by exactly that. Before the
    // compiler carried it through, the write was handed a table with no
    // partition field and there was nothing in the suite to notice.
    const out = runPython(`${head}\n${plan()}\nprint(",".join(df.collect_schema().names()))\n`, 'cols');
    const cols = out.trim().split(',');
    spec.partitionBy.forEach((c) => expect(cols).toContain(c));
    spec.grouping.forEach((c) => expect(cols).toContain(c));
  });

  it('writes to the sink, and the sink reconciles to the evaluator', () => {
    const { query, materialize } = halves();
    const out = runPython(
      `${head}
${query}

ensure_sink("${SINK}", df, ${JSON.stringify(spec.partitionBy)})

${materialize}

t = CATALOG.load_table("${SINK}")
res = pl.from_arrow(t.scan().to_arrow())
print(res.height)
print(res["gross_outflow_balance"].sum())
print(res["weighted_outflows_30d"].sum())
print(sorted(str(d) for d in res["as_of_date"].unique()))
`,
      'write',
    ).trim().split('\n');

    const expected = runReport(spec, view, registry, 'nominal', AS_OF);
    const total = (m: string) =>
      expected.rows.reduce((s, r) => s + (Number.isFinite(r.values[m]) ? r.values[m] : 0), 0);

    expect(Number(out[0])).toBe(expected.rows.length);
    expect(Math.abs(Number(out[1]) - total('gross_outflow_balance'))).toBeLessThanOrEqual(0.005);
    expect(Math.abs(Number(out[2]) - total('weighted_outflows_30d'))).toBeLessThanOrEqual(0.005);
    expect(out[3]).toContain(AS_OF);
  });

  it('replaces only the partition it files, leaving prior days alone', () => {
    // This is what `overwrite_partitions` has to mean. Polars has no such
    // mode — `overwrite` replaces the whole table — so filing Tuesday under
    // the wrong operation silently deletes Monday.
    const { query, materialize } = halves();
    const out = runPython(
      `${head}
import datetime as dt

${query}
ensure_sink("${SINK}", df, ${JSON.stringify(spec.partitionBy)})
${materialize}

# Stand a prior day up beside the one just filed.
t = CATALOG.load_table("${SINK}")
prior = pl.from_arrow(t.scan().to_arrow()).with_columns(
    pl.lit(dt.date.fromisoformat("2026-06-29")).alias("as_of_date")
)
t.append(prior.to_arrow().cast(t.schema().as_arrow()))
t = CATALOG.load_table("${SINK}")
print(pl.from_arrow(t.scan().to_arrow()).height)

# Re-file today. Yesterday must not move.
${materialize}

t = CATALOG.load_table("${SINK}")
after = pl.from_arrow(t.scan().to_arrow())
print(after.height)
print(after.filter(pl.col("as_of_date") == dt.date.fromisoformat("2026-06-29")).height)
`,
      'partition',
    ).trim().split('\n');

    const filed = runReport(spec, view, registry, 'nominal', AS_OF).rows.length;
    // Two days in, re-file one: the total is unchanged and the untouched day
    // still has every one of its rows.
    expect(Number(out[0])).toBe(filed * 2);
    expect(Number(out[1])).toBe(filed * 2);
    expect(Number(out[2])).toBe(filed);
  });

  it('reproduces a filed number from a pinned snapshot after the source moves', () => {
    // The first question about any filed submission is "can you get that number
    // again". An unpinned read cannot answer it, which is why the plan takes a
    // snapshot id rather than always reading the current one.
    const out = runPython(
      `${head}
pinned = SOURCE_TABLE.current_snapshot().snapshot_id

# The source moves: a late correction doubles every balance for the day.
moved = pl.scan_iceberg("${SOURCE}", catalog=CATALOG).collect().with_columns(
    (pl.col("balance_usd") * 2).alias("balance_usd")
)
SOURCE_TABLE.dynamic_partition_overwrite(moved.to_arrow().cast(SOURCE_TABLE.schema().as_arrow()))

def total(snap):
    global SNAPSHOT
    SNAPSHOT = snap
${plan().split('\n').map((l) => `    ${l}`).join('\n')}
    return df.collect()["gross_outflow_balance"].sum()

print(total(pinned))
print(total(None))
`,
      'snapshot',
    ).trim().split('\n');

    const expected = runReport(spec, view, registry, 'nominal', AS_OF);
    const base = expected.rows.reduce(
      (s, r) => s + (Number.isFinite(r.values.gross_outflow_balance) ? r.values.gross_outflow_balance : 0), 0);

    expect(Math.abs(Number(out[0]) - base)).toBeLessThanOrEqual(0.005);
    // And reading the latest snapshot sees the correction, so the pin is doing
    // real work rather than the two reads being accidentally identical.
    expect(Math.abs(Number(out[1]) - base * 2)).toBeLessThanOrEqual(0.01);
  });
});

describe.skipIf(HAS_ICEBERG)('iceberg conformance (skipped)', () => {
  it('reports why it did not run', () => {
    expect(HAS_ICEBERG).toBe(false);
  });
});
