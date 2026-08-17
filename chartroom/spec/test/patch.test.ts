import { describe, expect, it } from 'vitest';
import { PatchFailed, applyPatch } from '../src/index';

describe('JSON Patch (the subset fixes emit)', () => {
  it('adds, replaces and removes', () => {
    const doc = { a: { b: [1, 2] }, keep: true };
    const out = applyPatch(doc, [
      { op: 'add', path: '/a/b/1', value: 9 },
      { op: 'replace', path: '/a/b/0', value: 7 },
      { op: 'remove', path: '/keep' },
      { op: 'add', path: '/a/c', value: 'x' },
    ]);
    expect(out).toEqual({ a: { b: [7, 9, 2], c: 'x' } });
  });

  it('never mutates the input — the studio holds it for undo', () => {
    const doc = { a: { b: [1, 2] } };
    applyPatch(doc, [{ op: 'replace', path: '/a/b/0', value: 99 }]);
    expect(doc).toEqual({ a: { b: [1, 2] } });
  });

  it('appends with -', () => {
    expect(applyPatch({ xs: [1] }, [{ op: 'add', path: '/xs/-', value: 2 }])).toEqual({ xs: [1, 2] });
  });

  it('unescapes ~1 and ~0', () => {
    const doc: Record<string, number> = { 'a/b': 1, 'a~b': 2 };
    expect(applyPatch(doc, [{ op: 'replace', path: '/a~1b', value: 10 }])['a/b']).toBe(10);
    expect(applyPatch(doc, [{ op: 'replace', path: '/a~0b', value: 20 }])['a~b']).toBe(20);
  });

  it('throws rather than half-applying', () => {
    expect(() => applyPatch({ a: 1 }, [{ op: 'replace', path: '/missing', value: 0 }]))
      .toThrow(PatchFailed);
    expect(() => applyPatch({ a: [1] }, [{ op: 'replace', path: '/a/5', value: 0 }]))
      .toThrow(PatchFailed);
    expect(() => applyPatch({ a: 1 }, [{ op: 'remove', path: '' }])).toThrow(PatchFailed);
  });
});
