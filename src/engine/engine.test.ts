/**
 * Engine tests.
 *
 * The engine is a pure function of (document text, fixture), so it can be
 * tested without a DOM. These cover the numbers the spec quotes, the whole
 * diagnostic catalogue, and every quick fix — a fix that rewrites nothing is
 * the failure mode that is hardest to notice by hand.
 */

import { describe, expect, it } from 'vitest';
import { applyFix, diagnose, type Diagnostic, type Fix } from './diagnostics';
import { INITIAL_DOCS } from './documents';
import { Evaluator } from './evaluate';
import { fmt } from './format';
import { parseDoc } from './parse';
import { compilePredicate } from './predicate';
import { evalExpression } from './expression';
import { candidates } from './completion';
import { dependents, traceNodes } from './trace';
import { AS_OF, DATES, TABLES } from './fixtures';
import type { FixtureName } from './vocab';

const LIQ = INITIAL_DOCS.liquidity_pit;
const EVE = INITIAL_DOCS.irrbb_eve;

function analyse(doc: string, fixture: FixtureName = 'nominal', baseline?: string) {
  const g = parseDoc(doc);
  const ev = new Evaluator(g, fixture);
  const diags = diagnose(g, ev, baseline === undefined ? undefined : parseDoc(baseline));
  return { g, ev, diags };
}

const withCode = (d: Diagnostic[], code: string) => d.filter((x) => x.code === code);

/** Apply a fix the way the editor does and re-analyse. */
function applied(doc: string, fix: Fix): string {
  const g = parseDoc(doc);
  return applyFix(doc.split('\n'), fix, g).join('\n');
}

// ---------------------------------------------------------------------------

describe('fixtures', () => {
  it('are deterministic and cover 60 days', () => {
    expect(DATES).toHaveLength(60);
    expect(AS_OF).toBe('2026-06-30');
  });

  it('calibrate to the figures the spec quotes', () => {
    const { ev } = analyse(LIQ);
    expect(Math.round(ev.value('hqla_total').v)).toBe(284120000);
    expect(Math.round(ev.value('gross_outflows_30d').v)).toBe(312400000);
    expect(Math.round(ev.value('capped_inflows_30d').v)).toBe(72500000);
    expect(Math.round(ev.value('net_cash_outflows_30d').v)).toBe(239900000);
    expect(fmt(ev.value('lcr_pct').v, 'percent_1dp')).toBe('118.4%');
  });

  it('keep the three test sets comparable', () => {
    const nominal = analyse(LIQ, 'nominal').ev.value('lcr_pct').v;
    const stress = analyse(LIQ, 'stress').ev.value('lcr_pct').v;
    expect(stress).toBeLessThan(nominal);
    expect(Number.isFinite(analyse(LIQ, 'edge').ev.value('lcr_pct').v)).toBe(true);
  });

  it('hold the same values across evaluator instances', () => {
    expect(analyse(LIQ).ev.value('lcr_pct').v).toBe(analyse(LIQ).ev.value('lcr_pct').v);
  });
});

describe('expression evaluator', () => {
  const env = (vars: Record<string, number>) => (n: string) => vars[n] ?? NaN;

  it('respects arithmetic precedence', () => {
    expect(evalExpression('2 + 3 * 4', env({})).value).toBe(14);
    expect(evalExpression('(2 + 3) * 4', env({})).value).toBe(20);
  });

  it('divides by zero to NaN rather than Infinity', () => {
    expect(Number.isNaN(evalExpression('1 / 0', env({})).value)).toBe(true);
  });

  it('reports which branch of a case fired', () => {
    const lo = evalExpression('case when x < 100 then 1 else 0 end', env({ x: 50 }));
    expect(lo.value).toBe(1);
    expect(lo.branch).toBe('branch 1');

    const hi = evalExpression('case when x < 100 then 1 else 0 end', env({ x: 150 }));
    expect(hi.value).toBe(0);
    expect(hi.branch).toBe('else');
  });

  it('treats nullif(a, a) as null', () => {
    expect(Number.isNaN(evalExpression('nullif(5, 5)', env({})).value)).toBe(true);
    expect(evalExpression('nullif(5, 0)', env({})).value).toBe(5);
  });
});

