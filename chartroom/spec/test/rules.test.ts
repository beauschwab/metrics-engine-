/**
 * Golden tests for every lint rule — one `describe` per rule, each with the
 * violation, the clean case, and (where a fix exists) the round-trip: apply
 * the fix, re-lint, the rule no longer fires. The round-trip is the real
 * assertion — a fix that doesn't resolve its own finding is worse than none,
 * because "Apply fix" becomes a button that lies.
 *
 * Consolidated into one table-driven file rather than 13 fixture directories —
 * the repo's engine tests set that convention, and a rule's good/bad/fixed
 * triple reads best side by side.
 */

import { describe, expect, it } from 'vitest';
import { applyPatch, lint, parseSpec } from '../src/index';
import type { DashboardSpec, LintFinding } from '../src/index';
import { baseSpec, ctx } from './fixtures';

const findingsFor = (spec: DashboardSpec, rule: string): LintFinding[] =>
  lint(spec, ctx()).findings.filter((f) => f.rule === rule);

/** Apply the first finding's fix and assert the rule stops firing. */
function roundTrip(spec: DashboardSpec, rule: string): void {
  const [finding] = findingsFor(spec, rule);
  expect(finding?.fix, `${rule} should carry a fix`).toBeTruthy();
  const fixed = applyPatch(spec, finding.fix!);
  // The fix must produce a spec that is still schema-valid…
  expect(parseSpec(fixed).ok).toBe(true);
  // …and no longer raises the rule.
  expect(findingsFor(fixed, rule)).toEqual([]);
}

describe('baseline', () => {
  it('the fixture dashboard lints clean', () => {
    expect(lint(baseSpec(), ctx()).findings).toEqual([]);
  });
});

describe('REF-01 — bindings resolve', () => {
  it('unknown metric, unknown widget type, unknown dim, unknown filter dim', () => {
    const s = baseSpec();
    s.widgets[0].bind.metric = 'keel://liquidity_pit.no_such@4';
    s.widgets[1].type = 'hologram@1';
    const f = findingsFor(s, 'REF-01');
    expect(f).toHaveLength(2);
    expect(f.every((x) => x.severity === 'BLOCK')).toBe(true);

    const s2 = baseSpec();
    s2.widgets[1].bind.dims = ['as_of_date', 'trading_desk'];
    s2.widgets[0].bind.filters = [{ dim: 'desk', op: '=', value: 'FX' }];
    expect(findingsFor(s2, 'REF-01')).toHaveLength(2);
  });
});

describe('TS-01 — time on the x-axis', () => {
  it('fires when a time-series widget binds no time dim, and the fix adds it', () => {
    const s = baseSpec();
    s.widgets[1].bind.dims = ['entity_id'];
    const [f] = findingsFor(s, 'TS-01');
    expect(f.severity).toBe('BLOCK');
    roundTrip(s, 'TS-01');
    // The fix prepends rather than replaces — the entity split survives.
    const fixed = applyPatch(s, f.fix!);
    expect(fixed.widgets[1].bind.dims).toEqual(['as_of_date', 'entity_id']);
  });

  it('also fires with dims absent entirely', () => {
    const s = baseSpec();
    delete s.widgets[1].bind.dims;
    roundTrip(s, 'TS-01');
  });
});

describe('TS-02 — series budget', () => {
  it('warns when categorical cardinalities multiply past max_series', () => {
    const s = baseSpec();
    // 3 entities × 3 scenarios = 9 > 8.
    s.widgets[1].bind.dims = ['as_of_date', 'entity_id', 'scenario_code'];
    const [f] = findingsFor(s, 'TS-02');
    expect(f.severity).toBe('WARN');
    expect(f.message).toContain('9 series');
  });

  it('is quiet at or under budget', () => {
    const s = baseSpec();
    s.widgets[1].bind.dims = ['as_of_date', 'entity_id'];
    expect(findingsFor(s, 'TS-02')).toEqual([]);
  });
});

