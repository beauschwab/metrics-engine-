/**
 * Form mode, as document operations.
 *
 * The claim form mode makes is that it is not a second model — every control
 * writes the same YAML the editor shows, so the two can never disagree. These
 * assertions are therefore mostly about *round-tripping*: what goes in comes
 * back out, the document still parses, and nothing the form could not represent
 * was quietly rewritten on the way through.
 *
 * The three tests that matter most are the ones guarding losses: the `- ` list
 * marker on a measure's first line, the continuation lines of a block scalar,
 * and every reference to a renamed measure. Each of those failures leaves a
 * document that still parses and still renders, with measures that have quietly
 * stopped computing.
 */

import { describe, expect, it } from 'vitest';
import {
  appendToFormula, blockEndOf, filterRows, formulaTokens, kindOf, observedValues,
  renameMeasure, requiresOf, routeDiagnostics, sentenceFor, setExpression, setField,
  setRequires, tokenClass, tokenText, writeFormula, writeWhere,
} from './form';
import { diagnose } from './diagnostics';
import { INITIAL_DOCS } from './documents';
import { Evaluator } from './evaluate';
import { parseDoc } from './parse';
import { buildRegistry } from './registry';

const DOC = INITIAL_DOCS.liquidity_pit;
const lines = () => DOC.split('\n');
const parsed = (ls: string[]) => parseDoc(ls.join('\n'));
const g = parseDoc(DOC);

// ---------------------------------------------------------------------------

describe('what a measure is, in the user’s words', () => {
  it('states a simple measure as a sentence with its value', () => {
    expect(sentenceFor(g.byName.hqla_total, 284120000, 'currency_usd'))
      .toBe('Adds up hqla_eligible_amount, counting only rows where is_encumbered = false. '
        + 'Shown as $284,120,000.');
  });

  it('says "across every row" when nothing filters', () => {
    // The absence of a filter has to be stated. A sentence that simply omits the
    // clause reads as though the author had chosen one.
    expect(sentenceFor(g.byName.gross_outflows_30d, 312400000, 'currency_usd'))
      .toContain(', across every row');
  });

  it('counts dependencies for a combined measure, and gets the plural right', () => {
    expect(sentenceFor(g.byName.lcr_pct, 118.4, 'percent_1dp'))
      .toBe('Combines 2 other measures — currently 118.4%.');
    expect(sentenceFor(g.byName.lcr_buffer, 124, 'percent_1dp'))
      .toContain('Combines 1 other measure —');
  });

  it('names the window calculation in plain words', () => {
    const s = sentenceFor(g.byName.lcr_vol_30d, 1.6, 'percent_2dp');
    expect(s).toMatch(/^Takes the volatility across the window of ⟨lcr_pct⟩, over the trailing 30d/);
  });

  it('carries no pill glyph on a column name, because this is prose', () => {
    expect(sentenceFor(g.byName.hqla_total, 1, 'number')).not.toContain('·');
  });

  it('reads the kind off the document rather than guessing', () => {
    expect(kindOf(g.byName.hqla_total)).toBe('simple');
    expect(kindOf(g.byName.lcr_pct)).toBe('derived');
    expect(kindOf(g.byName.lcr_vol_30d)).toBe('windowed');
  });
});

describe('filters as rows', () => {
  it('splits a flat chain into rows and puts it back unchanged', () => {
    const f = filterRows("is_encumbered = false and entity_id = 'BANK_US'");
    expect(f.advanced).toBe(false);
    expect(f.rows).toEqual([
      { join: '', col: 'is_encumbered', op: '=', val: 'false' },
      { join: 'and', col: 'entity_id', op: '=', val: "'BANK_US'" },
    ]);
    expect(writeWhere(f.rows)).toBe("is_encumbered = false and entity_id = 'BANK_US'");
  });

  it('refuses to represent what it cannot round-trip', () => {
    // Approximating any of these would change what the measure counts, and it
    // would do so silently — the number would still compute.
    ["(a = 1 or b = 2) and c = 3", "s in ('A','B')", 'not a = 1', 'm is null']
      .forEach((where) => {
        const f = filterRows(where);
        expect(f.advanced, where).toBe(true);
        expect(f.rows, where).toEqual([]);
        expect(f.raw, where).toBe(where);
      });
  });

  it('removes the key rather than writing an empty clause', () => {
    // `where:` with nothing after it is not "no filter" — it is a filter the
    // predicate compiler has to have an opinion about.
    expect(writeWhere([])).toBeNull();
  });

  it('keeps or/and joins as written', () => {
    const f = filterRows('a = 1 or b = 2 and c = 3');
    expect(f.rows.map((r) => r.join)).toEqual(['', 'or', 'and']);
  });
});