describe('where: predicates', () => {
  const rows = TABLES.nominal['alm.fct_liquidity_position'][AS_OF];

  it('filters on equality', () => {
    const p = compilePredicate("entity_id = 'BANK_US'");
    expect(p.err).toBeNull();
    expect(rows.filter(p.fn)).toHaveLength(40);
  });

  it('combines with and / or / not', () => {
    const both = compilePredicate("is_encumbered = false and entity_id = 'BANK_US'");
    const either = compilePredicate("entity_id = 'BANK_US' or entity_id = 'BANK_UK'");
    expect(rows.filter(both.fn).length).toBeGreaterThan(0);
    expect(rows.filter(either.fn)).toHaveLength(80);
    expect(rows.filter(compilePredicate('not is_encumbered = false').fn).length).toBe(
      rows.length - rows.filter(compilePredicate('is_encumbered = false').fn).length,
    );
  });

  it('handles in (…) lists', () => {
    const p = compilePredicate("entity_id in ('BANK_US', 'BANK_UK')");
    expect(p.err).toBeNull();
    expect(rows.filter(p.fn)).toHaveLength(80);
  });

  it('names the problem when it cannot read the filter, and fails open', () => {
    const p = compilePredicate('is_encumbered <<');
    expect(p.err).toBeTruthy();
    // A filter we could not read must not silently drop rows.
    expect(rows.filter(p.fn)).toHaveLength(rows.length);
  });

  it('reports the columns it read, for KEEL050', () => {
    expect(compilePredicate("nope = 'x'").cols).toContain('nope');
  });
});

describe('number formatting', () => {
  it('puts the sign outside the currency symbol', () => {
    expect(fmt(-41222870, 'currency_usd')).toBe('-$41,222,870');
    expect(fmt(-41222870, 'currency_usd_mm')).toBe('-$41.2M');
  });

  it('renders each format distinctly', () => {
    expect(fmt(284120000, 'currency_usd')).toBe('$284,120,000');
    expect(fmt(284120000, 'currency_usd_mm')).toBe('$284.1M');
    expect(fmt(284120000, 'number')).toBe('284,120,000');
    expect(fmt(118.43, 'percent_1dp')).toBe('118.4%');
    expect(fmt(118.43, 'percent_2dp')).toBe('118.43%');
    expect(fmt(1.5, 'bps')).toBe('150 bps');
  });

  it('never renders NaN as a number', () => {
    expect(fmt(NaN, 'currency_usd')).toBe('—');
    expect(fmt(null, 'number')).toBe('—');
  });
});

describe('the views as shipped', () => {
  it('open with no compile-blocking errors', () => {
    const { diags } = analyse(LIQ);
    const blocking = diags.filter(
      (d) => d.sev === 'error' && ['KEEL001', 'KEEL004', 'KEEL005', 'KEEL052'].includes(d.code),
    );
    expect(blocking).toEqual([]);
  });

  it('treat case keywords as grammar, not as measures', () => {
    const { diags } = analyse(LIQ);
    expect(withCode(diags, 'KEEL001')).toEqual([]);
    const eve = analyse(EVE);
    expect(withCode(eve.diags, 'KEEL001')).toEqual([]);
  });

  it('open with the governance problems the design intends', () => {
    const { diags } = analyse(LIQ);
    // Two tier-1/2 measures ship without a description, which is what puts the
    // linter on screen the moment the surface opens.
    expect(withCode(diags, 'KEEL030')).toHaveLength(2);
    expect(withCode(diags, 'KEEL030').every((d) => d.sev === 'error')).toBe(true);
    // Everything that ships under oversight cites its rule.
    expect(withCode(diags, 'KEEL031')).toEqual([]);
  });

  it('KEEL031 fires when a rule citation is dropped', () => {
    const { diags } = analyse(LIQ.replace('    citation: 12 CFR 249.20\n', ''));
    expect(withCode(diags, 'KEEL031').length).toBeGreaterThan(0);
  });

  it('point expression diagnostics at the line holding the text', () => {
    const broken = LIQ.replace('100.0 * hqla_total /', '100.0 * hqla_totl /');
    const { diags } = analyse(broken);
    const d = withCode(diags, 'KEEL001')[0];
    expect(d).toBeDefined();
    // The name must actually be on the line the diagnostic points at, or the
    // squiggle lands above the code and the rename fix rewrites nothing.
    expect(broken.split('\n')[d.line]).toContain('hqla_totl');
  });
});

