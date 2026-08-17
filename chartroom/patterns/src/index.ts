/**
 * chartroom-patterns — the catalog of reviewed dashboard archetypes, and the
 * design guide's rationale text. Versioned data, no logic: the agent reads
 * these through `list_patterns` / `get_design_rules` and must either
 * instantiate a pattern or justify in the brief why none fits. That
 * either/or is the single biggest lever against dashboard sprawl, which is
 * why "no pattern" costs a written justification and a pattern costs nothing.
 */

import { z } from 'zod';

export const PatternSlotSchema = z.strictObject({
  name: z.string().min(1),
  /** Widget families that can fill this slot — families, not type refs, so a catalog upgrade does not orphan patterns. */
  families: z.array(z.enum([
    'kpi', 'timeseries', 'bar', 'table', 'grid', 'part_to_whole',
    'waterfall', 'heatmap', 'annotation',
  ])).min(1),
  count: z.strictObject({ min: z.number().int().min(0), max: z.number().int().min(1) }),
  required: z.boolean(),
  intent: z.string().min(10),
});

export const PatternSchema = z.strictObject({
  pattern: z.string().regex(/^[a-z][a-z0-9-]*$/),
  version: z.number().int().positive(),
  title: z.string().min(3),
  /** The decision shapes this pattern serves — matched against the intake's decision slot. */
  serves: z.string().min(20),
  when_not: z.string().min(20),
  audience_default: z.enum(['trader', 'alm-analyst', 'treasury-committee', 'cfo', 'exec']),
  slots: z.array(PatternSlotSchema).min(2),
  wireframe: z.string().min(20),
});
export type Pattern = z.infer<typeof PatternSchema>;