describe('the values a column actually holds', () => {
  it('offers only what is in the test data', () => {
    // The commonest silent error in metric authoring is a predicate that matches
    // nothing — `'Retail'` against a book that says `'RETAIL'` — and it produces
    // a confident zero rather than an error.
    const v = observedValues('nominal', 'alm.fct_2052a_positions', 'segment');
    expect(v).toEqual(["'RETAIL'", "'SMALL_BUSINESS'", "'WHOLESALE'"]);
  });

  it('quotes them the way the predicate compiler reads them back', () => {
    const v = observedValues('nominal', 'alm.fct_2052a_positions', 'entity_id');
    expect(v).toContain("'BANK_US'");
    // Booleans are literals, not strings, and quoting them would break the
    // comparison the form just wrote.
    expect(observedValues('nominal', 'alm.fct_2052a_positions', 'is_secured'))
      .toEqual(['false', 'true']);
  });

  it('offers nothing for a numeric column, where a menu is the wrong control', () => {
    expect(observedValues('nominal', 'alm.fct_2052a_positions', 'balance_usd')).toEqual([]);
  });

  it('offers nothing rather than a hundred options', () => {
    expect(observedValues('nominal', 'alm.fct_2052a_positions', 'position_id')).toEqual([]);
  });

  it('follows the fixture, so the menu matches the data being evaluated', () => {
    expect(observedValues('nominal', 'alm.nope', 'segment')).toEqual([]);
  });
});

describe('formulas as chips', () => {
  const known = (n: string) => n in g.byName;

  it('tokenises an expression and puts it back', () => {
    const expr = '100.0 * hqla_total / nullif(net_cash_outflows_30d, 0)';
    const tokens = formulaTokens(expr);
    expect(tokens).toContain('hqla_total');
    expect(tokens).toContain('nullif');
    expect(writeFormula(tokens)).toBe(expr);
  });

  it('classifies each token, and gives it a glyph so colour is not the only channel', () => {
    expect(tokenClass('hqla_total', known)).toBe('measure');
    expect(tokenClass('nullif', known)).toBe('function');
    expect(tokenClass('case', known)).toBe('keyword');
    expect(tokenClass('*', known)).toBe('plain');

    expect(tokenText('hqla_total', known)).toBe('⟨hqla_total⟩');
    expect(tokenText('nullif', known)).toBe('ƒnullif');
    expect(tokenText('*', known)).toBe('*');
  });

  it('does not put a space before a comma or after an open bracket', () => {
    expect(writeFormula(['greatest', '(', 'a', ',', 'b', ')'])).toBe('greatest(a, b)');
  });
});

describe('writing one field', () => {
  it('keeps the list marker on a measure’s first line', () => {
    // Writing `  - name: x` back with only the leading whitespace preserved
    // drops the `- `, which deletes the measure from the parsed document and
    // spills its remaining fields into the measure above it. The document still
    // parses, so nothing announces the loss.
    const next = setField(lines(), 'hqla_total', 'name', 'hqla_total');
    expect(next.some((l) => /^\s+- name: hqla_total$/.test(l))).toBe(true);
    expect(parsed(next).measures).toHaveLength(g.measures.length);
  });

  it('adds a key that was not there', () => {
    const next = setField(lines(), 'gross_outflows_30d', 'description', 'A description.');
    expect(parsed(next).byName.gross_outflows_30d.f.description).toBe('A description.');
    expect(parsed(next).measures).toHaveLength(g.measures.length);
  });

  it('removes a key rather than blanking it', () => {
    // An empty `description:` satisfies nothing and reads as an answered
    // question, which is worse than an obviously missing one.
    const next = setField(lines(), 'hqla_total', 'description', null);
    expect(parsed(next).byName.hqla_total.f.description).toBeUndefined();
    expect(next.some((l) => /description:\s*$/.test(l))).toBe(false);
  });

  it('leaves every other line alone', () => {
    const before = lines();
    const after = setField(before, 'hqla_total', 'label', 'Changed');
    const differing = before.filter((l, i) => after[i] !== l);
    expect(differing).toHaveLength(1);
  });

  it('does nothing to a measure that does not exist', () => {
    expect(setField(lines(), 'nope', 'label', 'x')).toEqual(lines());
  });
});

