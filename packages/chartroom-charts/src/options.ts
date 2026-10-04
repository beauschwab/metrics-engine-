/**
 * The chart gallery, as data (ADR-92): every kind a reader may chart a grid
 * selection as, the Evil Charts module that draws it, and the appearance
 * options it offers. React-free, so the planner, the studio's picker and the
 * tests read one list.
 *
 * Options are appearance only — a fill, a curve, a stroke, an arc. They live
 * in the widget's renderer-owned `state` (ADR-83). Anything that changes what
 * a number *means* is not an option: a stack sums its parts, so a stacked
 * chart is its own widget type in the `part_to_whole` family, where AREA-01
 * and PIE-01 judge it — never a toggle the linter cannot see.
 */

export type ChartKind =
  | 'evil-bar' | 'evil-stacked-bar' | 'evil-composed'
  | 'evil-line' | 'evil-area' | 'evil-stacked-area'
  | 'evil-pie' | 'evil-radial' | 'evil-radar' | 'evil-sankey';

export interface ChartOption {
  key: string;
  label: string;
  values: readonly string[];
  default: string;
}

/** What a kind reads from a selection — the planner matches on this. */
export type ChartShape =
  /** One dimension across, the value as the size. */
  | 'category'
  /** One dimension across, a second one as side-by-side or stacked series. */
  | 'category-series'
  /** The selected groups, each a line over the window. */
  | 'over-time'
  /** From one dimension's values to another's. */
  | 'flow';

export interface ChartKindSpec {
  kind: ChartKind;
  /** The catalog type ref the added widget carries. */
  type: `${ChartKind}@1`;
  label: string;
  /** What the chart answers, said in a line for the picker. */
  blurb: string;
  /** The Evil Charts module that draws it, as the registry names it. */
  source: string;
  shape: ChartShape;
  /** Whether a second selected dimension becomes series (category kinds). */
  series: 'none' | 'optional' | 'required';
  options: readonly ChartOption[];
}

const opt = (key: string, label: string, values: readonly string[], dflt = values[0]!): ChartOption =>
  ({ key, label, values, default: dflt });

const BAR_FILL = ['default', 'gradient', 'duotone', 'duotone-reverse', 'hatched', 'stripped'] as const;
const AREA_FILL = ['gradient', 'gradient-reverse', 'solid', 'dotted', 'lines', 'hatched'] as const;
const STROKE = ['solid', 'dashed', 'animated-dashed'] as const;
const CURVE = ['monotone', 'linear', 'step', 'bump'] as const;
const DOTS = ['none', 'default', 'border', 'colored-border'] as const;
const BACKGROUND = ['none', 'dots', 'grid', 'diagonal-lines', 'cross-hatch', 'plus'] as const;
const LEGEND = ['rounded-square', 'square', 'circle', 'circle-outline', 'vertical-bar', 'horizontal-bar'] as const;
const ONOFF = ['off', 'on'] as const;