describe('BAR-02 — sort by value unless ordinal', () => {
  const bar = (dim: string, sort?: 'value' | 'dim'): DashboardSpec => {
    const s = baseSpec();
    s.widgets[1] = {
      id: 'split', type: 'bar@1', pos: { x: 3, y: 0, w: 9, h: 4 },
      bind: { metric: 'keel://liquidity_pit.hqla_total@4', dims: [dim], ...(sort ? { sort } : {}) },
    };
    return s;
  };

  it('ordinal dim sorted by value → fix restores dim order', () => {
    roundTrip(bar('bucket_code', 'value'), 'BAR-02');
  });

  it('non-ordinal dim sorted by dim → fix sorts by value', () => {
    roundTrip(bar('entity_id', 'dim'), 'BAR-02');
  });

  it('absent sort means the guide default and is clean either way', () => {
    expect(findingsFor(bar('bucket_code'), 'BAR-02')).toEqual([]);
    expect(findingsFor(bar('entity_id'), 'BAR-02')).toEqual([]);
  });
});

describe('PIE-01 — part-to-whole beyond five slices', () => {
  it('blocks and the fix rewrites to a sorted bar, keeping the binding', () => {
    const s = baseSpec();
    s.widgets[1] = {
      id: 'slices', type: 'pie@1', pos: { x: 3, y: 0, w: 9, h: 4 },
      // bucket_code has 6 values in the contract.
      bind: { metric: 'keel://liquidity_pit.hqla_total@4', dims: ['bucket_code'] },
    };
    const [f] = findingsFor(s, 'PIE-01');
    expect(f.severity).toBe('BLOCK');
    const fixed = applyPatch(s, f.fix!);
    expect(fixed.widgets[1].type).toBe('bar@1');
    expect(fixed.widgets[1].bind.sort).toBe('value');
    expect(fixed.widgets[1].bind.metric).toBe(s.widgets[1].bind.metric);
    expect(findingsFor(fixed, 'PIE-01')).toEqual([]);
  });

  it('five or fewer slices pass', () => {
    const s = baseSpec();
    s.widgets[1] = {
      id: 'slices', type: 'pie@1', pos: { x: 3, y: 0, w: 9, h: 4 },
      bind: { metric: 'keel://liquidity_pit.hqla_total@4', dims: ['entity_id'] },
    };
    expect(findingsFor(s, 'PIE-01')).toEqual([]);
  });
});

describe('COL-03 — semantic colour is reserved', () => {
  it('semantic emphasis with nothing to judge against blocks, fix neutralises', () => {
    const s = baseSpec();
    s.widgets[1].format = { emphasis: 'semantic' };
    roundTrip(s, 'COL-03');
  });

  it('semantic emphasis with a compare or bands is the intended use', () => {
    const s = baseSpec();
    s.widgets[0].format = { emphasis: 'semantic' }; // widget 0 has a threshold compare
    s.widgets[1].format = { emphasis: 'semantic' };
    s.widgets[1].bind.bands = ['keel://liquidity_pit.lcr_floor@4'];
    expect(findingsFor(s, 'COL-03')).toEqual([]);
  });
});

describe('NUM-01 — precision belongs to the function', () => {
  it('±1 from the contract is layout; further is a different number', () => {
    const ok = baseSpec();
    ok.widgets[0].format = { decimals: 2 }; // contract precision 1
    expect(findingsFor(ok, 'NUM-01')).toEqual([]);

    const bad = baseSpec();
    bad.widgets[0].format = { decimals: 5 };
    const [f] = findingsFor(bad, 'NUM-01');
    expect(f.severity).toBe('BLOCK');
    roundTrip(bad, 'NUM-01');
    expect(applyPatch(bad, f.fix!).widgets[0].format?.decimals).toBe(2);
  });
});

describe('KPI-02 — no naked numbers', () => {
  it('warns on a tile without a compare, and carries no fix on purpose', () => {
    const s = baseSpec();
    delete s.widgets[0].bind.compare;
    const [f] = findingsFor(s, 'KPI-02');
    expect(f.severity).toBe('WARN');
    expect(f.fix).toBeUndefined();
  });
});