describe('diagnostic catalogue', () => {
  it('KEEL001 unknown measure, with a suggestion', () => {
    const { diags } = analyse(LIQ.replace('100.0 * hqla_total', '100.0 * hqla_totl'));
    const d = withCode(diags, 'KEEL001')[0];
    expect(d.message).toContain('hqla_total');
    expect(d.fix).toBeDefined();
  });

  it('KEEL002 circular dependency, named as a path', () => {
    const looped = LIQ.replace(
      '      lcr_pct * 1.0473',
      '      lcr_pct * 1.0473 + lcr_stress',
    ).replace('      lcr_pct * 0.834', '      lcr_pct * 0.834 + lcr_buffer');
    const { diags } = analyse(looped);
    const d = withCode(diags, 'KEEL002')[0];
    expect(d).toBeDefined();
    expect(d.message).toContain('→');
  });

  it('KEEL003 unknown dimension', () => {
    const { diags } = analyse(EVE.replace('partition_by: [entity]', 'partition_by: [notadim]'));
    expect(withCode(diags, 'KEEL003')[0].message).toContain('notadim');
  });

  it('KEEL004 column not on the source', () => {
    const { diags } = analyse(LIQ.replace('field: hqla_eligible_amount', 'field: no_such_column'));
    expect(withCode(diags, 'KEEL004').length).toBeGreaterThan(0);
  });

  it('KEEL005 used in the formula but missing from requires', () => {
    const { diags } = analyse(LIQ.replace('requires: [hqla_total, net_cash_outflows_30d]', 'requires: [hqla_total]'));
    expect(withCode(diags, 'KEEL005')[0].message).toContain('net_cash_outflows_30d');
  });

  it('KEEL006 listed in requires but unused', () => {
    const { diags } = analyse(LIQ.replace('requires: [lcr_pct]\n    expression: >\n      lcr_pct * 1.0473', 'requires: [lcr_pct, hqla_total]\n    expression: >\n      lcr_pct * 1.0473'));
    expect(withCode(diags, 'KEEL006')[0].message).toContain('hqla_total');
  });

  it('KEEL007 unknown function', () => {
    const { diags } = analyse(LIQ.replace('nullif(net_cash_outflows_30d, 0)', 'nulliff(net_cash_outflows_30d, 0)'));
    const d = withCode(diags, 'KEEL007')[0];
    expect(d.message).toContain('nulliff');
    // It must not also be reported as a missing measure.
    expect(withCode(diags, 'KEEL001')).toEqual([]);
  });

  it('KEEL010 a point-in-time balance added up across dates', () => {
    const { diags } = analyse(LIQ.replace('max_query_span: P1D', 'max_query_span: P7D'));
    expect(withCode(diags, 'KEEL010').length).toBeGreaterThan(0);
  });

  it('KEEL011 a point-in-time view with no max_query_span', () => {
    const { diags } = analyse(LIQ.replace('  max_query_span: P1D\n', ''));
    expect(withCode(diags, 'KEEL011')).toHaveLength(1);
  });

  it('KEEL012 a measure whose grain contradicts the view', () => {
    const { diags } = analyse(LIQ.replace('    type: simple\n    agg: sum\n    field: hqla_eligible_amount', '    grain: flow\n    type: simple\n    agg: sum\n    field: hqla_eligible_amount'));
    expect(withCode(diags, 'KEEL012')[0].message).toContain('flow');
  });

  it('KEEL013 a span that permits cross-date aggregation', () => {
    const { diags } = analyse(LIQ.replace('max_query_span: P1D', 'max_query_span: P7D'));
    expect(withCode(diags, 'KEEL013')).toHaveLength(1);
  });

  it('KEEL020 an operator outside the algebra', () => {
    const { diags } = analyse(LIQ.replace('lcr_pct * 1.0473', 'lcr_pct % 1.0473'));
    expect(withCode(diags, 'KEEL020')[0].message).toContain('%');
  });

  it('KEEL021 only fires for a backend actually targeted', () => {
    expect(withCode(analyse(EVE).diags, 'KEEL021')).toHaveLength(1);
    const dropped = EVE.replace(', dremio]', ']');
    expect(withCode(analyse(dropped).diags, 'KEEL021')).toEqual([]);
  });

  it('KEEL022 an aggregate inside a derived expression', () => {
    const { diags } = analyse(LIQ.replace('      lcr_pct * 1.0473', '      sum(lcr_pct)'));
    expect(withCode(diags, 'KEEL022')[0].message).toContain('sum');
  });

  it('KEEL023 a row-based window frame', () => {
    const { diags } = analyse(LIQ.replace('    window.op: stddev', '    window.frame: rows\n    window.op: stddev'));
    expect(withCode(diags, 'KEEL023')).toHaveLength(1);
  });

  it('KEEL024 weighted_avg with no weight', () => {
    const { diags } = analyse(LIQ.replace('    agg: sum\n    field: hqla_eligible_amount', '    agg: weighted_avg\n    field: hqla_eligible_amount'));
    expect(withCode(diags, 'KEEL024')).toHaveLength(1);
  });

  it('KEEL025 a windowed measure with no window.op', () => {
    expect(withCode(analyse(EVE).diags, 'KEEL025')).toHaveLength(1);
  });

  it('KEEL030 / KEEL031 escalate with governance tier', () => {
    const { diags } = analyse(LIQ);
    expect(withCode(diags, 'KEEL030').every((d) => d.sev === 'error')).toBe(true);
    // Tier 3 is advisory, not blocking.
    const tier3 = LIQ.replace('    sr_11_7_tier: 2\n    citation: 12 CFR 249.20', '    sr_11_7_tier: 3');
    const relaxed = withCode(analyse(tier3).diags, 'KEEL030').find((d) => d.message.includes('lcr_stress'));
    expect(relaxed?.sev).toBe('warn');
  });

  it('KEEL032 only fires once a signed-off measure is actually edited', () => {
    expect(withCode(analyse(LIQ, 'nominal', LIQ).diags, 'KEEL032')).toEqual([]);
    const edited = LIQ.replace('100.0 * hqla_total', '101.0 * hqla_total');
    const d = withCode(analyse(edited, 'nominal', LIQ).diags, 'KEEL032');
    expect(d).toHaveLength(1);
    expect(d[0].message).toContain('lcr_pct');
  });

  it('KEEL032 stays quiet when a change ticket is present', () => {
    // hqla_total ships with a ticket, so editing it is already accounted for.
    const edited = LIQ.replace('where: is_encumbered = false\n', 'where: is_encumbered = true\n');
    expect(
      withCode(analyse(edited, 'nominal', LIQ).diags, 'KEEL032').some((d) => d.message.includes('hqla_total')),
    ).toBe(false);
  });

  it('KEEL033 no valid_range', () => {
    expect(withCode(analyse(LIQ).diags, 'KEEL033').length).toBeGreaterThan(0);
    expect(withCode(analyse(LIQ).diags, 'KEEL033').every((d) => d.sev === 'info')).toBe(true);
  });

  it('KEEL034 a signed-off measure renamed away', () => {
    const renamed = LIQ.split('\n').map((l) => l.replace(/\blcr_pct\b/g, 'lcr_percent')).join('\n');
    const d = withCode(analyse(renamed, 'nominal', LIQ).diags, 'KEEL034');
    expect(d).toHaveLength(1);
    expect(d[0].message).toContain('lcr_pct');
  });

  it('KEEL040 a duplicated definition', () => {
    const dupe = LIQ.replace(
      "    where: is_encumbered = false and entity_id = 'BANK_US'",
      '    where: is_encumbered = false',
    );
    const d = withCode(analyse(dupe).diags, 'KEEL040');
    expect(d).toHaveLength(1);
    expect(d[0].message).toContain('hqla_total');
  });

  it('KEEL041 a name that is not snake_case', () => {
    const { diags } = analyse(LIQ.replace('- name: lcr_buffer', '- name: lcrBuffer'));
    const d = withCode(diags, 'KEEL041')[0];
    expect(d.fixLabel).toContain('lcr_buffer');
  });

  it('KEEL042 no format', () => {
    const { diags } = analyse(LIQ.replace('      lcr_pct * 1.0473\n    format: percent_1dp', '      lcr_pct * 1.0473'));
    expect(withCode(diags, 'KEEL042').length).toBeGreaterThan(0);
  });

  it('KEEL043 a deeply nested expression', () => {
    const { diags } = analyse(LIQ.replace('      lcr_pct * 1.0473', '      abs(greatest(nullif(coalesce(lcr_pct, 0), 0), 0))'));
    expect(withCode(diags, 'KEEL043')).toHaveLength(1);
  });

  it('KEEL044 a value outside a closed choice', () => {
    const { diags } = analyse(LIQ.replace('format: percent_1dp\n    valid_range: [0, 500]', 'format: percent_9dp\n    valid_range: [0, 500]'));
    const d = withCode(diags, 'KEEL044')[0];
    expect(d.message).toContain('percent_1dp');
  });

  it('KEEL050 / KEEL051 / KEEL052 for filters', () => {
    expect(withCode(analyse(LIQ.replace('is_encumbered = false\n', "nope = 'x'\n")).diags, 'KEEL050').length).toBeGreaterThan(0);
    expect(withCode(analyse(LIQ.replace("entity_id = 'BANK_US'", "entity_id = 'NOPE'")).diags, 'KEEL051')).toHaveLength(1);
    expect(withCode(analyse(LIQ.replace('where: is_encumbered = false\n', 'where: is_encumbered <<\n')).diags, 'KEEL052').length).toBeGreaterThan(0);
  });
});

