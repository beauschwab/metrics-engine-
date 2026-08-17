/**
 * The critic harness without a model: the degrade path, the retry, the schema
 * gate, and the digest's no-data guarantee. Model judgment itself is tested in
 * evals/, which needs a key and skips itself without one.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { DashboardSpec } from 'chartroom-spec';
import { CriticFindingSchema, renderDigest, runDesignCritic } from '../src/index';

const spec = (): DashboardSpec => ({
  chartroom: '0.1',
  dashboard: {
    id: 'board', title: 'Board', pattern: { none: { justification: 'fixture dashboard for tests' } },
    audience: 'exec', cadence: 'eod', status: 'draft',
  },
  context: {},
  layout: { grid: { cols: 12, row_height: 96 } },
  widgets: [{
    id: 'tile', type: 'kpi-tile@1', title: 'LCR', pos: { x: 0, y: 0, w: 3, h: 2 },
    bind: { metric: 'keel://liquidity_pit.lcr_pct@1', compare: { vs: 'prior_period', style: 'delta' } },
  }],
  interactions: [],
});

let savedKey: string | undefined;
beforeEach(() => {
  savedKey = process.env.ANTHROPIC_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
});
afterEach(() => {
  if (savedKey !== undefined) process.env.ANTHROPIC_API_KEY = savedKey;
});

describe('the degrade path — the critic never blocks the pipeline', () => {
  it('no key → a WARN saying so, never a throw', async () => {
    const findings = await runDesignCritic(spec(), null);
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe('WARN');
    expect(findings[0].claim).toContain('critic unavailable');
    expect(findings[0].claim).toContain('linter still ran');
  });

  it('a model error → WARN, not a throw', async () => {
    const findings = await runDesignCritic(spec(), null, {
      call: async () => { throw new Error('overloaded'); },
    });
    expect(findings[0].severity).toBe('WARN');
    expect(findings[0].claim).toContain('overloaded');
  });

  it('unparseable output → one retry, then WARN', async () => {
    let calls = 0;
    const findings = await runDesignCritic(spec(), null, {
      call: async () => { calls += 1; return 'not json at all'; },
    });
    expect(calls).toBe(2);
    expect(findings[0].severity).toBe('WARN');
    expect(findings[0].claim).toContain('twice');
  });

  it('garbage once, valid on retry → the retry wins', async () => {
    let calls = 0;
    const findings = await runDesignCritic(spec(), null, {
      call: async () => {
        calls += 1;
        return calls === 1
          ? '{"findings": [{"severity": "SHOUT", "claim": "bad enum"}]}'
          : '{"findings": [{"severity": "SUGGEST", "claim": "consider a trend next to the tile"}]}';
      },
    });
    expect(calls).toBe(2);
    expect(findings).toHaveLength(1);
    expect(findings[0].critic).toBe('design');
    expect(findings[0].severity).toBe('SUGGEST');
  });

  it('an empty findings list is a valid, clean verdict', async () => {
    const findings = await runDesignCritic(spec(), null, {
      call: async () => '{"findings": []}',
    });
    expect(findings).toEqual([]);
  });
});

describe('the render digest', () => {
  it('carries composition, never data values', async () => {
    const digest = renderDigest(spec());
    expect(digest).toContain('kpi-tile@1');
    expect(digest).toContain('keel://liquidity_pit.lcr_pct@1');
    // No numbers that look like evaluated results — the only numerics allowed
    // are grid geometry.
    expect(digest).not.toMatch(/value|scalar|points|rows/);
  });

  it('orders widgets in reading order so "hero" means the same thing to everyone', () => {
    const s = spec();
    s.widgets = [
      { ...s.widgets[0], id: 'lower', pos: { x: 0, y: 4, w: 3, h: 2 } },
      { ...s.widgets[0], id: 'hero', pos: { x: 0, y: 0, w: 9, h: 4 } },
    ];
    const digest = renderDigest(s);
    expect(digest.indexOf('"hero"')).toBeLessThan(digest.indexOf('"lower"'));
  });
});

describe('the finding schema', () => {
  it('rejects what the pipeline could not render', () => {
    expect(CriticFindingSchema.safeParse({
      critic: 'design', severity: 'BLOCK', claim: 'the hero widget answers a different question',
    }).success).toBe(true);
    expect(CriticFindingSchema.safeParse({
      critic: 'design', severity: 'FATAL', claim: 'wrong severity vocabulary',
    }).success).toBe(false);
    expect(CriticFindingSchema.safeParse({
      critic: 'design', severity: 'WARN', claim: 'too short',
    }).success).toBe(false);
  });
});