describe('DEN-01 — side-by-side ratios share a denominator', () => {
  it('warns when adjacent ratios divide by different things', () => {
    const s = baseSpec();
    s.widgets[1] = {
      id: 'nsfr-tile', type: 'kpi-tile@1', pos: { x: 3, y: 0, w: 3, h: 2 },
      bind: {
        metric: 'keel://liquidity_pit.nsfr_pct@4',
        compare: { vs: 'prior_period', style: 'delta' },
      },
    };
    const [f] = findingsFor(s, 'DEN-01');
    expect(f.severity).toBe('WARN');
    expect(f.message).toContain('different denominators');
  });

  it('is quiet when they are stacked in different bands', () => {
    const s = baseSpec();
    s.widgets[1] = {
      id: 'nsfr-tile', type: 'kpi-tile@1', pos: { x: 0, y: 2, w: 3, h: 2 },
      bind: {
        metric: 'keel://liquidity_pit.nsfr_pct@4',
        compare: { vs: 'prior_period', style: 'delta' },
      },
    };
    expect(findingsFor(s, 'DEN-01')).toEqual([]);
  });
});

describe('GRID-01 — the grid declares its ceiling', () => {
  const grid = (bind: Record<string, unknown>): DashboardSpec => {
    const s = baseSpec();
    s.widgets[1] = {
      id: 'pivot', type: 'perspective-grid@1', pos: { x: 3, y: 0, w: 9, h: 4 },
      bind: { metric: 'keel://liquidity_pit.hqla_total@4', dims: ['entity_id'], ...bind } as never,
    };
    return s;
  };

  it('missing max_cells blocks and the fix supplies the default', () => {
    roundTrip(grid({}), 'GRID-01');
  });

  it('over the 100k boundary blocks and the fix clamps', () => {
    roundTrip(grid({ max_cells: 500_000 }), 'GRID-01');
  });

  it('a dim product past the declared guard blocks with the arithmetic shown', () => {
    const s = grid({ dims: ['entity_id', 'scenario_code', 'bucket_code'], max_cells: 10 });
    const [f] = findingsFor(s, 'GRID-01');
    expect(f.message).toContain('54 cells');
  });
});

describe('LAY-01 — the grid is 12 columns and widgets do not overlap', () => {
  it('out of bounds blocks with a clamping fix', () => {
    const s = baseSpec();
    s.widgets[1].pos = { x: 6, y: 0, w: 9, h: 4 };
    roundTrip(s, 'LAY-01');
  });

  it('overlap blocks without a fix — which one moves is a design decision', () => {
    const s = baseSpec();
    s.widgets[1].pos = { x: 2, y: 0, w: 6, h: 4 };
    const [f] = findingsFor(s, 'LAY-01');
    expect(f.severity).toBe('BLOCK');
    expect(f.fix).toBeUndefined();
  });
});

describe('GOV-01 — derived expressions cannot leave draft', () => {
  it('the same spec lints clean as draft and blocks as team', () => {
    const s = baseSpec();
    s.widgets[0].bind.derived = {
      op: 'ratio',
      of: ['keel://liquidity_pit.hqla_total@4', 'keel://liquidity_pit.net_cash_outflows_30d@4'],
    };
    expect(findingsFor(s, 'GOV-01')).toEqual([]);
    s.dashboard = { ...s.dashboard, status: 'team' };
    const [f] = findingsFor(s, 'GOV-01');
    expect(f.severity).toBe('BLOCK');
    expect(f.message).toContain('formalise');
  });
});

describe('GOV-02 — promoted dashboards bind only governed metrics', () => {
  it('a draft-status metric blocks at team, including in bands and compares', () => {
    const s = baseSpec();
    s.widgets[1].bind.bands = ['keel://scratch.candidate@9'];
    expect(findingsFor(s, 'GOV-02')).toEqual([]);
    s.dashboard = { ...s.dashboard, status: 'team' };
    const f = findingsFor(s, 'GOV-02');
    expect(f).toHaveLength(1);
    expect(f[0].path).toContain('/bands/');
  });
});

