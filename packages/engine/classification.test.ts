/**
 * Classification-layer tests.
 *
 * The load-bearing invariant is coverage, not a value: every record must land
 * on exactly one product ID, and the rule that put it there must be the one
 * the author intended. A misclassification produces a plausible number, so
 * these are the assertions that catch what reading the output cannot.
 */

import { describe, expect, it } from 'vitest';
import { diagnose, type Diagnostic } from './diagnostics';
import { INITIAL_DOCS } from './documents';
import { Evaluator } from './evaluate';
import { AS_OF, TABLES } from './fixtures';
import { parseDoc } from './parse';
import {
  buildRegistry, effectiveProblems, inForce, resolveClassification, resolveParameterSet,
} from './registry';
import {
  bucketFor, classificationMigration, daysBetween, derivationsFor, derivationsOf, deriveRows,
  runClassification,
} from './rows';
import { DOMAINS, type FixtureName } from './vocab';

const RULES = INITIAL_DOCS.fr2052a_product_id;
const RATES = INITIAL_DOCS.lcr_outflow_rates;
const VIEW = INITIAL_DOCS.fr2052a_outflows;
const PREPARED = INITIAL_DOCS.fr2052a_prepared;

function workspace(over: Partial<Record<string, string>> = {}) {
  return { ...INITIAL_DOCS, ...over } as Record<string, string>;
}

function analyse(file: string, docs = workspace(), fixture: FixtureName = 'nominal') {
  const registry = buildRegistry(docs);
  const g = parseDoc(docs[file]);
  const ev = new Evaluator(g, fixture, registry);
  return { g, ev, registry, diags: diagnose(g, ev, parseDoc(INITIAL_DOCS[file as never]), registry) };
}

const withCode = (d: Diagnostic[], code: string) => d.filter((x) => x.code === code);

function coverageOf(docs = workspace(), fixture: FixtureName = 'nominal') {
  const { ev } = analyse('fr2052a_product_id', docs, fixture);
  return ev.selfCoverage()!;
}

// ---------------------------------------------------------------------------

describe('document kinds', () => {
  it('reads a classification, a parameter set and a view from the same parser', () => {
    expect(parseDoc(RULES).kind).toBe('classification');
    expect(parseDoc(RATES).kind).toBe('parameter_set');
    expect(parseDoc(VIEW).kind).toBe('metrics_view');
    expect(parseDoc(INITIAL_DOCS.liquidity_pit).kind).toBe('metrics_view');
  });

  it('keeps blocks in their own sections', () => {
    const g = parseDoc(VIEW);
    // `derivationsOf` is the single-document read: the view's own stage only.
    expect(derivationsOf(g).map((d) => d.name)).toEqual(['weighted_amount']);
    expect(derivationsOf(parseDoc(PREPARED)).map((d) => d.name)).toEqual([
      'days_to_maturity', 'maturity_bucket', 'product_id', 'outflow_rate',
    ]);
    // `measures` must not have swallowed the derivations.
    expect(g.measures.map((m) => m.name)).toContain('net_outflows_30d');
    expect(g.measures.map((m) => m.name)).not.toContain('product_id');
  });

  it('composes the shared stage ahead of the view\u2019s own, in that order', () => {
    // The order is the contract: a view derivation may build on a prepared one
    // (`weighted_amount` reads `outflow_rate`), never the other way round.
    const registry = buildRegistry(workspace());
    expect(derivationsFor(parseDoc(VIEW), registry, AS_OF).map((d) => d.name)).toEqual([
      'days_to_maturity', 'maturity_bucket', 'product_id', 'outflow_rate', 'weighted_amount',
    ]);
  });

  it('qualifies nested header keys so citations do not collide', () => {
    const g = parseDoc(RULES);
    expect(g.view['emits.column']).toBe('product_id');
    expect(g.view['effective.from']).toBe('2025-10-01');
    expect(g.view['governance.citation']).toBe('FR 2052a Instructions');
  });

  it('reads every rule with its condition and citation', () => {
    const c = resolveClassification(buildRegistry(workspace()), 'fr2052a_product_id', AS_OF)!;
    expect(c.rules).toHaveLength(16);
    expect(c.rules[0].id).toBe('OD-1');
    expect(c.rules[0].emit).toBe('O.D.1');
    expect(c.rules[0].citation).toBe('12 CFR 249.32(a)(1)');
    expect(c.rules.every((r) => r.when && r.citation)).toBe(true);
  });
});

