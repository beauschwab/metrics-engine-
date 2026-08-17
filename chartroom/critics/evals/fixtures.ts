/**
 * Eval fixtures — good/bad pairs the design critic is measured against.
 *
 * Each bad case plants one deliberate composition defect the deterministic
 * linter cannot see (they all lint clean); each good case is its repaired
 * twin. The eval asserts severity expectations exactly and matches claims
 * fuzzily, per the implementation spec.
 */

import type { Brief, DashboardSpec, WidgetInstance } from 'chartroom-spec';

const REV = 1;
const lp = (m: string) => `keel://liquidity_pit.${m}@${REV}`;

export interface EvalCase {
  name: string;
  spec: DashboardSpec;
  brief: Brief;
  /** null = expect no BLOCKs; otherwise at least one finding at or above this. */
  expectDefect: null | { minSeverity: 'BLOCK' | 'WARN'; aboutWidget?: string; claimHint: RegExp };
}

const brief = (decision: string, over: Partial<Brief> = {}): Brief => ({
  dashboard_id: 'board',
  intake: {
    decision,
    audience: 'treasury-committee',
    cadence: 'eod',
    grain_entities: 'legal entity, consolidated',
    comparisons: 'against the 100% regulatory floor and prior day',
    thresholds: 'the LCR floor; breaches escalate to ALCO',
    sharing_scope: 'team',
    existing_overlap: 'no existing dashboard shows LCR headroom by entity',
  },
  pattern: { none: { justification: 'eval fixture — pattern catalog not under test here' } },
  bindings: [{ widget_slot: 'hero', metric: lp('lcr_pct'), dims: [] }],
  wireframe: '[hero KPI][trend]\n[detail table  ]',
  gaps: [],
  excluded: [],
  ...over,
});

const widget = (over: Partial<WidgetInstance> & { id: string }): WidgetInstance => ({
  type: 'kpi-tile@1',
  pos: { x: 0, y: 0, w: 3, h: 2 },
  bind: { metric: lp('lcr_pct'), compare: { vs: 'prior_period', style: 'delta' } },
  ...over,
});

const dashboard = (widgets: WidgetInstance[], title = 'LCR Board'): DashboardSpec => ({
  chartroom: '0.1',
  dashboard: {
    id: 'board', title, pattern: { none: { justification: 'eval fixture — pattern catalog not under test' } },
    audience: 'treasury-committee', cadence: 'eod', status: 'draft',
  },
  context: {},
  layout: { grid: { cols: 12, row_height: 96 } },
  widgets,
  interactions: [],
});

// ---------------------------------------------------------------------------

const heroTile = widget({ id: 'lcr-tile', title: 'LCR', pos: { x: 0, y: 0, w: 4, h: 2 } });
const trend = widget({
  id: 'lcr-trend', type: 'timeseries@1', title: 'LCR, 60 days',
  pos: { x: 4, y: 0, w: 8, h: 4 },
  bind: { metric: lp('lcr_pct'), dims: ['as_of_date'], window: { trailing: '60d' } },
});
const detail = widget({
  id: 'entity-detail', type: 'delta-table@1', title: 'HQLA by entity',
  pos: { x: 0, y: 4, w: 12, h: 3 },
  bind: { metric: lp('hqla_total'), dims: ['entity_id'] },
});