export const CHART_KINDS: readonly ChartKindSpec[] = [
  {
    kind: 'evil-bar', type: 'evil-bar@1', label: 'Bar', source: 'recharts-bar-chart',
    blurb: 'The value per group, biggest first — or grouped side by side by a second dimension.',
    shape: 'category', series: 'optional',
    options: [
      opt('variant', 'Fill', BAR_FILL), opt('layout', 'Layout', ['vertical', 'horizontal']),
      opt('glow', 'Glow', ONOFF), opt('background', 'Background', BACKGROUND), opt('legend', 'Legend', LEGEND),
    ],
  },
  {
    kind: 'evil-stacked-bar', type: 'evil-stacked-bar@1', label: 'Stacked bar', source: 'recharts-bar-chart',
    blurb: 'Each bar the sum of its parts — or every bar to 100%, the parts as shares.',
    shape: 'category-series', series: 'required',
    options: [
      opt('stack', 'Stack', ['stacked', 'percent']), opt('variant', 'Fill', BAR_FILL),
      opt('layout', 'Layout', ['vertical', 'horizontal']), opt('background', 'Background', BACKGROUND), opt('legend', 'Legend', LEGEND),
    ],
  },
  {
    kind: 'evil-composed', type: 'evil-composed@1', label: 'Bar and line', source: 'recharts-composed-chart',
    blurb: 'Today as bars, the prior close as a line over them — the move per group at a glance.',
    shape: 'category', series: 'none',
    options: [
      opt('variant', 'Bar fill', BAR_FILL), opt('stroke', 'Line stroke', STROKE, 'dashed'),
      opt('curve', 'Curve', CURVE),
    ],
  },
  {
    kind: 'evil-line', type: 'evil-line@1', label: 'Line', source: 'recharts-line-chart',
    blurb: 'Each selected group as a line over the window.',
    shape: 'over-time', series: 'none',
    options: [
      opt('curve', 'Curve', CURVE), opt('stroke', 'Stroke', STROKE), opt('dots', 'Points', DOTS),
      opt('glow', 'Glow', ONOFF), opt('legend', 'Legend', LEGEND),
    ],
  },
  {
    kind: 'evil-area', type: 'evil-area@1', label: 'Area', source: 'recharts-area-chart',
    blurb: 'Each selected group as a filled line over the window, overlapping, never summed.',
    shape: 'over-time', series: 'none',
    options: [
      opt('variant', 'Fill', AREA_FILL), opt('curve', 'Curve', CURVE), opt('stroke', 'Stroke', STROKE),
      opt('legend', 'Legend', LEGEND),
    ],
  },
  {
    kind: 'evil-stacked-area', type: 'evil-stacked-area@1', label: 'Stacked area', source: 'recharts-area-chart',
    blurb: 'The selected groups stacked over the window: the top edge is their total — or every day to 100%.',
    shape: 'over-time', series: 'none',
    options: [
      opt('stack', 'Stack', ['stacked', 'expanded']), opt('variant', 'Fill', AREA_FILL), opt('curve', 'Curve', CURVE),
      opt('legend', 'Legend', LEGEND),
    ],
  },
  {
    kind: 'evil-pie', type: 'evil-pie@1', label: 'Pie', source: 'recharts-pie-chart',
    blurb: 'Each group’s share of the selection’s whole — five slices at most (PIE-01).',
    shape: 'category', series: 'none',
    options: [
      opt('shape', 'Shape', ['donut', 'pie']), opt('padding', 'Gaps', ['padded', 'none']),
      opt('labels', 'Labels', ONOFF), opt('legend', 'Legend', LEGEND),
    ],
  },
  {
    kind: 'evil-radial', type: 'evil-radial@1', label: 'Radial bar', source: 'recharts-radial-chart',
    blurb: 'The value per group as rings, the biggest the full sweep.',
    shape: 'category', series: 'none',
    options: [opt('arc', 'Arc', ['full', 'semi']), opt('track', 'Track', ['on', 'off']), opt('legend', 'Legend', LEGEND)],
  },
  {
    kind: 'evil-radar', type: 'evil-radar@1', label: 'Radar', source: 'recharts-radar-chart',
    blurb: 'The groups as spokes — the profile’s shape; a second dimension overlays one shape per value.',
    shape: 'category', series: 'optional',
    options: [
      opt('variant', 'Fill', ['filled', 'lines']), opt('grid', 'Grid', ['polygon', 'circle']),
      opt('dots', 'Points', DOTS, 'border'), opt('glow', 'Glow', ONOFF), opt('background', 'Background', BACKGROUND),
      opt('legend', 'Legend', LEGEND),
    ],
  },
  {
    kind: 'evil-sankey', type: 'evil-sankey@1', label: 'Flow', source: 'recharts-sankey-chart',
    blurb: 'From one dimension’s values to another’s, each link as wide as its value.',
    shape: 'flow', series: 'none',
    options: [
      opt('link', 'Links', ['gradient', 'source', 'target', 'solid']), opt('labels', 'Labels', ['outside', 'inside']),
      opt('values', 'Values', ['on', 'off']),
    ],
  },
];

export const CHART_KIND_BY_TYPE: ReadonlyMap<string, ChartKindSpec> = new Map(CHART_KINDS.map((k) => [k.type, k]));
export const CHART_KIND: ReadonlyMap<ChartKind, ChartKindSpec> = new Map(CHART_KINDS.map((k) => [k.kind, k]));

/**
 * A widget's options, read from its state: every option the kind declares,
 * with the stored value where it is one of the kind's values and the default
 * where it is not — a state written by an older gallery, or by hand, reads as
 * the default rather than as nothing.
 */
export function chartOptions(type: string, state: Record<string, unknown> | undefined): Record<string, string> {
  const spec = CHART_KIND_BY_TYPE.get(type);
  if (!spec) return {};
  const raw = (state?.chart ?? {}) as Record<string, unknown>;
  return Object.fromEntries(spec.options.map((o) => {
    const v = raw[o.key];
    return [o.key, typeof v === 'string' && o.values.includes(v) ? v : o.default];
  }));
}

/** The state a widget is added with: the options under `chart`, so a later renderer state can sit beside them. */
export function chartState(options: Record<string, string>): Record<string, unknown> {
  return { chart: { ...options } };
}