describe('row-level derivations', () => {
  it('treats a position with no stated maturity as demandable now', () => {
    expect(daysBetween('2026-06-30', '')).toBe(0);
    expect(daysBetween('2026-06-30', '2026-07-30')).toBe(30);
  });

  it('places dates on the ladder', () => {
    expect(bucketFor('fr2052a_maturity', 1, true)).toBe('overnight');
    expect(bucketFor('fr2052a_maturity', 5, true)).toBe('d2_7');
    expect(bucketFor('fr2052a_maturity', 30, true)).toBe('d15_30');
    expect(bucketFor('fr2052a_maturity', 900, true)).toBe('gt365');
    expect(bucketFor('fr2052a_maturity', 0, false)).toBe('open');
  });

  it('runs derivations in order, so each can read the one before it', () => {
    const docs = workspace();
    const g = parseDoc(VIEW);
    const rows = TABLES.nominal['alm.fct_2052a_positions'][AS_OF].map((r) => ({ ...r }));
    const r = deriveRows(g, buildRegistry(docs), rows, AS_OF, DOMAINS);

    const sample = r.rows[0];
    expect(typeof sample.product_id).toBe('string');
    expect(typeof sample.outflow_rate).toBe('number');
    // weighted_amount depends on outflow_rate, which depends on product_id.
    expect(sample.weighted_amount).toBeCloseTo(
      (sample.balance_usd as number) * (sample.outflow_rate as number),
      6,
    );
    expect(r.unknownOps).toEqual([]);
    expect(r.unresolved).toEqual([]);
  });

  it('leaves a missing rate as NaN rather than zero', () => {
    // A zero rate would quietly report no outflow for a product that has one.
    const docs = workspace({ lcr_outflow_rates: RATES.replace(/  - product_id: O\.D\.3[\s\S]*?citation: [^\n]*\n/, '') });
    const g = parseDoc(VIEW);
    const rows = TABLES.nominal['alm.fct_2052a_positions'][AS_OF].map((r) => ({ ...r }));
    const r = deriveRows(g, buildRegistry(docs), rows, AS_OF, DOMAINS);
    expect(r.paramMisses.length).toBeGreaterThan(0);
    expect(r.paramMisses[0].key).toBe('O.D.3');
    expect(r.rows.some((x) => x.product_id === 'O.D.3' && Number.isNaN(x.outflow_rate))).toBe(true);
  });
});

