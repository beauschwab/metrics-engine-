/**
 * The shared row stage — `kind: prepared_source` and the `prepared:` reference.
 *
 * Two things have to hold, and they pull in opposite directions.
 *
 * The extraction must be *invisible to the numbers*: moving four derivations
 * out of `fr2052a_outflows` and into `fr2052a_prepared` may not move a filed
 * amount by a cent, and the compiled plan must come out byte-identical to the
 * one the inline version produced. That is what makes it a refactor rather than
 * a change to a governed definition.
 *
 * And the reference must be *visible to the diagnostics*: every way a shared
 * stage can quietly produce a wrong answer — a stage over another table, a
 * column defined twice, a stage not in force — has to be an error with a line
 * number, because none of them fails loudly on its own.
 */

import { describe, expect, it } from 'vitest';
import { diagnose, type Diagnostic } from './diagnostics';
import { INITIAL_DOCS } from './documents';
import { Evaluator } from './evaluate';
import { AS_OF } from './fixtures';
import { parseDoc } from './parse';
import { buildRegistry, resolvePreparedSource } from './registry';
import { derivationsFor, derivationsOf } from './rows';
import { compileReport, readReport, rowStageSql, type Backend } from './compile';
import { CLASSIFICATION_BLOCKING } from './classification-diagnostics';
import { buildLineage, chainFor } from './lineage';

const VIEW = INITIAL_DOCS.fr2052a_outflows;
const PREPARED = INITIAL_DOCS.fr2052a_prepared;

function workspace(over: Partial<Record<string, string>> = {}) {
  return { ...INITIAL_DOCS, ...over } as Record<string, string>;
}

function analyse(file: string, docs = workspace()) {
  const registry = buildRegistry(docs);
  const g = parseDoc(docs[file]);
  const ev = new Evaluator(g, 'nominal', registry);
  return { g, ev, registry, diags: diagnose(g, ev, undefined, registry) };
}

const withCode = (d: Diagnostic[], code: string) => d.filter((x) => x.code === code);

/**
 * The workspace as it was before the extraction: the four derivations written
 * back into the view, the prepared source gone. Every "did this change
 * anything?" assertion below is against this.
 */
const INLINE_DERIVATIONS = `derivations:
  - name: days_to_maturity
    op: days_between
    field: maturity_date
    anchor: as_of_date

  - name: maturity_bucket
    op: date_bucket
    field: maturity_date
    anchor: as_of_date
    ladder: fr2052a_maturity

  - name: product_id
    op: classify
    using: fr2052a_product_id

  - name: outflow_rate
    op: param_lookup
    using: lcr_outflow_rates
    keys: [product_id]

  - name: weighted_amount`;

function inlineWorkspace(): Record<string, string> {
  const docs = workspace();
  docs.fr2052a_outflows = VIEW
    .replace('prepared: fr2052a_prepared\n', '')
    .replace('derivations:\n  - name: weighted_amount', INLINE_DERIVATIONS);
  delete docs.fr2052a_prepared;
  return docs;
}

