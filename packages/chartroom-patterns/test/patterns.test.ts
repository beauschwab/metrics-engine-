import { describe, expect, it } from 'vitest';
import { RULE_IDS } from 'chartroom-spec';
import { PATTERNS, PATTERNS_BY_REF, PatternSchema, RULE_GUIDE } from '../src/index';

describe('the pattern catalog', () => {
  it('every pattern validates as data', () => {
    for (const p of PATTERNS) expect(() => PatternSchema.parse(p)).not.toThrow();
  });

  it('ships the three Phase-2 archetypes and the three Phase-9 additions', () => {
    expect([...PATTERNS_BY_REF.keys()].sort()).toEqual([
      'exec-summary@1', 'limit-utilization-board@1', 'liquidity-monitor@1',
      'metric-deep-dive@1', 'scenario-comparison@1', 'variance-walk@1',
    ]);
  });

  it('exec-summary caps its tiles, because density is the whole constraint', () => {
    const tiles = PATTERNS_BY_REF.get('exec-summary@1')!.slots
      .find((s) => s.name === 'headlines')!;
    expect(tiles.count.max).toBeLessThanOrEqual(6);
  });

  it('variance-walk requires the commentary slot — the reason travels with the move', () => {
    const walk = PATTERNS_BY_REF.get('variance-walk@1')!;
    const note = walk.slots.find((s) => s.name === 'commentary')!;
    expect(note.required).toBe(true);
    expect(note.families).toContain('annotation');
  });

  it('each pattern says when NOT to use it — the anti-sprawl half', () => {
    for (const p of PATTERNS) expect(p.when_not.length).toBeGreaterThan(20);
  });

  it('required slots have workable counts', () => {
    for (const p of PATTERNS) {
      for (const s of p.slots) {
        expect(s.count.max).toBeGreaterThanOrEqual(s.count.min);
        if (s.required) expect(s.count.min).toBeGreaterThanOrEqual(1);
      }
    }
  });
});

describe('the design-guide rationale', () => {
  it('covers every rule the linter can emit, exactly', () => {
    expect(RULE_GUIDE.map((r) => r.rule).sort()).toEqual([...RULE_IDS].sort());
  });

  it('says why, not just what — rationale is what the agent cites', () => {
    for (const r of RULE_GUIDE) {
      expect(r.rationale.length, r.rule).toBeGreaterThan(60);
      expect(r.title.length, r.rule).toBeGreaterThan(10);
    }
  });
});
