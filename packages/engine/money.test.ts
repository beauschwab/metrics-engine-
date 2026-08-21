/**
 * Rounding, at the boundary where the obvious implementations are wrong.
 *
 * Every case here is one that `Math.round(x * 100) / 100` or a bare `toFixed`
 * gets wrong, which is why the function exists at all. They are worth pinning
 * because the failure is a single cent in a filed submission — small enough to
 * survive review and large enough to be a finding.
 */

import { describe, expect, it } from 'vitest';
import { asFiled, isCurrency, quantize } from './money';

describe('quantize', () => {
  it('rounds a half up, where the naive scaling rounds down', () => {
    // 1.005 * 100 is 100.49999999999999 in float64, so Math.round gives 1.00.
    expect(quantize(1.005)).toBe(1.01);
    expect(quantize(2.675)).toBe(2.68);
    expect(quantize(8.615)).toBe(8.62);
  });

  it('rounds half away from zero, symmetrically', () => {
    // Half-to-even would give 2.68 and -2.68 here, or 2.68 and -2.67 depending
    // on the engine. An asymmetry shows up as a one-cent break between a total
    // and the sum of its parts once credits and debits are both present.
    expect(quantize(-1.005)).toBe(-1.01);
    expect(quantize(-2.675)).toBe(-2.68);
    expect(quantize(0.005)).toBe(0.01);
    expect(quantize(-0.005)).toBe(-0.01);
  });

  it('leaves an amount that is already exact alone', () => {
    expect(quantize(1234567.89)).toBe(1234567.89);
    expect(quantize(0)).toBe(0);
    expect(quantize(-0)).toBe(0);
  });

  it('holds at the magnitudes a submission actually uses', () => {
    expect(quantize(284120000.004)).toBe(284120000);
    expect(quantize(284120000.006)).toBe(284120000.01);
    expect(quantize(1234567890.125)).toBe(1234567890.13);
  });

  it('passes non-numbers through rather than inventing a value', () => {
    expect(quantize(NaN)).toBeNaN();
    expect(quantize(Infinity)).toBe(Infinity);
  });

  it('honours a different scale when asked', () => {
    expect(quantize(1.23456, 4)).toBe(1.2346);
    expect(quantize(1.5, 0)).toBe(2);
  });

  it('produces a value that is an exact number of cents', () => {
    // The property the whole exercise is for: after this, comparing two engines
    // is an equality rather than a tolerance.
    const seeded = (s: number) => () => {
      s = (s * 1103515245 + 12345) % 2147483648;
      return s / 2147483648;
    };
    const r = seeded(11);
    for (let i = 0; i < 2000; i++) {
      const v = (r() - 0.5) * 10 ** (1 + Math.floor(r() * 9));
      const q = quantize(v);
      // Compared relative to magnitude: at a billion dollars, `q * 100` is
      // itself a float64 with about four digits to spare, so an absolute
      // epsilon would be testing the multiplication rather than the rounding.
      const scale = Math.max(1, Math.abs(q));
      expect(Math.abs(q * 100 - Math.round(q * 100)) / scale).toBeLessThan(1e-9);
      expect(Math.abs(q - v)).toBeLessThanOrEqual(0.005 + scale * 1e-12);
    }
  });
});

describe('what counts as an amount', () => {
  it('treats every currency format as money', () => {
    expect(isCurrency('currency_usd')).toBe(true);
    expect(isCurrency('currency_usd_mm')).toBe(true);
  });

  it('does not round a ratio', () => {
    // A coverage ratio is not reconciled to the cent, and rounding it to two
    // places would throw away precision the next calculation needs.
    expect(isCurrency('percent_1dp')).toBe(false);
    expect(asFiled(118.44827586, 'percent_1dp')).toBe(118.44827586);
    expect(asFiled(118.44827586, 'currency_usd')).toBe(118.45);
  });

  it('treats a missing format as not money', () => {
    expect(isCurrency(undefined)).toBe(false);
    expect(asFiled(1.005, undefined)).toBe(1.005);
  });
});
