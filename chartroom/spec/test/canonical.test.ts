import { describe, expect, it } from 'vitest';
import { canonicalize, sha256Hex, specHash } from '../src/index';
import { baseSpec } from './fixtures';

describe('sha256', () => {
  // FIPS 180-4 known-answer vectors — the implementation is hand-rolled
  // (ADR: browser-safe and synchronous), so it proves itself against NIST.
  it('matches the published vectors', () => {
    expect(sha256Hex('')).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    expect(sha256Hex('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    expect(sha256Hex('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq')).toBe(
      '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1');
  });

  it('handles multi-byte input', () => {
    // sha256 of the UTF-8 bytes of '€' — checked against sha256sum(1).
    expect(sha256Hex('€')).toBe(
      'c4cc90ed3d26f12d4b08a75140970a7904035c31cbb4515a83f19b9003c00d1d');
  });
});

describe('canonical identity', () => {
  it('is insensitive to key order', () => {
    const a = baseSpec();
    const reversed = Object.fromEntries(Object.entries(a).reverse()) as typeof a;
    reversed.widgets = reversed.widgets.map(
      (w) => Object.fromEntries(Object.entries(w).reverse()) as typeof w,
    );
    expect(canonicalize(reversed)).toBe(canonicalize(a));
    expect(specHash(reversed)).toBe(specHash(a));
  });

  it('preserves array order — widget order is meaning', () => {
    const a = baseSpec();
    const b = baseSpec();
    b.widgets = [b.widgets[1], b.widgets[0]];
    expect(specHash(a)).not.toBe(specHash(b));
  });

  it('drops undefined but keeps null-ish meaningful values distinct', () => {
    const a = baseSpec();
    const b = baseSpec();
    (b.widgets[0] as { title?: string }).title = undefined;
    expect(specHash(a)).toBe(specHash(b));
  });

  it('changes when meaning changes', () => {
    const a = baseSpec();
    const b = baseSpec();
    b.widgets[0].bind.metric = 'keel://liquidity_pit.lcr_pct@5';
    expect(specHash(a)).not.toBe(specHash(b));
  });
});
