/**
 * Compiler and report tests.
 *
 * The claim this layer makes is that the pipeline runs the same definition the
 * author verified, so the assertions are about *agreement*: the emitted plan
 * has to contain the same rules, in the same order, with the same rates, and
 * the report has to reconcile to the view it groups.
 */

import { describe, expect, it } from 'vitest';
import {
  compileReport, emitPredicate, missingGrouping, missingMeasures, readReport,
  type Backend,
} from './compile';
import { diagnose, type Diagnostic } from './diagnostics';
import { INITIAL_DOCS } from './documents';
import { Evaluator } from './evaluate';
import { AS_OF } from './fixtures';
import { parseDoc } from './parse';
import { parsePredicate } from './predicate';
import { buildRegistry } from './registry';
import { grainRisky, runReport } from './report';
import { COLUMNS } from './vocab';

const REPORT = INITIAL_DOCS.fr2052a_submission;
const VIEW = INITIAL_DOCS.fr2052a_outflows;
const BACKENDS: Backend[] = ['sql', 'polars', 'pyspark'];

function workspace(over: Record<string, string> = {}) {
  return { ...INITIAL_DOCS, ...over } as Record<string, string>;
}

function compiled(backend: Backend, docs = workspace()) {
  const registry = buildRegistry(docs);
  const spec = readReport(parseDoc(docs.fr2052a_submission));
  return compileReport(spec, parseDoc(docs.fr2052a_outflows), registry, backend);
}

const withCode = (d: Diagnostic[], code: string) => d.filter((x) => x.code === code);

// ---------------------------------------------------------------------------

describe('predicate emission', () => {
  const ast = (s: string) => parsePredicate(s).ast;

  it('emits equality for each backend', () => {
    expect(emitPredicate(ast("segment = 'RETAIL'"), 'sql')).toBe("segment = 'RETAIL'");
    expect(emitPredicate(ast("segment = 'RETAIL'"), 'polars')).toBe('(pl.col("segment") == \'RETAIL\')');
    expect(emitPredicate(ast("segment = 'RETAIL'"), 'pyspark')).toBe('(F.col("segment") == \'RETAIL\')');
  });

  it('parenthesises boolean operands, because & binds tighter in Python', () => {
    const polars = emitPredicate(ast("a = 1 and b = 2"), 'polars');
    expect(polars).toBe('((pl.col("a") == 1) & (pl.col("b") == 2))');
    expect(emitPredicate(ast('a = 1 or b = 2'), 'sql')).toBe('(a = 1 OR b = 2)');
  });

  it('emits booleans in each language’s spelling', () => {
    expect(emitPredicate(ast('insured_flag = true'), 'sql')).toContain('TRUE');
    expect(emitPredicate(ast('insured_flag = true'), 'polars')).toContain('True');
  });

  it('emits in-lists and null tests', () => {
    expect(emitPredicate(ast("s in ('A', 'B')"), 'sql')).toBe("s IN ('A', 'B')");
    expect(emitPredicate(ast("s in ('A', 'B')"), 'polars')).toBe('pl.col("s").is_in([\'A\', \'B\'])');
    expect(emitPredicate(ast("s in ('A', 'B')"), 'pyspark')).toBe('F.col("s").isin([\'A\', \'B\'])');
    expect(emitPredicate(ast('m is null'), 'sql')).toBe('m IS NULL');
    expect(emitPredicate(ast('m is not null'), 'sql')).toBe('m IS NOT NULL');
    expect(emitPredicate(ast('m is null'), 'pyspark')).toBe('F.col("m").isNull()');
  });

  it('negates', () => {
    expect(emitPredicate(ast('not a = 1'), 'sql')).toBe('NOT (a = 1)');
    expect(emitPredicate(ast('not a = 1'), 'polars')).toBe('~((pl.col("a") == 1))');
  });
});