describe('coverage', () => {
  it('classifies every record on the typical data set', () => {
    const c = coverageOf();
    expect(c.total).toBeGreaterThan(0);
    expect(c.unmatched).toBe(0);
    expect(c.matched).toBe(c.total);
    expect(c.matchedNotional).toBeCloseTo(c.totalNotional, 2);
  });

  it('finds records no rule covers on the tricky data set', () => {
    const c = coverageOf(workspace(), 'edge');
    expect(c.unmatched).toBeGreaterThan(0);
    expect(c.unmatchedNotional).toBeGreaterThan(0);
  });

  it('attributes every classified record to exactly one rule', () => {
    const c = coverageOf();
    expect(c.attribution).toHaveLength(c.total);
    expect(c.attribution.filter(Boolean)).toHaveLength(c.matched);
    const summed = c.rules.reduce((a, r) => a + r.records, 0);
    expect(summed).toBe(c.matched);
  });

  it('notional per rule reconciles to notional per emitted value', () => {
    const c = coverageOf();
    const byRule = c.rules.reduce((a, r) => a + r.notional, 0);
    const byValue = c.values.reduce((a, v) => a + v.notional, 0);
    expect(byRule).toBeCloseTo(byValue, 2);
    expect(byRule).toBeCloseTo(c.matchedNotional, 2);
  });

  it('records which earlier rule pre-empted which later one', () => {
    const c = coverageOf();
    // An insured transactional retail balance matches OD-1, OD-2 and OD-3;
    // only order stops it being reported as a less-stable deposit.
    expect(c.overlaps['OD-1']).toContain('OD-2');
    expect(c.overlaps['OD-1']).toContain('OD-3');
    expect(c.preemptedBy['OD-3'].map((p) => p.by)).toContain('OD-1');
  });

  it('first match wins, in document order', () => {
    const c = coverageOf();
    const od1 = c.rules.find((r) => r.id === 'OD-1')!;
    expect(od1.records).toBeGreaterThan(0);

    // Move the catch-all retail rule to the front and OD-1 stops winning.
    const reordered = RULES.replace(
      /  - id: OD-1[\s\S]*?citation: 12 CFR 249\.32\(a\)\(1\)\n\n/,
      '',
    ).replace(
      '  - id: OD-2',
      `  - id: OD-3B
    emit: O.D.3
    label: Retail — catch-all moved first
    when: direction = 'OUTFLOW' and segment = 'RETAIL'
    citation: 12 CFR 249.32(a)(2)

  - id: OD-2`,
    );
    const after = coverageOf(workspace({ fr2052a_product_id: reordered }));
    expect(after.rules.find((r) => r.id === 'OD-2')!.records).toBe(0);
    expect(after.values.find((v) => v.value === 'O.D.1')).toBeUndefined();
  });

  it('flags an emitted value that is not on the form', () => {
    const c = coverageOf(workspace({ fr2052a_product_id: RULES.replace('emit: O.D.5', 'emit: O.D.99') }));
    expect(c.offDomain).toContain('O.D.99');
  });
});

describe('classification diagnostics', () => {
  it('the shipped rule set is clean on typical data', () => {
    const { diags } = analyse('fr2052a_product_id');
    expect(diags.filter((d) => d.sev === 'error')).toEqual([]);
  });

  it('KEEL060 unmapped records, with the notional at stake', () => {
    const registry = buildRegistry(workspace());
    const g = parseDoc(RULES);
    const ev = new Evaluator(g, 'edge', registry);
    const d = withCode(diagnose(g, ev, undefined, registry), 'KEEL060');
    expect(d).toHaveLength(1);
    expect(d[0].sev).toBe('error');
    expect(d[0].message).toMatch(/\$[\d,]+/);
  });

  it('KEEL062 a rule that can never win', () => {
    // OD-3 claims all remaining retail, so a narrower rule after it is dead.
    const shadowed = `${RULES}

  - id: OD-9
    emit: O.D.2
    label: unreachable
    when: direction = 'OUTFLOW' and segment = 'RETAIL' and insured_flag = false
    citation: 12 CFR 249.32(a)(2)`;
    const { diags } = analyse('fr2052a_product_id', workspace({ fr2052a_product_id: shadowed }));
    const d = withCode(diags, 'KEEL062');
    expect(d).toHaveLength(1);
    expect(d[0].message).toContain('OD-9');
    expect(d[0].message).toContain('OD-3');
  });

  it('KEEL061 a rule the test data never exercises', () => {
    const unused = `${RULES}

  - id: OD-Z
    emit: O.D.6
    label: never seen in this data
    when: segment = 'MARTIAN'
    citation: 12 CFR 249.32(a)(3)`;
    const { diags } = analyse('fr2052a_product_id', workspace({ fr2052a_product_id: unused }));
    const d = withCode(diags, 'KEEL061');
    expect(d).toHaveLength(1);
    expect(d[0].sev).toBe('info');
  });

  it('KEEL064 an emitted value outside the declared domain', () => {
    const { diags } = analyse(
      'fr2052a_product_id',
      workspace({ fr2052a_product_id: RULES.replace('emit: O.D.5', 'emit: O.D.99') }),
    );
    expect(withCode(diags, 'KEEL064')[0].message).toContain('O.D.99');
  });

  it('KEEL068 a duplicate rule id', () => {
    const { diags } = analyse(
      'fr2052a_product_id',
      workspace({ fr2052a_product_id: RULES.replace('- id: OD-2', '- id: OD-1') }),
    );
    expect(withCode(diags, 'KEEL068')).toHaveLength(1);
  });

  it('KEEL069 a condition that cannot be read', () => {
    const { diags } = analyse(
      'fr2052a_product_id',
      workspace({
        fr2052a_product_id: RULES.replace(/when: direction = 'OUTFLOW'[^\n]*/, 'when: direction <<'),
      }),
    );
    expect(withCode(diags, 'KEEL069').length).toBeGreaterThan(0);
  });

  it('KEEL074 a tier-1 rule with no citation', () => {
    const { diags } = analyse(
      'fr2052a_product_id',
      workspace({ fr2052a_product_id: RULES.replace('    citation: 12 CFR 249.32(a)(2)\n\n  - id: OD-5', '\n  - id: OD-5') }),
    );
    expect(withCode(diags, 'KEEL074').length).toBeGreaterThan(0);
  });

  it('KEEL072 a rule whose condition changed but whose citation did not', () => {
    const edited = RULES.replace("and account_type = 'TRANSACTIONAL'", "and account_type = 'SAVINGS'");
    const registry = buildRegistry(workspace({ fr2052a_product_id: edited }));
    const g = parseDoc(edited);
    const ev = new Evaluator(g, 'nominal', registry);
    const d = withCode(diagnose(g, ev, parseDoc(RULES), registry), 'KEEL072');
    expect(d).toHaveLength(1);
    expect(d[0].message).toContain('OD-1');
  });
});

