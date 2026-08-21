/**
 * Source bindings.
 *
 * Two families of assertion, and the second matters more.
 *
 * The first is that an adapter says what it should: renames, vocabulary
 * translation, no `ELSE` fallthrough. Those are checkable by reading.
 *
 * The second is `checkBinding` — whether this binding can *faithfully* stand in
 * for the canonical source. That one exists because of a failure nothing
 * downstream can see: a vocabulary map that never produces `'SMALL_BUSINESS'`
 * means the rule testing for it never fires on that one system, forever, and
 * every number still computes and every coverage report still looks clean.
 */

import { describe, expect, it } from 'vitest';
import {
  adapterModel, adapterStatements, checkBinding, emitAdapterSql, readBinding,
  sourceUsage,
} from './binding';
import { readReport } from './compile';
import { INITIAL_DOCS } from './documents';
import { AS_OF } from './fixtures';
import { parseDoc } from './parse';
import { buildRegistry } from './registry';

const docs = INITIAL_DOCS as unknown as Record<string, string>;
const registry = buildRegistry(docs);
const view = parseDoc(docs.fr2052a_outflows);
const spec = readReport(parseDoc(docs.fr2052a_submission));
const usage = sourceUsage(view, registry, AS_OF, [...spec.grouping, ...spec.partitionBy]);

const BINDING = `version: 1
kind: source_binding
name: murex_eu
binds: alm.fct_2052a_positions
table: murex.v_liq_positions

columns:
  - canonical: as_of_date
    column: COB_DATE
  - canonical: balance_usd
    column: BAL_AMT_USD
  - canonical: maturity_date
    column: MAT_DATE
  - canonical: segment
    column: CUST_SEG
    map: {RTL: RETAIL, SBB: SMALL_BUSINESS, WSL: WHOLESALE}
  - canonical: direction
    column: FLOW_DIR
    map: {I: INFLOW, O: OUTFLOW}
  - canonical: insured_flag
    column: FDIC_INS
  - canonical: is_secured
    column: SECURED_FLG
  - canonical: counterparty_type
    column: CPTY_TYPE
  - canonical: account_type
    column: ACCT_TYPE
  - canonical: collateral_class
    column: COLL_CLASS
  - canonical: currency
    column: CCY
  - canonical: entity_id
    column: LEGAL_ENT
`;

const bind = (text = BINDING) => readBinding(parseDoc(text));
const errorsOf = (text = BINDING) =>
  checkBinding(bind(text), usage).filter((i) => i.sev === 'error').map((i) => i.message);

// ---------------------------------------------------------------------------

describe('what the rules actually read', () => {
  it('names the source columns and nothing derived', () => {
    // `product_id` is computed by the classification — no client table has to
    // provide it, and demanding it would fail every honest binding.
    expect(usage.needed).toContain('balance_usd');
    expect(usage.needed).toContain('segment');
    expect(usage.needed).not.toContain('product_id');
    expect(usage.needed).not.toContain('maturity_bucket');
    expect(usage.needed).not.toContain('outflow_rate');
  });

  it('includes columns only the report reads', () => {
    // The view never touches `currency` or `entity_id`; the compiled plan
    // SELECTs them straight off the source for its grouping. An adapter that
    // skipped them would fail on the first run.
    expect(usage.needed).toContain('currency');
    expect(usage.needed).toContain('entity_id');
  });

  it('collects the values the rules compare against, per column', () => {
    expect(usage.literals.segment).toEqual(['RETAIL', 'SMALL_BUSINESS', 'WHOLESALE']);
    expect(usage.literals.direction).toEqual(['INFLOW', 'OUTFLOW']);
  });
});