describe('the extraction changed nothing', () => {
  it('rewrites back to a view that really does declare all five derivations', () => {
    // Guards the fixture itself: if the rewrite silently stopped applying, every
    // comparison below would be trivially true and prove nothing.
    const inline = parseDoc(inlineWorkspace().fr2052a_outflows);
    expect(derivationsOf(inline).map((d) => d.name)).toEqual([
      'days_to_maturity', 'maturity_bucket', 'product_id', 'outflow_rate', 'weighted_amount',
    ]);
    expect(inline.view.prepared).toBeUndefined();
  });

  it('composes the same stage, in the same order, as writing it inline', () => {
    const shared = derivationsFor(
      parseDoc(VIEW), buildRegistry(workspace()), AS_OF,
    );
    const inline = derivationsOf(parseDoc(inlineWorkspace().fr2052a_outflows));
    expect(shared.map((d) => `${d.name}:${d.op}:${d.using}${d.expression}`))
      .toEqual(inline.map((d) => `${d.name}:${d.op}:${d.using}${d.expression}`));
  });

  it('emits byte-identical row-stage SQL', () => {
    const shared = rowStageSql(parseDoc(VIEW), buildRegistry(workspace()));
    const inlineDocs = inlineWorkspace();
    const inline = rowStageSql(parseDoc(inlineDocs.fr2052a_outflows), buildRegistry(inlineDocs));
    expect(shared).toEqual(inline);
    // And it is not vacuously empty.
    expect(shared.map((c) => c.name)).toContain('product_id');
  });

  it('files the same numbers', () => {
    const inlineDocs = inlineWorkspace();
    const before = new Evaluator(
      parseDoc(inlineDocs.fr2052a_outflows), 'nominal', buildRegistry(inlineDocs),
    );
    const after = analyse('fr2052a_outflows').ev;
    ['gross_outflow_balance', 'weighted_outflows_30d', 'net_outflows_30d'].forEach((m) => {
      expect(after.value(m).v, m).toBe(before.value(m).v);
      expect(after.value(m).v, m).toBeGreaterThan(0);
    });
  });

  it('compiles the same filed plan, on every backend', () => {
    // The report is what actually gets written, and it inlines the whole stage
    // — so this is the assertion that the extraction cannot have moved a
    // filed number. It runs per backend because each emits the stage its own
    // way and a shared stage must be invisible to all of them.
    const inlineDocs = inlineWorkspace();
    const report = readReport(parseDoc(INITIAL_DOCS.fr2052a_submission));
    const backends: Backend[] = ['sql', 'polars', 'pyspark'];

    backends.forEach((backend) => {
      const shared = compileReport(
        report, parseDoc(VIEW), buildRegistry(workspace()), backend,
      );
      const inline = compileReport(
        report, parseDoc(inlineDocs.fr2052a_outflows), buildRegistry(inlineDocs), backend,
      );
      expect(shared, backend).toEqual(inline);
      expect(shared, backend).toContain('product_id');
    });
  });
});

describe('the shared stage is a registry artifact', () => {
  it('resolves by name and by the date it is in force', () => {
    const registry = buildRegistry(workspace());
    expect(resolvePreparedSource(registry, 'fr2052a_prepared', AS_OF)?.source)
      .toBe('alm.fct_2052a_positions');
    // Before its effective date it is not in force, the same as a rule set.
    expect(resolvePreparedSource(registry, 'fr2052a_prepared', '2023-06-30')).toBeNull();
    expect(resolvePreparedSource(registry, 'nope', AS_OF)).toBeNull();
  });

  it('is diagnosed as a row stage, not as a view with no measures', () => {
    const { diags } = analyse('fr2052a_prepared');
    // It declares no measures, and it is not told off for that.
    expect(diags.filter((d) => d.sev === 'error')).toEqual([]);
  });

  it('reports a bad operator in the document that wrote it', () => {
    const { diags } = analyse('fr2052a_prepared', workspace({
      fr2052a_prepared: PREPARED.replace('op: days_between', 'op: days_betwixt'),
    }));
    expect(withCode(diags, 'KEEL070')[0].message).toContain('days_betwixt');
  });
});

describe('a view still owns what it prepares from', () => {
  it('reports an out-of-force rate table, pointing at the reference it would edit', () => {
    const future = INITIAL_DOCS.lcr_outflow_rates.replace(/from: \d{4}-\d{2}-\d{2}/, 'from: 2099-01-01');
    const docs = workspace({ lcr_outflow_rates: future });
    const { g, diags } = analyse('fr2052a_outflows', docs);

    // Silence here is the failure this whole check exists to prevent: the
    // lookup is in the stage the view reads, so the view's numbers are wrong.
    const found = withCode(diags, 'KEEL066');
    expect(found.length).toBeGreaterThan(0);
    // The squiggle lands on `prepared:`, which is a line this document has.
    const preparedLine = g.info.findIndex((i) => i.key === 'prepared');
    expect(preparedLine).toBeGreaterThan(0);
    expect(found[0].line).toBe(preparedLine);
    expect(g.lines[found[0].line]).toContain('prepared: fr2052a_prepared');
  });

  it('does not flag a column the shared stage makes as missing from the source', () => {
    const { diags } = analyse('fr2052a_outflows');
    const text = diags.map((d) => d.message).join(' ');
    expect(text).not.toContain('product_id');
    expect(text).not.toContain('outflow_rate');
  });
});