export const PATTERNS: Pattern[] = [
  {
    pattern: 'limit-utilization-board',
    version: 1,
    title: 'Limit Utilization Board',
    serves: 'Am I inside my limits, how fast is the distance closing, and where — the '
      + 'decision is whether to act before a breach, not to explain one after.',
    when_not: 'If the question is why a number moved rather than whether it is inside a '
      + 'limit, use metric-deep-dive; a limit board with no limits is decoration.',
    audience_default: 'treasury-committee',
    slots: [
      {
        name: 'utilization-tiles', families: ['kpi'], count: { min: 2, max: 4 }, required: true,
        intent: 'Each governed limit as one judged number — the measure against its threshold '
          + 'or its prior, semantic emphasis on.',
      },
      {
        name: 'utilization-trend', families: ['timeseries'], count: { min: 1, max: 1 }, required: true,
        intent: 'The headline utilization over its trailing window, banded by the limit measure, '
          + 'so "how fast is it closing" is a slope the eye reads.',
      },
      {
        name: 'breach-detail', families: ['table'], count: { min: 1, max: 1 }, required: true,
        intent: 'Per-entity or per-desk day-over-day moves — where the pressure is coming from.',
      },
    ],
    wireframe: [
      '┌─────┬─────┬─────┬─────┐',
      '│ KPI │ KPI │ KPI │ KPI │   utilization-tiles',
      '├─────┴─────┴─────┴─────┤',
      '│     timeseries        │   utilization-trend (banded)',
      '├───────────────────────┤',
      '│     delta-table       │   breach-detail',
      '└───────────────────────┘',
    ].join('\n'),
  },
  {
    pattern: 'liquidity-monitor',
    version: 1,
    title: 'Liquidity Monitor',
    serves: 'Is the liquidity position sound today and trending sound — coverage headline, '
      + 'its trajectory against the regulatory floor, and the composition underneath it.',
    when_not: 'For a single metric investigated in depth, metric-deep-dive; for a committee '
      + 'pack of many unrelated limits, limit-utilization-board.',
    audience_default: 'alm-analyst',
    slots: [
      {
        name: 'coverage-tiles', families: ['kpi'], count: { min: 1, max: 2 }, required: true,
        intent: 'The coverage ratio and its headroom, judged against prior or floor.',
      },
      {
        name: 'coverage-trend', families: ['timeseries'], count: { min: 1, max: 1 }, required: true,
        intent: 'The ratio over its window with the governed floor or stress measure as a band.',
      },
      {
        name: 'composition', families: ['bar'], count: { min: 1, max: 1 }, required: true,
        intent: 'What the aggregate is made of — by bucket, by level, by class — in ladder order.',
      },
      {
        name: 'decomposition-grid', families: ['grid', 'table'], count: { min: 0, max: 1 }, required: false,
        intent: 'The two-dimensional cut for the analyst who asks "which entity, which product".',
      },
    ],
    wireframe: [
      '┌─────┬─────────────────┐',
      '│ KPI │                 │',
      '├─────┤   timeseries    │  coverage-tiles / coverage-trend',
      '│ KPI │   (banded)      │',
      '├─────┴───┬─────────────┤',
      '│   bar   │    grid     │  composition / decomposition-grid',
      '└─────────┴─────────────┘',
    ].join('\n'),
  },
  {
    pattern: 'metric-deep-dive',
    version: 1,
    title: 'Metric Deep-Dive',
    serves: 'Why did this one number move — the hero series, the dimensional breakdowns '
      + 'that decompose the move, and the day-over-day arithmetic per group.',
    when_not: 'More than one hero metric means this is not a deep-dive; use a monitor '
      + 'pattern or split into two dashboards that each answer one question.',
    audience_default: 'alm-analyst',
    slots: [
      {
        name: 'hero', families: ['timeseries'], count: { min: 1, max: 1 }, required: true,
        intent: 'The metric itself, full width, longest window the cadence supports.',
      },
      {
        name: 'headline', families: ['kpi'], count: { min: 1, max: 1 }, required: true,
        intent: 'The as-of value with its day-over-day judgment, so the chart has a number.',
      },
      {
        name: 'breakdowns', families: ['bar', 'table'], count: { min: 1, max: 2 }, required: true,
        intent: 'The metric split by its driving dimensions — sorted by contribution, '
          + 'ladder order only where the dimension is ordinal.',
      },
    ],
    wireframe: [
      '┌─────┬─────────────────┐',
      '│ KPI │                 │  headline',
      '├─────┘                 │',
      '│      timeseries       │  hero',
      '├───────────┬───────────┤',
      '│    bar    │   table   │  breakdowns',
      '└───────────┴───────────┘',
    ].join('\n'),
  },

  // ---- Phase 9 (E9.3) ----------------------------------------------------

  {
    pattern: 'variance-walk',
    version: 1,
    title: 'Variance Walk',
    serves: 'What explains the move between two dates — the bridge from prior to current, '
      + 'the drivers behind each step, and the written reason the committee will actually '
      + 'quote back. The decision is whether the move is understood well enough to accept.',
    when_not: 'If the question is whether a number is inside a limit rather than why it '
      + 'moved, use limit-utilization-board. A walk over a non-additive measure explains '
      + 'nothing — the steps cannot compose the total, which WF-01 blocks outright.',
    audience_default: 'treasury-committee',
    slots: [
      {
        name: 'bridge', families: ['waterfall'], count: { min: 1, max: 1 }, required: true,
        intent: 'Opening total, one step per driver, closing total — the arithmetic of the '
          + 'move, over the whole population so the steps actually reconcile.',
      },
      {
        name: 'drivers', families: ['timeseries'], count: { min: 1, max: 1 }, required: true,
        intent: 'The same split as the bridge, over time and on a shared scale, so a step '
          + 'that looks like a one-day shock can be told from one that has been building.',
      },
      {
        name: 'commentary', families: ['annotation'], count: { min: 1, max: 2 }, required: true,
        intent: 'The written explanation, bound to the metric it explains — so the sentence '
          + 'travels with the revision it was written about instead of drifting in an email.',
      },
    ],
    wireframe: [
      '┌───────────────────────┐',
      '│      waterfall        │  bridge',
      '├───────────┬───────────┤',
      '│  small-   │ annotation│  drivers · commentary',
      '│ multiples │           │',
      '└───────────┴───────────┘',
    ].join('\n'),
  },
  {
    pattern: 'scenario-comparison',
    version: 1,
    title: 'Scenario Comparison',
    serves: 'How the picture changes under each scenario — the same measure across '
      + 'scenarios on one scale, and the arithmetic difference between them. The decision '
      + 'is which scenario to plan against, so the comparison must be like-for-like.',
    when_not: 'If only one scenario matters, this is a deep-dive with extra chrome. If the '
      + 'scenarios use different denominators the comparison is not like-for-like at all — '
      + 'DEN-01 catches the side-by-side case, but the judgment is yours.',
    audience_default: 'treasury-committee',
    slots: [
      {
        name: 'panels', families: ['timeseries'], count: { min: 1, max: 1 }, required: true,
        intent: 'One panel per scenario on a shared scale — the comparison the pattern '
          + 'exists for, and the reason SM-01 refuses per-panel scaling.',
      },
      {
        name: 'delta', families: ['table'], count: { min: 1, max: 1 }, required: true,
        intent: 'The scenario-versus-base arithmetic per group, because "visibly lower" is '
          + 'not a number anyone can put in minutes.',
      },
      {
        name: 'headline', families: ['kpi'], count: { min: 0, max: 2 }, required: false,
        intent: 'The selected scenario\'s headline value, judged against its limit.',
      },
    ],
    wireframe: [
      '┌─────┬─────┬─────┬─────┐',
      '│  ▁▂▃│  ▁▂▃│  ▁▂▃│  ▁▂▃│  panels (one per scenario, shared scale)',
      '├─────┴─────┴─────┴─────┤',
      '│      delta-table      │  delta',
      '└───────────────────────┘',
    ].join('\n'),
  },
  {
    pattern: 'exec-summary',
    version: 1,
    title: 'Executive Summary',
    serves: 'Is anything wrong, and where do I look next — a small set of judged headlines '
      + 'and the two trends that carry the story. The decision is whether to delegate or '
      + 'to dig, so density is the design constraint, not a preference.',
    when_not: 'If the reader needs to explain a move rather than notice one, use '
      + 'metric-deep-dive or variance-walk. An exec summary that grows past a handful of '
      + 'tiles has become a monitor, and stops being readable in the thirty seconds it gets.',
    audience_default: 'exec',
    slots: [
      {
        name: 'headlines', families: ['kpi'], count: { min: 3, max: 6 }, required: true,
        intent: 'Each governed headline as one judged number against its limit — six is the '
          + 'ceiling because a seventh tile is one nobody reads.',
      },
      {
        name: 'trends', families: ['timeseries'], count: { min: 1, max: 2 }, required: true,
        intent: 'The two series that carry the story, windowed to the reporting period.',
      },
      {
        name: 'commentary', families: ['annotation'], count: { min: 0, max: 1 }, required: false,
        intent: 'One short written note — what changed and what is being done about it.',
      },
    ],
    wireframe: [
      '┌────┬────┬────┬────┬────┐',
      '│ KPI│ KPI│ KPI│ KPI│ KPI│  headlines (≤6)',
      '├────┴────┴─┬──┴────┴────┤',
      '│ timeseries│ timeseries │  trends',
      '└───────────┴────────────┘',
    ].join('\n'),
  },
];