describe('the adapter', () => {
  it('renames a column and leaves a matching one alone', () => {
    const sql = emitAdapterSql(bind());
    expect(sql).toContain('BAL_AMT_USD AS balance_usd');
    expect(sql).toContain('FROM murex.v_liq_positions');
  });

  it('translates a vocabulary as a CASE', () => {
    const sql = emitAdapterSql(bind());
    expect(sql).toContain("WHEN 'RTL' THEN 'RETAIL'");
    expect(sql).toContain("WHEN 'SBB' THEN 'SMALL_BUSINESS'");
    expect(sql).toContain('END AS segment');
  });

  it('sends an unmapped client code to NULL, not through', () => {
    // Passing the raw code through would make an unknown value fail every rule
    // while looking like data. NULL lands it in classification coverage as
    // unmapped, which is where this surface already makes gaps visible.
    expect(emitAdapterSql(bind())).toContain('ELSE NULL');
  });

  it('creates the canonical schema, because a client database has its own', () => {
    // An adapter that assumes `alm` exists fails on the first genuinely foreign
    // system — which is the only kind of system bindings are for.
    expect(emitAdapterSql(bind())).toContain('CREATE SCHEMA IF NOT EXISTS alm');
  });

  it('carries no semicolon in its prose', () => {
    // A generated artifact gets pasted into tools that split on `;`, and one
    // inside a comment turns the rest of the sentence into a syntax error at
    // the consumer. This was a real failure.
    const comments = emitAdapterSql(bind()).split('\n').filter((l) => l.startsWith('--'));
    comments.forEach((line) => expect(line, line).not.toContain(';'));
  });

  it('is also served pre-split, so no client parses SQL', () => {
    const statements = adapterStatements(bind());
    expect(statements).toHaveLength(2);
    expect(statements[0]).toBe('CREATE SCHEMA IF NOT EXISTS alm');
    expect(statements[1]).toMatch(/^CREATE OR REPLACE VIEW alm\.fct_2052a_positions AS/);
    statements.forEach((s) => expect(s.trim().endsWith(';')).toBe(false));
  });

  it('offers the same mapping as data, for clients that reshape a frame', () => {
    const model = adapterModel(bind());
    expect(model.renames.BAL_AMT_USD).toBe('balance_usd');
    expect(model.maps.segment).toEqual({ RTL: 'RETAIL', SBB: 'SMALL_BUSINESS', WSL: 'WHOLESALE' });
    // A column whose name already matches needs no rename entry.
    expect(Object.keys(model.renames)).not.toContain('as_of_date');
  });
});

describe('whether a binding can be trusted', () => {
  it('accepts a complete one', () => {
    expect(errorsOf()).toEqual([]);
  });

  it('names a column the rules read and the binding does not map', () => {
    const missing = BINDING.replace(/  - canonical: is_secured\n    column: SECURED_FLG\n/, '');
    expect(errorsOf(missing).join(' ')).toMatch(/is_secured/);
  });

  it('refuses a vocabulary that can never produce a value a rule tests for', () => {
    // The silent failure. Without SBB→SMALL_BUSINESS the small-business rule
    // never fires on this system, and nothing downstream would ever say so.
    const partial = BINDING.replace(
      'map: {RTL: RETAIL, SBB: SMALL_BUSINESS, WSL: WHOLESALE}',
      'map: {RTL: RETAIL, WSL: WHOLESALE}',
    );
    const errors = errorsOf(partial);
    expect(errors.join(' ')).toMatch(/SMALL_BUSINESS/);
    expect(errors.join(' ')).toMatch(/can never fire/);
  });

  it('says nothing about a column with no map — the values pass through', () => {
    // `counterparty_type` is unmapped, so the client's values are assumed to be
    // the canonical ones. That is a claim the binding makes and this check
    // cannot verify without the data; the live coverage read is what does.
    expect(errorsOf()).toEqual([]);
  });

  it('mentions a mapped column nothing reads, without refusing it', () => {
    const extra = `${BINDING}  - canonical: unused_thing\n    column: SOME_COL\n`;
    const issues = checkBinding(bind(extra), usage);
    expect(issues.some((i) => i.sev === 'info' && /unused_thing/.test(i.message))).toBe(true);
    expect(issues.filter((i) => i.sev === 'error')).toEqual([]);
  });

  it('refuses a binding that names no table or no canonical source', () => {
    expect(errorsOf(BINDING.replace('table: murex.v_liq_positions', 'table:')).join(' '))
      .toMatch(/no client table/);
    expect(errorsOf(BINDING.replace('binds: alm.fct_2052a_positions', 'binds:')).join(' '))
      .toMatch(/no canonical source/);
  });
});

describe('reading the document', () => {
  it('parses an inline flow map', () => {
    expect(bind().columns.find((c) => c.canonical === 'direction')?.map)
      .toEqual({ I: 'INFLOW', O: 'OUTFLOW' });
  });

  it('treats a column with no map as a plain rename', () => {
    expect(bind().columns.find((c) => c.canonical === 'balance_usd')?.map).toBeNull();
  });

  it('reads the two ends it binds', () => {
    const b = bind();
    expect(b.binds).toBe('alm.fct_2052a_positions');
    expect(b.table).toBe('murex.v_liq_positions');
  });
});
