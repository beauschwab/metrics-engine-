/**
 * Compiling a variance monitor.
 *
 * The evaluator computes day-over-day moves and trailing dispersion in the
 * browser, over sixty days of fixture. A production monitor has to do it over
 * years of a real table, which means window functions in the warehouse rather
 * than a loop in JavaScript — and it means the two have to agree, or the alert
 * an analyst sees in the morning is not the alert the pipeline raised overnight.
 *
 * Three things make that agreement possible rather than hopeful.
 *
 * **The frame excludes the current row.** `ROWS BETWEEN 30 PRECEDING AND 1
 * PRECEDING`, not `30 PRECEDING AND CURRENT ROW`. Including today lets an
 * outlier widen the band it is being tested against, so the largest breaks are
 * the ones most likely to be missed — and it is a one-word difference from the
 * version that looks right.
 *
 * **The frame counts rows, not days.** `RANGE … INTERVAL '30' DAY` would be
 * defensible for calendar windows, but it cannot be matched exactly by an
 * evaluator walking an array, and "trailing 30 days" on a business-day series
 * operationally means the last 30 observations anyway. Picking the definition
 * that both sides can implement identically is what makes conformance testable.
 *
 * **`STDDEV_SAMP`, and a minimum observation count.** Population and sample
 * standard deviation differ by a factor of √(n/(n−1)) — small, but enough to
 * flip a marginal breach — so the sample form is named explicitly rather than
 * left to whichever the engine defaults to. And a σ from three observations is
 * arithmetic rather than information, so the emitted plan requires the same
 * minimum the evaluator does.
 */

import { emitPredicate, type Backend } from './compile';
import { compilePredicate } from './predicate';
import { BASIS_WINDOW, MIN_OBSERVATIONS, type MonitorSpec, type ThresholdSpec } from './variance';

/** The measure column the monitor watches, as produced by the rollup stage. */
const VALUE = 'value';
const DELTA = 'dod_change';

function windowFrame(basis: string): string {
  return `ROWS BETWEEN ${BASIS_WINDOW[basis]} PRECEDING AND 1 PRECEDING`;
}

/** `σ` and its observation count, per dynamic basis the monitor actually uses. */
function dispersionColumns(monitor: MonitorSpec, partition: string, order: string): string[] {
  const bases = Array.from(
    new Set(monitor.thresholds.map((t) => t.basis).filter((b) => b in BASIS_WINDOW)),
  );
  return bases.flatMap((basis) => [
    `STDDEV_SAMP(${DELTA}) OVER (\n      PARTITION BY ${partition}\n      ORDER BY ${order}\n      ${windowFrame(basis)}\n    ) AS sigma_${basis}`,
    `COUNT(${DELTA}) OVER (\n      PARTITION BY ${partition}\n      ORDER BY ${order}\n      ${windowFrame(basis)}\n    ) AS n_${basis}`,
  ]);
}

/**
 * One threshold as a boolean column plus the limit it used.
 *
 * The limit is emitted alongside the verdict on purpose. A breach that says only
 * "this exceeded three sigma" cannot be checked by the person receiving it; one
 * that carries the σ and the count it was computed from can.
 */
function thresholdColumns(t: ThresholdSpec): string[] {
  const scope = t.appliesTo
    ? emitPredicate(compilePredicate(t.appliesTo).ast, 'sql')
    : 'TRUE';

  if (t.basis === 'static_abs') {
    return [
      `${t.limit} AS limit_${t.id.replace(/-/g, '_')}`,
      `CASE WHEN ${scope} AND ABS(${DELTA}) > ${t.limit} THEN 1 ELSE 0 END AS breach_${t.id.replace(/-/g, '_')}`,
    ];
  }

  if (t.basis === 'static_pct') {
    return [
      `${t.limit} AS limit_${t.id.replace(/-/g, '_')}`,
      // A percentage move off a zero base is undefined, not large. `NULLIF`
      // keeps it out of the comparison rather than letting it read as a breach
      // on every series that starts from nothing.
      `CASE WHEN ${scope} AND ABS(${DELTA} / NULLIF(ABS(prev_${VALUE}), 0)) * 100.0 > ${t.limit}` +
        ` THEN 1 ELSE 0 END AS breach_${t.id.replace(/-/g, '_')}`,
    ];
  }

  const id = t.id.replace(/-/g, '_');
  const sigma = `sigma_${t.basis}`;
  const n = `n_${t.basis}`;
  return [
    `${t.sigma} * ${sigma} AS limit_${id}`,
    // The observation floor and the zero-σ guard are both here for the same
    // reason: they are the difference between "no threshold" and "a threshold
    // everything breaches", and the evaluator draws it the same way.
    `CASE WHEN ${scope} AND ${n} >= ${MIN_OBSERVATIONS} AND ${sigma} > 0` +
      ` AND ABS(${DELTA}) > ${t.sigma} * ${sigma} THEN 1 ELSE 0 END AS breach_${id}`,
  ];
}

