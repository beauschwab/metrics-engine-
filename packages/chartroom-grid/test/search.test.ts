/**
 * The quick filter's grammar (ADR-73): tokens parse the same way for the
 * client filter, the SQL and the filter bar, and a row matches when every
 * token holds.
 */

import { describe, expect, it } from 'vitest';
import { headlessTable } from '../src/agent/headless';
import { generatePositions, type Position } from '../src/data/mock';
import {
  describeSearchToken, parseSearch, parseSearchNumber, rowMatchesSearch, tokenizeSearch, withSearchToken, withoutSearchToken,
} from '../src/grid/search';
import { parseView } from '../src/grid/viewState';

const BOOK = generatePositions(2000);

describe('parseSearch', () => {
  it('reads free words, column terms by id or label, and comparisons with suffixes', () => {
    const q = parseSearch('Credit ccy:EUR notional>1bn yield>=3.5 desk!=FX entity=WF-US');
    expect(q.text.map((t) => t.value)).toEqual(['Credit']);
    expect(q.unknown).toEqual([]);
    expect(q.terms.map((t) => [t.column, t.op, t.value])).toEqual([
      ['currency', ':', 'EUR'],
      ['notional', '>', 1e9],
      ['yield', '>=', 3.5],
      ['desk', '!=', 'FX'],
      ['legalEntity', '=', 'WF-US'],
    ]);
  });

  it('keeps quoted runs together, before and after an operator', () => {
    expect(tokenizeSearch('desk:"front office" "two words" plain')).toEqual(['desk:"front office"', '"two words"', 'plain']);
    const q = parseSearch('desk:"front office" "two words"');
    expect(q.terms[0]).toMatchObject({ column: 'desk', op: ':', value: 'front office' });
    expect(q.text[0]!.value).toBe('two words');
  });

  it('numbers: thousands, millions, billions, a percent sign, a sign', () => {
    expect(parseSearchNumber('1bn')).toBe(1e9);
    expect(parseSearchNumber('2.5m')).toBe(2.5e6);
    expect(parseSearchNumber('250k')).toBe(250e3);
    expect(parseSearchNumber('1,000')).toBe(1000);
    expect(parseSearchNumber('-3.5%')).toBe(-3.5);
    expect(parseSearchNumber('abc')).toBeUndefined();
  });

  it('an unknown column is free text; a measure without a number, or a dimension with a comparison, is unknown', () => {
    const q = parseSearch('cpty:foo notional>abc desk>Credit');
    expect(q.text.map((t) => t.value)).toEqual(['cpty:foo']);
    expect(q.unknown.map((u) => [u.column, u.reason])).toEqual([
      ['notional', 'Notional needs a number'],
      ['desk', 'Desk is text; use :, = or !='],
    ]);
    expect(rowMatchesSearch(q, () => 'anything')).toBe(false);
  });

  it('a blank string is the empty query, and the empty query matches every row', () => {
    expect(parseSearch('   ').tokens).toEqual([]);
    expect(rowMatchesSearch(parseSearch(''), () => undefined)).toBe(true);
  });

  it('a token can be removed or added by its raw text, keeping the rest as typed', () => {
    expect(withoutSearchToken('Credit  ccy:EUR notional>1bn', 'ccy:EUR')).toBe('Credit notional>1bn');
    expect(withSearchToken('Credit', 'ccy:EUR')).toBe('Credit ccy:EUR');
    expect(withSearchToken('Credit ccy:EUR', 'ccy:EUR')).toBe('Credit ccy:EUR');
  });

  it('describes a token the way the bar shows it', () => {
    const q = parseSearch('Credit ccy:EUR notional>1bn desk!=FX notional>abc');
    expect(q.tokens.map((t) => describeSearchToken(t))).toEqual([
      '“Credit”', 'Ccy contains EUR', 'Notional > 1000000000', 'Desk is not FX', 'Notional: notional>abc (Notional needs a number)',
    ]);
  });
});

describe('the table filters by the grammar', () => {
  const rowsFor = (globalFilter: string) =>
    headlessTable(BOOK, parseView({ version: 2, globalFilter })).getFilteredRowModel().rows.map((r) => r.original as Position);

  it('every term holds on every kept row, and nothing that holds is dropped', () => {
    const kept = rowsFor('desk:Credit ccy:EUR notional>1bn');
    const expected = BOOK.filter((b) => b.desk.toLowerCase().includes('credit') && b.currency.toLowerCase().includes('eur') && b.notional > 1e9);
    expect(kept.length).toBeGreaterThan(0);
    expect(kept.map((b) => b.tradeId).sort()).toEqual(expected.map((b) => b.tradeId).sort());
  });

  it('a free word still matches anywhere in the row, case-insensitively', () => {
    const kept = rowsFor('cp-0100');
    expect(kept.length).toBeGreaterThan(0);
    expect(kept.every((b) => b.counterparty.toLowerCase().includes('cp-0100'))).toBe(true);
  });

  it('an unknown term keeps nothing; a mixed query is the intersection', () => {
    expect(rowsFor('notional>abc')).toEqual([]);
    const both = rowsFor('Bond desk=Rates');
    expect(both.every((b) => b.desk === 'Rates' && Object.values(b).some((v) => String(v).toLowerCase().includes('bond')))).toBe(true);
    expect(both.length).toBe(BOOK.filter((b) => b.desk === 'Rates' && b.product === 'Bond').length);
  });

  it('a set filter with no values keeps no row (none), while no filter keeps every row', () => {
    const none = headlessTable(BOOK, parseView({ version: 2, columnFilters: [{ id: 'product', value: [] }] }));
    expect(none.getFilteredRowModel().rows.length).toBe(0);
    const all = headlessTable(BOOK, parseView({ version: 2 }));
    expect(all.getFilteredRowModel().rows.length).toBe(BOOK.length);
  });
});