describe('the four ways a shared stage goes quietly wrong', () => {
  const badView = (over: string) => workspace({ fr2052a_outflows: over });

  it('KEEL090 names a prepared source that does not exist', () => {
    const { diags } = analyse('fr2052a_outflows', badView(
      VIEW.replace('prepared: fr2052a_prepared', 'prepared: nope'),
    ));
    expect(withCode(diags, 'KEEL090')[0].message).toContain('nope');
  });

  it('KEEL091 names one that exists but is not in force', () => {
    const { diags } = analyse('fr2052a_outflows', workspace({
      fr2052a_prepared: PREPARED.replace('from: 2024-01-01', 'from: 2099-01-01'),
    }));
    expect(withCode(diags, 'KEEL091')[0].message).toContain('no version of it is in force');
    // And it does not then pretend the columns exist.
    expect(derivationsFor(
      parseDoc(VIEW),
      buildRegistry(workspace({
        fr2052a_prepared: PREPARED.replace('from: 2024-01-01', 'from: 2099-01-01'),
      })),
      AS_OF,
    ).map((d) => d.name)).toEqual(['weighted_amount']);
  });

  it('KEEL092 prepares a different table from the one the view reads', () => {
    const { diags } = analyse('fr2052a_outflows', workspace({
      fr2052a_prepared: PREPARED.replace(
        'source: alm.fct_2052a_positions', 'source: alm.fct_liquidity_position',
      ),
    }));
    const found = withCode(diags, 'KEEL092')[0];
    expect(found.message).toContain('alm.fct_liquidity_position');
    expect(found.message).toContain('fields these rows do not have');
  });

  it('KEEL093 defines a column the shared stage already defines', () => {
    const { diags } = analyse('fr2052a_outflows', badView(
      VIEW.replace('  - name: weighted_amount', '  - name: product_id'),
    ));
    const found = withCode(diags, 'KEEL093')[0];
    expect(found.message).toContain('product_id');
    expect(found.message).toContain('one column, two definitions');
  });

  it('KEEL093 refuses a prepared source that names another one', () => {
    const { diags } = analyse('fr2052a_prepared', workspace({
      fr2052a_prepared: PREPARED.replace(
        'source: alm.fct_2052a_positions',
        'source: alm.fct_2052a_positions\nprepared: fr2052a_prepared',
      ),
    }));
    expect(withCode(diags, 'KEEL093')[0].message).toContain('one level deep');
  });

  it('every one of them blocks', () => {
    // A stage that silently computes the wrong column is exactly the class of
    // failure that must not be a warning someone scrolls past.
    ['KEEL090', 'KEEL091', 'KEEL092', 'KEEL093'].forEach((code) => {
      expect(CLASSIFICATION_BLOCKING[code], code).toBe(true);
    });
  });
});

describe('the chain still reads end to end', () => {
  it('gives a rate table folded in through the stage a chain of its own', () => {
    const L = buildLineage(workspace());
    // Before the extraction the view named the rate table directly. Now it does
    // not, and a reader opening the rate table must still be shown what it
    // reaches — that is the whole point of the panel.
    const c = chainFor(L, 'lcr_outflow_rates');
    expect(c.steps.map((s) => s.label)).toEqual([
      'alm.fct_2052a_positions',
      'fr2052a_outflows',
      'fr2052a_submission',
      'reg.fr2052a_daily',
      'fr2052a_variance',
    ]);
    expect(c.steps[1].uses).toContain('fr2052a_prepared');
    expect(c.steps[1].uses).toContain('lcr_outflow_rates');
  });

  it('places the shared stage in Prepare, writing nothing', () => {
    const node = buildLineage(workspace()).byName.fr2052a_prepared;
    expect(node.stage).toBe('prepare');
    expect(node.writes).toBe('');
    expect(node.runtime).toContain('writes nothing');
    expect(node.uses).toEqual(['fr2052a_product_id', 'lcr_outflow_rates']);
  });
});