/**
 * The monitor as SQL over the filed table.
 *
 * It reads the *sink* rather than recomputing the rollup from positions. That is
 * deliberate: the thing being monitored is what was filed, and recomputing it
 * would mean a variance alert could disagree with the submission it is supposed
 * to be about.
 */
export interface MonitorEmitOptions {
  /**
   * Emit every evaluated point rather than only the breaches.
   *
   * The pipeline wants the breaches; a reviewer checking why a threshold did or
   * did not fire wants the σ and the observation count on the days it stayed
   * quiet. Same plan, one clause different — which also means the two cannot
   * drift apart.
   */
  allRows?: boolean;
}

export function compileMonitor(
  monitor: MonitorSpec,
  sinkTable: string,
  grain: string[],
  backend: Backend,
  options: MonitorEmitOptions = {},
): string {
  if (backend !== 'sql') return compileMonitorPython(monitor, sinkTable, grain, backend);

  const keys = grain.join(', ');
  const partition = grain.join(', ');
  const order = 'as_of_date';

  // `ROUND(SUM(...), 2)` mirrors the evaluator: a sum of exact cents is still a
  // float64 sum, and the rolled-up value has to be a filed amount too.
  const rollup =
    `rollup AS (\n  SELECT ${keys}, as_of_date, ROUND(SUM(${monitor.measure}), 2) AS ${VALUE}\n` +
    `  FROM ${sinkTable}\n  GROUP BY ${keys}, as_of_date\n)`;

  const changed =
    `changed AS (\n  SELECT *,\n` +
    `    LAG(${VALUE}) OVER (PARTITION BY ${partition} ORDER BY ${order}) AS prev_${VALUE},\n` +
    `    ${VALUE} - LAG(${VALUE}) OVER (PARTITION BY ${partition} ORDER BY ${order}) AS ${DELTA}\n` +
    `  FROM rollup\n)`;

  const dispersion = dispersionColumns(monitor, partition, order);
  const spread = dispersion.length
    ? `spread AS (\n  SELECT *,\n    ${dispersion.join(',\n    ')}\n  FROM changed\n)`
    : 'spread AS (\n  SELECT * FROM changed\n)';

  const judged = monitor.thresholds.flatMap(thresholdColumns);
  const breachFlags = monitor.thresholds
    .map((t) => `breach_${t.id.replace(/-/g, '_')} = 1`)
    .join('\n     OR ');

  return (
    `-- ${monitor.name} · day-over-day variance, compiled for SQL\n` +
    `WITH ${rollup},\n${changed},\n${spread},\njudged AS (\n  SELECT *,\n    ${judged.join(',\n    ')}\n  FROM spread\n)\n` +
    (options.allRows
      ? `SELECT * FROM judged\nORDER BY ${keys}, as_of_date`
      : `SELECT ${keys}, as_of_date, ${VALUE}, prev_${VALUE}, ${DELTA},\n` +
        `  ${monitor.thresholds.map((t) => `limit_${t.id.replace(/-/g, '_')}, breach_${t.id.replace(/-/g, '_')}`).join(',\n  ')}\n` +
        `FROM judged\n` +
        `-- Only the rows worth someone's morning.\n` +
        `WHERE ${breachFlags}\n` +
        `ORDER BY as_of_date DESC, ABS(${DELTA}) DESC`)
  );
}