describe('compiled plans', () => {
  it('emit for every backend without throwing', () => {
    BACKENDS.forEach((b) => expect(compiled(b).length).toBeGreaterThan(200));
  });

  it('carry every rule, in declared order', () => {
    const registry = buildRegistry(workspace());
    const rules = registry.classifications.fr2052a_product_id[0].rules;

    BACKENDS.forEach((b) => {
      const plan = compiled(b);
      const positions = rules.map((r) => plan.indexOf(r.emit));
      positions.forEach((p, i) => {
        expect(p, `${rules[i].id} missing from ${b}`).toBeGreaterThan(-1);
      });
      // First-match-wins survives only if the arms keep their order.
      const ordered = [...positions].sort((x, y) => x - y);
      expect(positions, `rule order lost in ${b}`).toEqual(ordered);
    });
  });

  it('inline every rate rather than joining a table', () => {
    const rates = buildRegistry(workspace()).parameterSets.lcr_outflow_rates[0];
    BACKENDS.forEach((b) => {
      const plan = compiled(b);
      Object.keys(rates.table).forEach((key) => {
        expect(plan, `${key} missing from ${b}`).toContain(String(rates.table[key]));
      });
      expect(plan.toUpperCase(), `${b} should not join`).not.toContain(' JOIN ');
    });
  });

  it('carry the citations into the plan an auditor reads', () => {
    expect(compiled('sql')).toContain('12 CFR 249.32(a)(1)');
    expect(compiled('sql')).toContain('OD-1');
  });

  it('chain derivations so each can read the one before it', () => {
    const sql = compiled('sql');
    // outflow_rate must exist before balance_usd * outflow_rate can read it,
    // which a single flat SELECT cannot express.
    expect(sql.indexOf('AS outflow_rate')).toBeLessThan(sql.indexOf('AS weighted_amount'));
    expect(sql).toMatch(/WITH base AS/);
    expect(sql).toMatch(/d1 AS \(/);
  });

  it('never references an alias declared beside it', () => {
    // SQL resolves a SELECT's aliases only in later stages, so any helper a
    // derivation needs must be defined in an earlier CTE, not next to it.
    const sql = compiled('sql');
    const stages = sql.split(/\nd\d+ AS \(/);

    stages.forEach((stage, i) => {
      const defined = [...stage.matchAll(/ AS (\w+)\n/g)].map((m) => m[1]);
      defined.forEach((name) => {
        const body = stage.slice(0, stage.indexOf(` AS ${name}`));
        // Word boundaries matter: `maturity_bucket__days` contains
        // `maturity_bucket` as a substring without referencing it.
        expect(
          new RegExp(`\\b${name}\\b`).test(body),
          `${name} reads an alias from its own SELECT (stage ${i})`,
        ).toBe(false);
      });
    });
  });

  it('leave an unmatched record NULL rather than bucketing it', () => {
    // An ELSE arm would sweep unmapped records into a product the author never
    // chose — the one thing coverage exists to prevent.
    const sql = compiled('sql');
    const caseBlock = sql.slice(sql.indexOf('AS product_id') - 3000, sql.indexOf('AS product_id'));
    expect(caseBlock).not.toMatch(/ELSE\s+'O\./);
  });

  it('group and aggregate at the declared grain', () => {
    const sql = compiled('sql');
    expect(sql).toContain('GROUP BY 1, 2, 3, 4');
    expect(sql).toContain('SUM(balance_usd)');
    expect(sql).toContain('FILTER (WHERE');
    expect(compiled('polars')).toContain('.group_by(["product_id", "maturity_bucket", "currency", "entity_id"])');
    expect(compiled('pyspark')).toContain('.groupBy("product_id", "maturity_bucket", "currency", "entity_id")');
  });

  it('write to Iceberg, partitioned', () => {
    expect(compiled('sql')).toContain('INSERT OVERWRITE reg.fr2052a_daily');
    expect(compiled('pyspark')).toContain('.writeTo("reg.fr2052a_daily")');
    expect(compiled('pyspark')).toContain('.partitionedBy("as_of_date")');
    expect(compiled('pyspark')).toContain('.overwritePartitions()');
    expect(compiled('polars')).toContain('write_iceberg("reg.fr2052a_daily"');
  });

  it('pin the as-of date rather than reading whatever is latest', () => {
    BACKENDS.forEach((b) => expect(compiled(b)).toContain(AS_OF));
  });

  it('follow an edited rule into the plan', () => {
    const edited = INITIAL_DOCS.fr2052a_product_id.replace("'TRANSACTIONAL'", "'SAVINGS'");
    const plan = compiled('sql', workspace({ fr2052a_product_id: edited }));
    expect(plan).toContain("'SAVINGS'");
    expect(plan).not.toContain("'TRANSACTIONAL'");
  });

  it('drop a rule from the plan when it is dropped from the rule set', () => {
    const without = INITIAL_DOCS.fr2052a_product_id.replace(
      /  - id: OD-1[\s\S]*?citation: 12 CFR 249\.32\(a\)\(1\)\n\n/,
      '',
    );
    const plan = compiled('sql', workspace({ fr2052a_product_id: without }));
    expect(plan).not.toContain('OD-1');
    expect(plan).toContain('OD-2');
  });
});

describe('the report', () => {
  function result(docs = workspace()) {
    const registry = buildRegistry(docs);
    return runReport(
      readReport(parseDoc(docs.fr2052a_submission)),
      parseDoc(docs.fr2052a_outflows),
      registry,
      'nominal',
      AS_OF,
    );
  }

  it('produces rows at the declared grain', () => {
    const r = result();
    expect(r.columns).toEqual(['product_id', 'maturity_bucket', 'currency', 'entity_id']);
    expect(r.rows.length).toBeGreaterThan(0);
    expect(r.rows[0].key).toHaveLength(4);
    r.rows.forEach((row) => expect(row.records).toBeGreaterThan(0));
  });

  it('every record lands in exactly one row', () => {
    const r = result();
    expect(r.rows.reduce((a, x) => a + x.records, 0)).toBe(r.records);
  });

  it('reconciles to the view it groups', () => {
    // The filed table must add up to the same number the measure reports, or
    // the submission and the dashboard disagree.
    const registry = buildRegistry(workspace());
    const view = parseDoc(VIEW);
    const ev = new Evaluator(view, 'nominal', registry);
    const r = result();

    expect(r.totals.weighted_outflows_30d).toBeCloseTo(ev.value('weighted_outflows_30d').v, 2);
    expect(r.totals.gross_outflow_balance).toBeCloseTo(ev.value('gross_outflow_balance').v, 2);
  });

  it('is sorted by the leading measure', () => {
    const r = result();
    const first = r.measures[0];
    for (let i = 1; i < r.rows.length; i++) {
      expect(r.rows[i - 1].values[first]).toBeGreaterThanOrEqual(r.rows[i].values[first]);
    }
  });

  it('carries the classification coverage into the header', () => {
    expect(result().coverage?.unmatched).toBe(0);
  });

  it('names measures the view does not define', () => {
    const spec = readReport(parseDoc(REPORT.replace('gross_outflow_balance', 'nope')));
    expect(missingMeasures(spec, parseDoc(VIEW))).toEqual(['nope']);
    expect(result(workspace({
      fr2052a_submission: REPORT.replace('gross_outflow_balance', 'nope'),
    })).missing).toEqual(['nope']);
  });

  it('accepts derived and source columns in the grouping, and nothing else', () => {
    const cols = COLUMNS['alm.fct_2052a_positions'];
    const view = parseDoc(VIEW);
    // product_id and maturity_bucket exist only because derivations make them.
    expect(missingGrouping(readReport(parseDoc(REPORT)), view, cols)).toEqual([]);
    const bad = readReport(parseDoc(REPORT.replace('currency,', 'nonesuch,')));
    expect(missingGrouping(bad, view, cols)).toEqual(['nonesuch']);
  });

  it('flags a measure whose cap stops meaning the same thing per group', () => {
    const withCapped = REPORT.replace(
      'measures: [gross_outflow_balance, weighted_outflows_30d]',
      'measures: [gross_outflow_balance, capped_inflows_30d]',
    );
    const risky = grainRisky(readReport(parseDoc(withCapped)), parseDoc(VIEW));
    expect(risky).toContain('capped_inflows_30d');
    // The shipped report only files simple aggregates, so it is clean.
    expect(grainRisky(readReport(parseDoc(REPORT)), parseDoc(VIEW))).toEqual([]);
  });
});

describe('report diagnostics', () => {
  function analyse(docs = workspace()) {
    const registry = buildRegistry(docs);
    const g = parseDoc(docs.fr2052a_submission);
    const ev = new Evaluator(g, 'nominal', registry);
    return diagnose(g, ev, undefined, registry);
  }

  it('the shipped report is clean', () => {
    expect(analyse().filter((d) => d.sev === 'error')).toEqual([]);
  });

  it('KEEL080 a view that does not exist', () => {
    const d = analyse(workspace({ fr2052a_submission: REPORT.replace('view: fr2052a_outflows', 'view: nope') }));
    expect(withCode(d, 'KEEL080')).toHaveLength(1);
  });

  it('KEEL082 a grouping column nothing produces', () => {
    const d = analyse(workspace({ fr2052a_submission: REPORT.replace('currency,', 'nonesuch,') }));
    expect(withCode(d, 'KEEL082')[0].message).toContain('nonesuch');
  });

  it('KEEL083 a measure the view does not define', () => {
    const d = analyse(workspace({ fr2052a_submission: REPORT.replace('weighted_outflows_30d]', 'nope]') }));
    expect(withCode(d, 'KEEL083')[0].message).toContain('nope');
  });

  it('KEEL084 a portfolio-level cap grouped per row', () => {
    const d = analyse(workspace({
      fr2052a_submission: REPORT.replace('weighted_outflows_30d]', 'capped_inflows_30d]'),
    }));
    expect(withCode(d, 'KEEL084')).toHaveLength(1);
    expect(withCode(d, 'KEEL084')[0].sev).toBe('warn');
  });

  it('KEEL086 a target with no partition column', () => {
    const d = analyse(workspace({
      fr2052a_submission: REPORT.replace('  partition_by: [as_of_date]\n', ''),
    }));
    const hit = withCode(d, 'KEEL086');
    expect(hit).toHaveLength(1);
    expect(hit[0].fix).toBeDefined();
  });

  it('KEEL085 no materialize target at all', () => {
    const d = analyse(workspace({
      fr2052a_submission: REPORT.replace(/materialize:[\s\S]*?mode: overwrite_partitions\n/, ''),
    }));
    expect(withCode(d, 'KEEL085')).toHaveLength(1);
  });
});