export const PATTERNS_BY_REF: Map<string, Pattern> = new Map(
  PATTERNS.map((p) => [`${p.pattern}@${p.version}`, p]),
);

// ---------------------------------------------------------------------------
// The design guide's rationale, rule by rule — what the agent cites when it
// routes a pie to a sorted bar. Users learn the guide by using the tool.
// ---------------------------------------------------------------------------

export interface RuleGuide {
  rule: string;
  title: string;
  rationale: string;
  enforced: 'linter' | 'linter+schema';
  autofix: boolean;
}

export const RULE_GUIDE: RuleGuide[] = [
  {
    rule: 'REF-01', title: 'Every binding resolves', enforced: 'linter', autofix: false,
    rationale: 'A metric or dimension the registry does not know cannot render; reporting '
      + '"clean" about an unrenderable dashboard is the linter\'s version of a confident zero.',
  },
  {
    rule: 'TS-01', title: 'Time on the x-axis', enforced: 'linter+schema', autofix: true,
    rationale: 'Reversed or non-time x-axes are unrepresentable in the spec; the remaining '
      + 'mistake is a time widget with no time dimension bound, which the fix adds from the contract.',
  },
  {
    rule: 'TS-02', title: 'At most eight series', enforced: 'linter', autofix: false,
    rationale: 'Past the series budget a line chart is a haystack. Split into small multiples '
      + 'or filter — the reader\'s eye cannot track a dozen lines and should not be asked to.',
  },
  {
    rule: 'BAR-02', title: 'Bars sort by value unless ordinal', enforced: 'linter', autofix: true,
    rationale: 'The first glance at a bar chart answers "what is biggest" — unless the dimension '
      + 'has its own order (tenor ladders), which the contract declares and the chart must keep.',
  },
  {
    rule: 'PIE-01', title: 'Part-to-whole beyond five slices becomes a sorted bar',
    enforced: 'linter+schema', autofix: true,
    rationale: 'Angles are unreadable past a handful of slices. No pie ships in the catalog at '
      + 'all; the rule guards the part-to-whole family that does and will.',
  },
  {
    rule: 'COL-03', title: 'Semantic colour is reserved for thresholds', enforced: 'linter+schema', autofix: true,
    rationale: 'Breach red is a meaning, not a style. Decoration that borrows the breach palette '
      + 'teaches readers to ignore the breach palette, which is the most expensive lesson a '
      + 'risk surface can teach.',
  },
  {
    rule: 'NUM-01', title: 'Formatting belongs to the function', enforced: 'linter+schema', autofix: true,
    rationale: 'Units are not overridable at all; precision may drift ±1 from the contract. '
      + 'A bp metric renders as bps on every dashboard, or the same number reads differently '
      + 'in two meetings.',
  },
  {
    rule: 'KPI-02', title: 'A KPI tile declares a comparison', enforced: 'linter', autofix: false,
    rationale: 'A number with no reference — limit, prior, budget — cannot be judged at a '
      + 'glance, and judging at a glance is the only job a tile has. WARN, because sometimes '
      + 'the number genuinely is the headline.',
  },
  {
    rule: 'DEN-01', title: 'Side-by-side ratios share a denominator', enforced: 'linter', autofix: false,
    rationale: 'Two ratios on one visual row invite comparison; comparing a/x with b/y as if '
      + 'x were y is how a committee reaches a wrong conclusion politely.',
  },
  {
    rule: 'GRID-01', title: 'A grid declares its cell ceiling', enforced: 'linter', autofix: true,
    rationale: 'Grid size is a product of cardinalities — "one more dim" is how a million cells '
      + 'happen. The guard is part of the binding, visible in review, not a runtime surprise.',
  },
  {
    rule: 'LAY-01', title: 'Widgets fit the grid and do not overlap', enforced: 'linter', autofix: true,
    rationale: 'Out-of-bounds gets a clamping fix; overlaps do not, because which widget moves '
      + 'is a design decision and a linter that makes design decisions gets turned off.',
  },
  {
    rule: 'GOV-01', title: 'Derived expressions cannot leave draft', enforced: 'linter', autofix: false,
    rationale: 'Ad-hoc ratios keep exploration fast; promotion is where they must be formalised '
      + 'into governed registry functions, or the calculation logic starts living in dashboards.',
  },
  {
    rule: 'GOV-02', title: 'Promoted dashboards bind only governed metrics', enforced: 'linter', autofix: false,
    rationale: 'Approved means the production channel serves exactly that revision. A team '
      + 'dashboard on an ungoverned metric distributes a number nobody signed.',
  },
  {
    rule: 'CTX-01', title: 'Filter params are declared contexts', enforced: 'linter', autofix: false,
    rationale: 'A filter reading an undeclared context is a dangling reference that silently '
      + 'matches nothing or everything depending on the renderer\'s charity — both wrong.',
  },
  {
    rule: 'AGG-01', title: 'Totals only total what totals', enforced: 'linter', autofix: false,
    rationale: 'A grid\'s margin totals sum structurally, and summing a ratio is a number that '
      + 'means nothing wearing the format of one that does. The contract\'s '
      + 'allowed_aggregations says which measures re-aggregate; the grid is only for those.',
  },
  {
    rule: 'IX-01', title: 'Cross-filters are answerable on both ends', enforced: 'linter', autofix: true,
    rationale: 'A cross-filter promises that a click narrows every target. A source that does '
      + 'not group by the dim has nothing to click; a target whose metric lacks the dim '
      + 'would show unfiltered numbers beside filtered ones — coherent-looking and wrong.',
  },
  {
    rule: 'AREA-01', title: 'A stack claims the parts make the whole', enforced: 'linter', autofix: true,
    rationale: 'Stacking asserts that the bands add up: the top edge is read as a total. Stack '
      + 'a ratio and that edge is a sum of percentages — a number with no referent that still '
      + 'looks authoritative. Stack a signed measure and the bands overlap each other, so the '
      + 'picture is wrong about ordering, not merely imprecise.',
  },
  {
    rule: 'GAUGE-01', title: 'A limit nobody governs is not a limit', enforced: 'linter', autofix: false,
    rationale: 'A bullet\'s whole claim is "here is the number, here is the line it must not '
      + 'cross", so the line has to be a governed metric with an owner and a revision. '
      + 'Comparing to the prior period instead shows movement, not a limit: a measure that '
      + 'drifts a little every day never breaches its own yesterday.',
  },
  {
    rule: 'SM-01', title: 'Small multiples share one scale', enforced: 'linter', autofix: true,
    rationale: 'Panels drawn to their own extents make a flat line and a cliff look identical, '
      + 'which defeats the only reason to put them side by side. A single panel is a timeseries '
      + 'wearing the wrong widget, and past the panel ceiling the shared scale that makes the '
      + 'comparison honest renders the smaller panels flat.',
  },
  {
    rule: 'WF-01', title: 'A bridge must actually bridge', enforced: 'linter', autofix: false,
    rationale: 'A waterfall asserts that opening plus contributions equals closing. When that '
      + 'fails it still looks like an explanation, so the reader concludes the move is '
      + 'understood while part of it is unaccounted for. Non-additive measures cannot compose '
      + 'a total, and a filtered bridge drops the excluded rows into the gap between its totals.',
  },
];
