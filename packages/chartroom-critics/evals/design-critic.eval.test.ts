/**
 * The design-critic eval — real model, real judgment.
 *
 * Skips itself without ANTHROPIC_API_KEY, in the same spirit as the repo's
 * conformance tests skipping without Python: a missing optional dependency
 * reads as "not run", never as a defect. CI with a key runs it; CI without one
 * still holds the harness to account through test/critic.test.ts.
 */

import { describe, expect, it } from 'vitest';
import { runDesignCritic } from '../src/index';
import { CASES } from './fixtures';

const HAS_KEY = !!process.env.ANTHROPIC_API_KEY;

describe.skipIf(!HAS_KEY)('design critic evals (live model)', () => {
  for (const c of CASES) {
    it(c.name, async () => {
      const findings = await runDesignCritic(c.spec, c.brief);
      const real = findings.filter((f) => !f.claim.includes('critic unavailable'));
      expect(findings.some((f) => f.claim.includes('critic unavailable')),
        'critic must be available when a key is set').toBe(false);

      if (c.expectDefect === null) {
        // Good cases: no BLOCKs. WARN/SUGGEST are judgment latitude.
        expect(real.filter((f) => f.severity === 'BLOCK'),
          JSON.stringify(real, null, 2)).toEqual([]);
      } else {
        const ranked = c.expectDefect.minSeverity === 'BLOCK'
          ? real.filter((f) => f.severity === 'BLOCK')
          : real.filter((f) => f.severity === 'BLOCK' || f.severity === 'WARN');
        expect(ranked.length, JSON.stringify(real, null, 2)).toBeGreaterThan(0);
        // Fuzzy claim match; exact severity handled above.
        expect(
          ranked.some((f) =>
            c.expectDefect!.claimHint.test(`${f.claim} ${f.suggestion ?? ''}`)
            || (c.expectDefect!.aboutWidget && f.widget_id === c.expectDefect!.aboutWidget)),
          JSON.stringify(ranked, null, 2),
        ).toBe(true);
      }
    });
  }
});

describe.skipIf(HAS_KEY)('design critic evals', () => {
  it('skipped — no ANTHROPIC_API_KEY in this environment', () => {
    expect(true).toBe(true);
  });
});