describe('effective dating', () => {
  it('resolves the version in force at a date', () => {
    expect(inForce('2025-10-01', '', '2026-06-30')).toBe(true);
    expect(inForce('2026-07-01', '', '2026-06-30')).toBe(false);
    expect(inForce('2025-01-01', '2026-01-01', '2026-06-30')).toBe(false);
  });

  it('detects a gap and an overlap', () => {
    const v = (from: string, to: string) => ({ effectiveFrom: from, effectiveTo: to });
    expect(effectiveProblems([v('2027-01-01', '')], '2026-06-30')).toBe('gap');
    expect(effectiveProblems([v('2025-01-01', ''), v('2026-01-01', '')], '2026-06-30')).toBe('overlap');
    expect(effectiveProblems([v('2025-01-01', '2026-01-01'), v('2026-01-01', '')], '2026-06-30')).toBeNull();
  });

  it('KEEL066 when nothing is in force on the reporting date', () => {
    const future = RULES.replace('from: 2025-10-01', 'from: 2027-01-01');
    const { diags } = analyse('fr2052a_product_id', workspace({ fr2052a_product_id: future }));
    expect(withCode(diags, 'KEEL066').length).toBeGreaterThan(0);
  });

  it('a superseded rule set stops classifying once its window closes', () => {
    const closed = RULES.replace('  from: 2025-10-01', '  from: 2025-10-01\n  to: 2026-01-01');
    const registry = buildRegistry(workspace({ fr2052a_product_id: closed }));
    expect(resolveClassification(registry, 'fr2052a_product_id', AS_OF)).toBeNull();
    expect(resolveClassification(registry, 'fr2052a_product_id', '2025-11-01')).not.toBeNull();
  });

  it('the view reports an out-of-force reference rather than classifying silently', () => {
    const future = RULES.replace('from: 2025-10-01', 'from: 2027-01-01');
    const { diags } = analyse('fr2052a_outflows', workspace({ fr2052a_product_id: future }));
    expect(withCode(diags, 'KEEL066').length).toBeGreaterThan(0);
  });
});