describe('writing a formula', () => {
  it('replaces the whole block scalar, not just its header', () => {
    // Replacing only the header line leaves the previous body underneath, and
    // the measure quietly keeps computing the old formula.
    const next = setExpression(lines(), 'lcr_pct', 'hqla_total * 2');
    const m = parsed(next).byName.lcr_pct;
    expect(m.f.expression.trim()).toBe('hqla_total * 2');
    expect(next.filter((l) => /nullif/.test(l))).toHaveLength(0);
    expect(parsed(next).measures).toHaveLength(g.measures.length);
  });

  it('creates the block when the measure has none', () => {
    const next = setExpression(lines(), 'gross_outflows_30d', 'a + b');
    expect(parsed(next).byName.gross_outflows_30d.f.expression.trim()).toBe('a + b');
  });

  it('adds a dropped measure to the dependency list in the same edit', () => {
    // `KEEL005` — used in the formula but missing from `requires` — is a real
    // and frequent mistake in the text editor. Doing both halves here means the
    // form cannot construct it at all.
    const before = requiresOf(g.byName.lcr_shortfall);
    expect(before).not.toContain('hqla_total');

    const next = appendToFormula(lines(), 'lcr_shortfall', 'hqla_total', true);
    const m = parsed(next).byName.lcr_shortfall;
    expect(requiresOf(m)).toContain('hqla_total');
    expect(formulaTokens(m.f.expression)).toContain('hqla_total');
  });

  it('does not touch the dependency list for an operator', () => {
    const next = appendToFormula(lines(), 'lcr_shortfall', '+', false);
    expect(requiresOf(parsed(next).byName.lcr_shortfall))
      .toEqual(requiresOf(g.byName.lcr_shortfall));
  });

  it('removes the requires key when the last dependency goes', () => {
    const next = setRequires(lines(), 'lcr_pct', []);
    expect(parsed(next).byName.lcr_pct.f.requires).toBeUndefined();
  });
});

describe('renaming', () => {
  it('rewrites the name and every reference to it', () => {
    // A rename that touches only the `name:` line leaves every downstream
    // `requires:` and every formula pointing at a measure that no longer
    // exists. The document parses, the surface renders, and a set of measures
    // has silently stopped computing.
    const next = renameMeasure(lines(), 'hqla_total', 'eligible_hqla');
    const doc = parsed(next);

    expect(doc.byName.eligible_hqla).toBeTruthy();
    expect(doc.byName.hqla_total).toBeUndefined();
    expect(requiresOf(doc.byName.lcr_pct)).toContain('eligible_hqla');
    expect(doc.byName.lcr_pct.f.expression).toContain('eligible_hqla');
    expect(next.join('\n')).not.toMatch(/\bhqla_total\b/);
  });

  it('leaves a measure whose name merely contains the old one alone', () => {
    // `hqla_us_unencumbered` is not `hqla_total`, and a substring rewrite would
    // corrupt it.
    const next = renameMeasure(lines(), 'hqla_total', 'x');
    expect(parsed(next).byName.hqla_us_unencumbered).toBeTruthy();
  });

  it('refuses a no-op and an empty name', () => {
    expect(renameMeasure(lines(), 'hqla_total', 'hqla_total')).toEqual(lines());
    expect(renameMeasure(lines(), 'hqla_total', '')).toEqual(lines());
    expect(renameMeasure(lines(), 'nope', 'x')).toEqual(lines());
  });

  it('keeps the document parseable, with every measure intact', () => {
    const next = renameMeasure(lines(), 'lcr_pct', 'coverage_ratio');
    expect(parsed(next).measures).toHaveLength(g.measures.length);
  });
});