describe('quick fixes', () => {
  /** Every fix must actually change the document, and clear its own diagnostic. */
  function expectFixResolves(doc: string, code: string, baseline?: string) {
    const { diags } = analyse(doc, 'nominal', baseline);
    const d = withCode(diags, code)[0];
    expect(d, `${code} was not raised`).toBeDefined();
    expect(d.fix, `${code} offers no fix`).toBeDefined();

    const after = applied(doc, d.fix!);
    expect(after, `${code} fix rewrote nothing`).not.toBe(doc);

    const again = analyse(after, 'nominal', baseline).diags;
    expect(withCode(again, code).length, `${code} survived its own fix`).toBeLessThan(
      withCode(diags, code).length,
    );
    return after;
  }

  it('KEEL001 replaces with the nearest name', () => {
    const after = expectFixResolves(LIQ.replace('100.0 * hqla_total', '100.0 * hqla_totl'), 'KEEL001');
    expect(after).toContain('100.0 * hqla_total');
  });

  it('KEEL005 adds the name to requires', () => {
    const after = expectFixResolves(
      LIQ.replace('requires: [hqla_total, net_cash_outflows_30d]', 'requires: [hqla_total]'),
      'KEEL005',
    );
    expect(after).toContain('requires: [hqla_total, net_cash_outflows_30d]');
  });

  it('KEEL006 removes the unused name', () => {
    const after = expectFixResolves(
      LIQ.replace('requires: [lcr_pct]\n    expression: >\n      lcr_pct * 1.0473', 'requires: [lcr_pct, hqla_total]\n    expression: >\n      lcr_pct * 1.0473'),
      'KEEL006',
    );
    expect(after).toContain('requires: [lcr_pct]');
  });

  it('KEEL007 replaces the misspelled function', () => {
    expectFixResolves(LIQ.replace('nullif(net_cash', 'nulliff(net_cash'), 'KEEL007');
  });

  it('KEEL010 switches the aggregate to last', () => {
    const after = expectFixResolves(LIQ.replace('max_query_span: P1D', 'max_query_span: P7D'), 'KEEL010');
    expect(after).toContain('agg: last');
  });

  it('KEEL011 inserts max_query_span', () => {
    const after = expectFixResolves(LIQ.replace('  max_query_span: P1D\n', ''), 'KEEL011');
    expect(after).toContain('max_query_span: P1D');
  });

  it('KEEL013 tightens the span', () => {
    const after = expectFixResolves(LIQ.replace('max_query_span: P1D', 'max_query_span: P7D'), 'KEEL013');
    expect(after).toContain('max_query_span: P1D');
  });

  it('KEEL021 drops the backend from targets', () => {
    const after = expectFixResolves(EVE, 'KEEL021');
    expect(after).not.toContain('dremio');
    expect(after).toContain('bigquery');
  });

  it('KEEL023 switches the frame to time', () => {
    expectFixResolves(LIQ.replace('    window.op: stddev', '    window.frame: rows\n    window.op: stddev'), 'KEEL023');
  });

  it('KEEL024 proposes a real weight column', () => {
    const after = expectFixResolves(
      LIQ.replace('    agg: sum\n    field: hqla_eligible_amount', '    agg: weighted_avg\n    field: hqla_eligible_amount'),
      'KEEL024',
    );
    expect(after).toMatch(/weight: \w+/);
  });

  it('KEEL025 inserts a window block', () => {
    const after = expectFixResolves(EVE, 'KEEL025');
    expect(after).toContain('window.op: stddev');
  });

  it('KEEL030 inserts a description stub', () => {
    const after = expectFixResolves(LIQ, 'KEEL030');
    expect(after).toContain('description: TODO');
  });

  it('KEEL032 inserts a change ticket', () => {
    const after = expectFixResolves(LIQ.replace('100.0 * hqla_total', '101.0 * hqla_total'), 'KEEL032', LIQ);
    expect(after).toContain('change_ticket:');
  });

  it('KEEL033 inserts a valid_range', () => {
    expectFixResolves(LIQ, 'KEEL033');
  });

  it('KEEL040 rewrites the duplicate as a reference', () => {
    const dupe = LIQ.replace(
      "    where: is_encumbered = false and entity_id = 'BANK_US'",
      '    where: is_encumbered = false',
    );
    const after = expectFixResolves(dupe, 'KEEL040');
    expect(after).toContain('requires: [hqla_total]');
    // The rewritten measure must still evaluate.
    const { ev } = analyse(after);
    expect(ev.value('hqla_us_unencumbered').v).toBeCloseTo(284120000, 0);
  });

  it('KEEL041 renames across every reference', () => {
    const renamed = LIQ.replace(/\blcr_buffer\b/g, 'lcrBuffer');
    const after = expectFixResolves(renamed, 'KEEL041');
    expect(after).not.toContain('lcrBuffer');
  });

  it('KEEL044 replaces with the nearest legal value', () => {
    expectFixResolves(LIQ.replace('format: percent_1dp\n    valid_range', 'format: percent_9dp\n    valid_range'), 'KEEL044');
  });

  it('leaves the document alone when the fix does not apply', () => {
    const g = parseDoc(LIQ);
    const lines = LIQ.split('\n');
    expect(applyFix(lines, { kind: 'setValue', line: 9999, value: 'x' }, g)).toBe(lines);
  });
});