describe('parameter sets', () => {
  it('resolves keyed values', () => {
    const ps = resolveParameterSet(buildRegistry(workspace()), 'lcr_outflow_rates', AS_OF)!;
    expect(ps.keys).toEqual(['product_id']);
    expect(ps.table['O.D.1']).toBe(0.03);
    expect(ps.table['O.D.3']).toBe(0.10);
    expect(ps.table['O.W.3']).toBe(1.00);
  });

  it('covers every product ID the rule set can emit', () => {
    const registry = buildRegistry(workspace());
    const c = resolveClassification(registry, 'fr2052a_product_id', AS_OF)!;
    const ps = resolveParameterSet(registry, 'lcr_outflow_rates', AS_OF)!;
    const emitted = c.rules.map((r) => r.emit).filter((v, i, a) => a.indexOf(v) === i);
    emitted.forEach((e) => expect(ps.table[e], `no rate for ${e}`).toBeDefined());
  });

  it('KEEL075 a duplicated key', () => {
    const dupe = RATES.replace(
      '  - product_id: O.D.2',
      '  - product_id: O.D.1\n    outflow_rate: 0.99\n    citation: dupe\n\n  - product_id: O.D.2',
    );
    const { diags } = analyse('lcr_outflow_rates', workspace({ lcr_outflow_rates: dupe }));
    expect(withCode(diags, 'KEEL075')).toHaveLength(1);
  });

  it('KEEL076 a value that is not a number', () => {
    const bad = RATES.replace('outflow_rate: 0.03\n    citation: 12 CFR 249.32(a)(1)', 'outflow_rate: three percent\n    citation: 12 CFR 249.32(a)(1)');
    const { diags } = analyse('lcr_outflow_rates', workspace({ lcr_outflow_rates: bad }));
    expect(withCode(diags, 'KEEL076').length).toBeGreaterThan(0);
  });

  it('KEEL072 a rate change that keeps the same citation', () => {
    const edited = RATES.replace('outflow_rate: 0.10\n    citation: 12 CFR 249.32(a)(2)', 'outflow_rate: 0.25\n    citation: 12 CFR 249.32(a)(2)');
    const registry = buildRegistry(workspace({ lcr_outflow_rates: edited }));
    const g = parseDoc(edited);
    const ev = new Evaluator(g, 'nominal', registry);
    const d = withCode(diagnose(g, ev, parseDoc(RATES), registry), 'KEEL072');
    expect(d.length).toBeGreaterThan(0);
    expect(d[0].message).toContain('0.25');
  });

  it('KEEL065 when a product ID has no rate', () => {
    const missing = RATES.replace(/  - product_id: O\.W\.3[\s\S]*?citation: [^\n]*\n/, '');
    const { diags } = analyse('fr2052a_outflows', workspace({ lcr_outflow_rates: missing }));
    const d = withCode(diags, 'KEEL065');
    expect(d.length).toBeGreaterThan(0);
    expect(d[0].message).toContain('O.W.3');
  });
});