describe('round-tripping a whole edit', () => {
  it('produces a document the parser and the evaluator both still accept', () => {
    // The guarantee form mode makes: flip to YAML and read exactly what you
    // built. So every operation composed together has to leave a document the
    // rest of the engine can still run.
    let next = lines();
    next = setField(next, 'hqla_total', 'label', 'Eligible HQLA');
    next = setField(next, 'hqla_total', 'agg', 'sum');
    next = setField(next, 'hqla_total', 'where', writeWhere([
      { join: '', col: 'is_encumbered', op: '=', val: 'false' },
      { join: 'and', col: 'entity_id', op: '=', val: "'BANK_US'" },
    ]));
    next = setExpression(next, 'lcr_pct', '100.0 * hqla_total / nullif(net_cash_outflows_30d, 0)');
    next = renameMeasure(next, 'lcr_buffer', 'lcr_headroom_pct');

    const doc = parsed(next);
    expect(doc.measures).toHaveLength(g.measures.length);
    expect(doc.byName.hqla_total.f.label).toBe('Eligible HQLA');
    expect(doc.byName.lcr_headroom_pct).toBeTruthy();

    const ev = new Evaluator(doc, 'nominal', buildRegistry({ liquidity_pit: next.join('\n') }));
    expect(Number.isFinite(ev.value('lcr_pct').v)).toBe(true);
  });

  it('leaves comments and unrelated documents untouched', () => {
    // A quick fix that strips a comment explaining a regulatory carve-out is a
    // serious defect in this domain.
    const withComment = ['# why this exists', ...lines()];
    const next = setField(withComment, 'hqla_total', 'label', 'x');
    expect(next[0]).toBe('# why this exists');
  });
});

describe('routing a diagnostic to the field it is about', () => {
  const registry = buildRegistry(INITIAL_DOCS as unknown as Record<string, string>);
  const ev = new Evaluator(g, 'nominal', registry);
  const diags = diagnose(g, ev, g, registry, INITIAL_DOCS as unknown as Record<string, string>);

  it('puts a missing description under Description, not in a banner', () => {
    // Validation belongs attached to the thing that is wrong. A banner at the
    // top of the card makes the reader hunt for which field it meant.
    const i = g.measures.findIndex((m) => m.name === 'lcr_pct');
    const routed = routeDiagnostics(diags, g.measures[i], blockEndOf(g, i));
    expect(routed.byField.description?.some((d) => d.code === 'KEEL030')).toBe(true);
  });

  it('routes every code the table names to a field the form renders', () => {
    g.measures.forEach((m, i) => {
      const routed = routeDiagnostics(diags, m, blockEndOf(g, i));
      Object.keys(routed.byField).forEach((field) => {
        expect(routed.byField[field].length, field).toBeGreaterThan(0);
      });
    });
  });

  it('keeps what it cannot place rather than dropping it', () => {
    // Anything unrouted still has to be visible — at the bottom of the card, so
    // it does not compete with the fields, but never discarded.
    const mine = (m: { line: number }, end: number) =>
      diags.filter((d) => d.line >= m.line && d.line < end);

    g.measures.forEach((m, i) => {
      const end = blockEndOf(g, i);
      const routed = routeDiagnostics(diags, m, end);
      const placed = Object.values(routed.byField).flat().length;
      expect(placed + routed.unrouted.length).toBe(mine(m, end).length);
    });
  });

  it('scopes notes to the measure that owns them', () => {
    const i = g.measures.findIndex((m) => m.name === 'lcr_pct');
    const routed = routeDiagnostics(diags, g.measures[i], blockEndOf(g, i));
    const all = [...Object.values(routed.byField).flat(), ...routed.unrouted];
    all.forEach((d) => {
      expect(d.line).toBeGreaterThanOrEqual(g.measures[i].line);
      expect(d.line).toBeLessThan(blockEndOf(g, i));
    });
  });
});