describe('CTX-01 — filter params are declared contexts', () => {
  it('an undeclared param blocks; declaring it clears the finding', () => {
    const s = baseSpec();
    s.widgets[0].bind.filters = [{ dim: 'entity_id', op: '=', param: 'entity' }];
    const [f] = findingsFor(s, 'CTX-01');
    expect(f.severity).toBe('BLOCK');
    s.context = { entity: { dim: 'entity_id', default: 'WF-US' } };
    expect(findingsFor(s, 'CTX-01')).toEqual([]);
  });
});

describe('AGG-01 — totals only total what totals', () => {
  const grid = (metric: string): DashboardSpec => {
    const s = baseSpec();
    s.widgets[1] = {
      id: 'pivot', type: 'perspective-grid@1', pos: { x: 3, y: 0, w: 9, h: 4 },
      bind: { metric, dims: ['entity_id'], max_cells: 50_000 },
    };
    return s;
  };

  it('a grid over a ratio measure blocks — the totals row would sum ratios', () => {
    const [f] = findingsFor(grid('keel://liquidity_pit.lcr_pct@4'), 'AGG-01');
    expect(f.severity).toBe('BLOCK');
    expect(f.message).toContain('does not re-aggregate by sum');
    expect(f.fix).toBeUndefined(); // the right widget is a design decision
  });

  it('an additive measure grids freely', () => {
    expect(findingsFor(grid('keel://liquidity_pit.hqla_total@4'), 'AGG-01')).toEqual([]);
  });

  it('a ratio on a bar or KPI is untouched — per-group ratios are valid', () => {
    const s = baseSpec();
    s.widgets[1] = {
      id: 'by-entity', type: 'bar@1', pos: { x: 3, y: 0, w: 9, h: 4 },
      bind: { metric: 'keel://liquidity_pit.lcr_pct@4', dims: ['entity_id'] },
    };
    expect(findingsFor(s, 'AGG-01')).toEqual([]);
  });
});

describe('IX-01 — a cross-filter must be answerable on both ends', () => {
  const wired = (): DashboardSpec => {
    const s = baseSpec();
    s.widgets[1] = {
      id: 'by-entity', type: 'bar@1', pos: { x: 3, y: 0, w: 9, h: 4 },
      bind: { metric: 'keel://liquidity_pit.hqla_total@4', dims: ['entity_id'] },
    };
    s.interactions = [{ cross_filter: { source: 'by-entity', dim: 'entity_id', targets: ['lcr-tile'] } }];
    return s;
  };

  it('a well-wired cross-filter lints clean', () => {
    expect(findingsFor(wired(), 'IX-01')).toEqual([]);
  });

  it('a source that does not group by the dim blocks, and the fix removes the interaction', () => {
    const s = wired();
    s.widgets[1].bind.dims = ['scenario_code'];
    const [f] = findingsFor(s, 'IX-01');
    expect(f.severity).toBe('BLOCK');
    expect(f.message).toContain('nothing on the widget to click');
    roundTrip(s, 'IX-01');
  });

  it('a target whose metric lacks the dim blocks — a filter that cannot apply', () => {
    const s = wired();
    s.widgets[0].bind.metric = 'keel://liquidity_pit.group_total@4'; // headline-only, no entity_id
    delete s.widgets[0].bind.compare;
    const [f] = findingsFor(s, 'IX-01');
    expect(f.severity).toBe('BLOCK');
    expect(f.message).toContain('no entity_id dimension');
    roundTrip(s, 'IX-01');
  });
});

describe('the report', () => {
  it('orders findings BLOCK first and counts by severity', () => {
    const s = baseSpec();
    delete s.widgets[0].bind.compare; // KPI-02 WARN
    s.widgets[1].bind.dims = ['entity_id']; // TS-01 BLOCK
    const r = lint(s, ctx());
    expect(r.counts).toEqual({ block: 1, warn: 1, suggest: 0 });
    expect(r.findings[0].severity).toBe('BLOCK');
  });
});