describe('trace and blast radius', () => {
  it('walks the full chain and substitutes live values', () => {
    const { g, ev } = analyse(LIQ);
    const nodes = traceNodes(g, ev, 'lcr_pct', 'full', {});
    expect(nodes.map((n) => n.name)).toEqual([
      'lcr_pct', 'hqla_total', 'net_cash_outflows_30d', 'gross_outflows_30d', 'capped_inflows_30d',
    ]);
    expect(Math.round(nodes[1].value.v)).toBe(284120000);
  });

  it('shows one level in drill-down mode', () => {
    const { g, ev } = analyse(LIQ);
    expect(traceNodes(g, ev, 'lcr_pct', 'drill', {})).toHaveLength(3);
  });

  it('puts a row count beside every aggregate', () => {
    const { g, ev } = analyse(LIQ);
    const node = traceNodes(g, ev, 'lcr_pct', 'full', {}).find((n) => n.name === 'hqla_total');
    expect(node?.detail[0].rows).toContain('rows');
    expect(node?.detail[0].zero).toBe(false);
  });

  it('marks a predicate that matched nothing', () => {
    const { g, ev } = analyse(LIQ.replace("entity_id = 'BANK_US'", "entity_id = 'NOPE'"));
    const node = traceNodes(g, ev, 'hqla_us_unencumbered', 'full', {})[0];
    expect(node.detail[0].zero).toBe(true);
  });

  it('lists every transitive dependent', () => {
    const { g } = analyse(LIQ);
    const deps = dependents(g, 'lcr_pct');
    expect(deps).toContain('lcr_buffer');
    expect(deps).toContain('lcr_vol_30d');
    expect(deps).not.toContain('lcr_pct');
  });

  it('terminates on a cyclic graph', () => {
    const looped = LIQ.replace('      lcr_pct * 1.0473', '      lcr_pct * 1.0473 + lcr_stress')
      .replace('      lcr_pct * 0.834', '      lcr_pct * 0.834 + lcr_buffer');
    const { g, ev } = analyse(looped);
    expect(() => traceNodes(g, ev, 'lcr_buffer', 'full', {})).not.toThrow();
    expect(Number.isNaN(ev.value('lcr_buffer').v)).toBe(true);
  });
});