function compileMonitorPython(
  monitor: MonitorSpec,
  sinkTable: string,
  grain: string[],
  backend: Backend,
): string {
  const polars = backend === 'polars';
  const keys = grain.map((g) => `"${g}"`).join(', ');

  if (polars) {
    const bases = Array.from(
      new Set(monitor.thresholds.map((t) => t.basis).filter((b) => b in BASIS_WINDOW)),
    );
    // `rolling_std` over a shifted column is the same statement as the SQL
    // frame: the window is the changes before this one, never including it.
    const sigmas = bases.map(
      (b) => `    pl.col("${DELTA}").shift(1).rolling_std(window_size=${BASIS_WINDOW[b]}, min_samples=${MIN_OBSERVATIONS})\n` +
             `      .over([${keys}]).alias("sigma_${b}")`,
    );
    const flags = monitor.thresholds.map((t) => {
      const scope = t.appliesTo
        ? emitPredicate(compilePredicate(t.appliesTo).ast, 'polars')
        : 'pl.lit(True)';
      if (t.basis === 'static_abs') {
        return `    (${scope} & (pl.col("${DELTA}").abs() > ${t.limit})).alias("breach_${t.id}")`;
      }
      if (t.basis === 'static_pct') {
        return `    (${scope} & ((pl.col("${DELTA}") / pl.col("prev_${VALUE}").abs()).abs() * 100.0 > ${t.limit}))\n` +
               `      .alias("breach_${t.id}")`;
      }
      return `    (${scope} & (pl.col("sigma_${t.basis}") > 0)\n` +
             `      & (pl.col("${DELTA}").abs() > ${t.sigma} * pl.col("sigma_${t.basis}")))\n` +
             `      .fill_null(False).alias("breach_${t.id}")`;
    });

    return (
      `# ${monitor.name} · day-over-day variance, compiled for Polars\n` +
      `import polars as pl\n\n` +
      `# Bound by the pipeline: CATALOG, a pyiceberg Catalog\n\n` +
      `variance = (\n  pl.scan_iceberg("${sinkTable}", catalog=CATALOG)\n` +
      `  .group_by([${keys}, "as_of_date"])\n` +
      `  .agg(pl.col("${monitor.measure}").sum().round(2).alias("${VALUE}"))\n` +
      `  .sort("as_of_date")\n` +
      `  .with_columns(\n    pl.col("${VALUE}").shift(1).over([${keys}]).alias("prev_${VALUE}"),\n  )\n` +
      `  .with_columns(\n    (pl.col("${VALUE}") - pl.col("prev_${VALUE}")).alias("${DELTA}"),\n  )\n` +
      (sigmas.length ? `  .with_columns(\n${sigmas.join(',\n')},\n  )\n` : '') +
      `  .with_columns(\n${flags.join(',\n')},\n  )\n` +
      `  .filter(${monitor.thresholds.map((t) => `pl.col("breach_${t.id}")`).join(' | ')})\n)`
    );
  }

  const cols = grain.map((g) => `"${g}"`).join(', ');
  const bases = Array.from(
    new Set(monitor.thresholds.map((t) => t.basis).filter((b) => b in BASIS_WINDOW)),
  );
  const sigmas = bases.map(
    (b) => `  .withColumn("sigma_${b}", F.stddev_samp("${DELTA}").over(\n` +
           `    Window.partitionBy(${cols}).orderBy("as_of_date").rowsBetween(-${BASIS_WINDOW[b]}, -1)))\n` +
           `  .withColumn("n_${b}", F.count("${DELTA}").over(\n` +
           `    Window.partitionBy(${cols}).orderBy("as_of_date").rowsBetween(-${BASIS_WINDOW[b]}, -1)))`,
  );
  const flags = monitor.thresholds.map((t) => {
    const scope = t.appliesTo
      ? emitPredicate(compilePredicate(t.appliesTo).ast, 'pyspark')
      : 'F.lit(True)';
    if (t.basis === 'static_abs') {
      return `  .withColumn("breach_${t.id}", ${scope} & (F.abs(F.col("${DELTA}")) > F.lit(${t.limit})))`;
    }
    if (t.basis === 'static_pct') {
      return `  .withColumn("breach_${t.id}", ${scope} & (F.abs(F.col("${DELTA}") / F.abs(F.col("prev_${VALUE}"))) * 100.0 > F.lit(${t.limit})))`;
    }
    return `  .withColumn("breach_${t.id}", ${scope} & (F.col("n_${t.basis}") >= F.lit(${MIN_OBSERVATIONS}))\n` +
           `    & (F.col("sigma_${t.basis}") > F.lit(0))\n` +
           `    & (F.abs(F.col("${DELTA}")) > F.lit(${t.sigma}) * F.col("sigma_${t.basis}")))`;
  });

  return (
    `# ${monitor.name} · day-over-day variance, compiled for PySpark\n` +
    `from pyspark.sql import functions as F\nfrom pyspark.sql.window import Window\n\n` +
    `variance = (\n  spark.table("${sinkTable}")\n` +
    `  .groupBy(${cols}, "as_of_date")\n` +
    `  .agg(F.round(F.sum("${monitor.measure}"), 2).alias("${VALUE}"))\n` +
    `  .withColumn("prev_${VALUE}", F.lag("${VALUE}").over(\n` +
    `    Window.partitionBy(${cols}).orderBy("as_of_date")))\n` +
    `  .withColumn("${DELTA}", F.col("${VALUE}") - F.col("prev_${VALUE}"))\n` +
    (sigmas.length ? `${sigmas.join('\n')}\n` : '') +
    `${flags.join('\n')}\n` +
    `  .filter(${monitor.thresholds.map((t) => `F.col("breach_${t.id}")`).join(' | ')})\n)`
  );
}