export const CASES: EvalCase[] = [
  // Pair 1 — hero answers the wrong decision.
  {
    name: 'bad: hero is desk P&L on an LCR-decision brief',
    spec: dashboard([
      widget({
        id: 'pnl-hero', title: 'Desk P&L', pos: { x: 0, y: 0, w: 9, h: 4 },
        bind: { metric: lp('hqla_us_unencumbered') },
      }),
      widget({ id: 'lcr-tile', title: 'LCR', pos: { x: 9, y: 4, w: 3, h: 2 } }),
    ]),
    brief: brief('Decide whether to act before an LCR floor breach'),
    expectDefect: { minSeverity: 'WARN', aboutWidget: 'pnl-hero', claimHint: /decision|hero|prominen|brief/i },
  },
  {
    name: 'good: hero answers the LCR decision',
    spec: dashboard([heroTile, trend, detail]),
    brief: brief('Decide whether to act before an LCR floor breach'),
    expectDefect: null,
  },

  // Pair 2 — exec density.
  {
    name: 'bad: twelve tiles for an exec audience',
    spec: dashboard(
      Array.from({ length: 12 }, (_, i) => widget({
        id: `tile-${i}`, title: `Metric ${i}`,
        pos: { x: (i % 4) * 3, y: Math.floor(i / 4) * 2, w: 3, h: 2 },
      })),
      'Exec Overview',
    ),
    brief: brief('Give the CFO a one-glance view of liquidity health', {
      intake: {
        ...brief('x').intake,
        decision: 'Give the CFO a one-glance view of liquidity health',
        audience: 'cfo',
      },
    }),
    expectDefect: { minSeverity: 'WARN', claimHint: /densit|tiles|exec|overwhelm|too many/i },
  },
  {
    name: 'good: three tiles and a trend for the exec',
    spec: dashboard([
      heroTile,
      widget({ id: 'headroom', title: 'Headroom', pos: { x: 4, y: 0, w: 4, h: 2 }, bind: { metric: lp('lcr_headroom'), compare: { vs: 'prior_period', style: 'delta' } } }),
      widget({ id: 'shortfall', title: 'Shortfall', pos: { x: 8, y: 0, w: 4, h: 2 }, bind: { metric: lp('lcr_shortfall'), compare: { vs: 'prior_period', style: 'delta' } } }),
      { ...trend, pos: { x: 0, y: 2, w: 12, h: 4 } },
    ]),
    brief: brief('Give the CFO a one-glance view of liquidity health'),
    expectDefect: null,
  },

  // Pair 3 — orphan widget off the brief.
  {
    name: 'bad: an IRRBB widget orphaned on a liquidity board',
    spec: dashboard([
      heroTile, trend,
      widget({
        id: 'eve-orphan', title: 'EVE +200bp', pos: { x: 0, y: 4, w: 12, h: 3 },
        bind: { metric: 'keel://irrbb_eve.eve_delta_up200@1', compare: { vs: 'prior_period', style: 'delta' } },
      }),
    ]),
    brief: brief('Decide whether to act before an LCR floor breach'),
    expectDefect: { minSeverity: 'WARN', aboutWidget: 'eve-orphan', claimHint: /orphan|unrelated|belong|coheren|irrbb|interest/i },
  },
  {
    name: 'good: every widget serves the liquidity decision',
    spec: dashboard([heroTile, trend, detail]),
    brief: brief('Decide whether to act before an LCR floor breach'),
    expectDefect: null,
  },

  // Pair 4 — brief promised a threshold view, composition lost it.
  {
    name: 'bad: brief promises floor comparison, no widget carries one',
    spec: dashboard([
      widget({ id: 'naked-lcr', title: 'LCR', pos: { x: 0, y: 0, w: 4, h: 2 }, bind: { metric: lp('lcr_pct') } }),
      { ...trend, bind: { metric: lp('lcr_pct'), dims: ['as_of_date'] } },
    ]),
    brief: brief('Judge distance to the regulatory floor before ALCO'),
    expectDefect: { minSeverity: 'WARN', claimHint: /floor|threshold|compar|band|promis/i },
  },
  {
    name: 'good: the floor comparison the brief promised is present',
    spec: dashboard([
      widget({
        id: 'lcr-vs-floor', title: 'LCR vs floor', pos: { x: 0, y: 0, w: 4, h: 2 },
        bind: { metric: lp('lcr_pct'), compare: { vs: lp('lcr_stress'), style: 'threshold' } },
        format: { emphasis: 'semantic' },
      }),
      { ...trend, bind: { ...trend.bind, bands: [lp('lcr_stress')] } },
    ]),
    brief: brief('Judge distance to the regulatory floor before ALCO'),
    expectDefect: null,
  },
];
