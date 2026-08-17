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
  families: z.array(z.enum(['kpi', 'timeseries', 'bar', 'table', 'grid', 'part_to_whole'])).min(1),
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
];