describe('completion', () => {
  const setup = (doc: string) => {
    const g = parseDoc(doc);
    return { g, ev: new Evaluator(g, 'nominal') };
  };

  it('offers the closed list on an enum field, marking the current value', () => {
    const { g, ev } = setup(LIQ);
    const line = LIQ.split('\n').findIndex((l) => l.includes('format: percent_1dp'));
    const c = candidates(g, ev, 'nominal', line, 'percent_1dp');
    expect(c.list.map((x) => x.n)).toContain('currency_usd');
    expect(c.current).toBe('percent_1dp');
    expect(c.isEnum).toBe(true);
  });

  it('renders a live sample of this measure beside each format', () => {
    const { g, ev } = setup(LIQ);
    const line = LIQ.split('\n').findIndex((l) => l.includes('format: currency_usd'));
    const c = candidates(g, ev, 'nominal', line, '');
    expect(c.list.find((x) => x.n === 'currency_usd')?.h).toBe('$284,120,000');
    expect(c.list.find((x) => x.n === 'currency_usd_mm')?.h).toBe('$284.1M');
  });

  it('offers values actually present in the data after a comparison', () => {
    const { g, ev } = setup(LIQ);
    const line = LIQ.split('\n').findIndex((l) => l.includes('where: is_encumbered = false and'));
    const c = candidates(g, ev, 'nominal', line, "is_encumbered = false and entity_id = ");
    expect(c.list.map((x) => x.n)).toContain("'BANK_US'");
  });

  it('excludes the measure itself from its own requires', () => {
    const { g, ev } = setup(LIQ);
    const line = LIQ.split('\n').findIndex((l) => l.includes('requires: [hqla_total, net_cash'));
    const c = candidates(g, ev, 'nominal', line, '');
    expect(c.list.map((x) => x.n)).not.toContain('lcr_pct');
  });

  it('offers nothing on a free-form field', () => {
    const { g, ev } = setup(LIQ);
    const line = LIQ.split('\n').findIndex((l) => l.includes('label: Total Eligible HQLA'));
    expect(candidates(g, ev, 'nominal', line, 'Total').list).toEqual([]);
  });
});

describe('parser', () => {
  it('records where a folded scalar’s text actually lives', () => {
    const g = parseDoc(LIQ);
    const m = g.byName.lcr_pct;
    expect(m.lineOf.expression).toBeLessThan(m.contentOf.expression);
    expect(LIQ.split('\n')[m.contentOf.expression]).toContain('100.0');
  });

  it('round-trips comments and blank lines', () => {
    const doc = 'version: 1\n\n# a note\nsource: alm.fct_liquidity_position\n';
    expect(parseDoc(doc).lines).toHaveLength(5);
  });

  it('carries the key onto continuation lines', () => {
    const g = parseDoc(LIQ);
    const m = g.byName.lcr_pct;
    expect(g.info[m.contentOf.expression].key).toBe('expression');
    expect(g.info[m.contentOf.expression].continuation).toBe(true);
  });
});