describe('the 2052a view', () => {
  it('opens with no compile-blocking errors', () => {
    const { diags } = analyse('fr2052a_outflows');
    const blocking = diags.filter(
      (d) => d.sev === 'error' && ['KEEL060', 'KEEL065', 'KEEL070', 'KEEL071'].includes(d.code),
    );
    expect(blocking).toEqual([]);
  });

  it('aggregates a classified column exactly as it aggregates a source column', () => {
    const { ev } = analyse('fr2052a_outflows');
    const gross = ev.value('gross_outflow_balance').v;
    const weighted = ev.value('weighted_outflows_30d').v;
    expect(gross).toBeGreaterThan(0);
    expect(weighted).toBeGreaterThan(0);
    // Every rate is below 1.0 for outflows, so weighting must reduce the total.
    expect(weighted).toBeLessThan(gross);
  });

  it('caps inflows at 75% of outflows and floors the net at zero', () => {
    const { ev } = analyse('fr2052a_outflows');
    const out = ev.value('weighted_outflows_30d').v;
    const capped = ev.value('capped_inflows_30d').v;
    const net = ev.value('net_outflows_30d').v;
    expect(capped).toBeLessThanOrEqual(out * 0.75 + 1e-6);
    expect(net).toBeCloseTo(Math.max(out - capped, 0), 2);
    expect(net).toBeGreaterThanOrEqual(0);
  });

  it('retail run-off reconciles to the retail product IDs in coverage', () => {
    const { ev } = analyse('fr2052a_outflows');
    const retail = ev.value('retail_outflows_30d').v;
    expect(retail).toBeGreaterThan(0);
    expect(retail).toBeLessThan(ev.value('weighted_outflows_30d').v);
  });

  it('KEEL070 an operator the engine does not have', () => {
    const { diags } = analyse(
      'fr2052a_outflows',
      workspace({ fr2052a_prepared: PREPARED.replace('op: date_bucket', 'op: date_buckets') }),
    );
    expect(withCode(diags, 'KEEL070')[0].message).toContain('date_buckets');
  });

  it('KEEL071 a derivation naming an artifact that does not exist', () => {
    const { diags } = analyse(
      'fr2052a_outflows',
      workspace({ fr2052a_prepared: PREPARED.replace('using: fr2052a_product_id', 'using: nope') }),
    );
    expect(withCode(diags, 'KEEL071')[0].message).toContain('nope');
  });

  it('does not flag a derived column as missing from the source model', () => {
    // `weighted_amount` and `product_id` exist only because a derivation makes
    // them, so KEEL004 must not fire for the measures that read them.
    const { diags } = analyse('fr2052a_outflows');
    expect(withCode(diags, 'KEEL004')).toEqual([]);
    expect(withCode(diags, 'KEEL050')).toEqual([]);
  });

  it('a rate change moves the reported number', () => {
    const base = analyse('fr2052a_outflows').ev.value('weighted_outflows_30d').v;
    const doubled = RATES.replace('  - product_id: O.D.3\n    outflow_rate: 0.10', '  - product_id: O.D.3\n    outflow_rate: 0.20');
    const after = analyse('fr2052a_outflows', workspace({ lcr_outflow_rates: doubled })).ev
      .value('weighted_outflows_30d').v;
    expect(after).toBeGreaterThan(base);
  });
});

describe('notional migration — the blast radius of a rule change', () => {
  function migrationFor(edited: string) {
    const filed = resolveClassification(buildRegistry(workspace()), 'fr2052a_product_id', AS_OF)!;
    const current = resolveClassification(
      buildRegistry(workspace({ fr2052a_product_id: edited })),
      'fr2052a_product_id',
      AS_OF,
    )!;
    const src = TABLES.nominal['alm.fct_2052a_positions'][AS_OF];
    const before = src.map((r) => ({ ...r }));
    const after = src.map((r) => ({ ...r }));
    const b = runClassification(filed, before, DOMAINS);
    const a = runClassification(current, after, DOMAINS);
    return classificationMigration(b, a, before, after, current.notional);
  }

  it('reports nothing when the rules are unchanged', () => {
    expect(migrationFor(RULES)).toEqual([]);
  });

  it('names where the money went when a rule is removed', () => {
    // Drop OD-1 and its balances fall through to the next matching rule.
    const withoutOd1 = RULES.replace(/  - id: OD-1[\s\S]*?citation: 12 CFR 249\.32\(a\)\(1\)\n\n/, '');
    const moves = migrationFor(withoutOd1);
    expect(moves.length).toBeGreaterThan(0);
    expect(moves[0].from).toBe('O.D.1');
    expect(moves[0].to).toBe('O.D.2');
    expect(moves[0].records).toBeGreaterThan(0);
    expect(moves[0].notional).toBeGreaterThan(0);
  });

  it('shows notional leaving the mapped set when coverage is lost', () => {
    // OW-2 is the last rule covering non-deposit outflows; without it those
    // balances have nowhere to go, which is the case the panel must surface.
    const noWholesale = RULES.replace(/  - id: OW-2[\s\S]*?citation: 12 CFR 249\.32\(h\)\(2\)\n\n/, '');
    const moves = migrationFor(noWholesale);
    expect(moves.some((m) => m.to === '(unmapped)')).toBe(true);
    expect(moves.find((m) => m.to === '(unmapped)')!.notional).toBeGreaterThan(0);
  });
});
