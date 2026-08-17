/**
 * Shared lint fixtures — contracts shaped like the real registry's.
 *
 * The implementation spec asks that rules be tested "against true contract
 * shapes, not synthetic ones": these mirror the shipped `liquidity_pit`
 * measures (units, precisions, the real dim domains) with two deliberate
 * additions — a draft-status metric for GOV-02 and a `pie@1` widget contract,
 * which the real catalog refuses to carry, so that PIE-01's family logic is
 * testable at all.
 */

import type {
  DashboardSpec, LintContext, MetricContract, WidgetContract,
} from '../src/index';

const DIMS: MetricContract['dims'] = [
  { name: 'as_of_date', type: 'time' },
  { name: 'entity_id', type: 'categorical', values: ['WF-US', 'WF-EMEA', 'WF-APAC'] },
  { name: 'scenario_code', type: 'categorical', values: ['BASE', 'STRESS', 'SEVERE'] },
  {
    name: 'bucket_code', type: 'categorical', ordinal: true,
    values: ['O/N', '2-7D', '8-30D', '31-90D', 'GT90D', 'OPEN'],
  },
  { name: 'is_encumbered', type: 'boolean' },
];

function metric(over: Partial<MetricContract> & { ref: string }): MetricContract {
  const parsed = /^keel:\/\/([a-z0-9_]+)\.([a-z0-9_]+)@(\d+)$/.exec(over.ref)!;
  return {
    doc: parsed[1], measure: parsed[2], version: Number(parsed[3]),
    status: 'approved', grain: 'alm.fct_liquidity_position', dims: DIMS,
    unit: 'USD', precision: 0, format: 'currency_usd',
    allowed_aggregations: ['sum'], denominator_of: null,
    owner: 'alm-desk', lineage_urn: 'alm.fct_liquidity_position',
    ...over,
  };
}

export const CONTRACTS: MetricContract[] = [
  metric({
    ref: 'keel://liquidity_pit.lcr_pct@4', unit: 'percent', precision: 1,
    format: 'percent_1dp', allowed_aggregations: [],
    denominator_of: 'net_cash_outflows_30d',
  }),
  metric({ ref: 'keel://liquidity_pit.hqla_total@4' }),
  metric({ ref: 'keel://liquidity_pit.net_cash_outflows_30d@4' }),
  metric({
    ref: 'keel://liquidity_pit.nsfr_pct@4', unit: 'percent', precision: 1,
    format: 'percent_1dp', allowed_aggregations: [],
    denominator_of: 'required_stable_funding',
  }),
  metric({ ref: 'keel://liquidity_pit.lcr_floor@4', unit: 'percent', precision: 1, format: 'percent_1dp' }),
  metric({ ref: 'keel://scratch.candidate@9', status: 'draft', doc: 'scratch', measure: 'candidate' }),
];

export const WIDGETS: WidgetContract[] = [
  {
    widget: 'kpi-tile', version: 1, family: 'kpi',
    accepts: { supports: ['compare', 'filters'] }, guide_rules: ['KPI-02'],
  },
  {
    widget: 'timeseries', version: 1, family: 'timeseries',
    accepts: { requires_time_dim: true, max_series: 8, supports: ['bands', 'compare', 'window', 'filters'] },
    guide_rules: ['TS-01', 'TS-02'],
  },
  {
    widget: 'bar', version: 1, family: 'bar',
    accepts: { categorical_dims: { min: 1, max: 1 }, supports: ['sort', 'filters'] },
    guide_rules: ['BAR-02'],
  },
  {
    widget: 'delta-table', version: 1, family: 'table',
    accepts: { categorical_dims: { min: 1, max: 2 }, supports: ['filters'] }, guide_rules: [],
  },
  {
    widget: 'perspective-grid', version: 1, family: 'grid',
    accepts: { categorical_dims: { min: 1, max: 4 }, supports: ['max_cells', 'filters'] },
    guide_rules: ['GRID-01'],
  },
  // Not in the real catalog — exists so PIE-01's family logic is testable.
  {
    widget: 'pie', version: 1, family: 'part_to_whole',
    accepts: { categorical_dims: { min: 1, max: 1 }, supports: [] }, guide_rules: ['PIE-01'],
  },
];

export function ctx(): LintContext {
  return {
    contracts: new Map(CONTRACTS.map((c) => [c.ref, c])),
    widgets: new Map(WIDGETS.map((w) => [`${w.widget}@${w.version}`, w])),
  };
}

/** A clean two-widget dashboard — every rule's "good" baseline. */
export function baseSpec(): DashboardSpec {
  return {
    chartroom: '0.1',
    dashboard: {
      id: 'lcr-monitor', title: 'LCR Monitor', pattern: 'liquidity-monitor@1',
      audience: 'alm-analyst', cadence: 'eod', status: 'draft',
    },
    context: {},
    layout: { grid: { cols: 12, row_height: 96 } },
    widgets: [
      {
        id: 'lcr-tile', type: 'kpi-tile@1', pos: { x: 0, y: 0, w: 3, h: 2 },
        bind: {
          metric: 'keel://liquidity_pit.lcr_pct@4',
          compare: { vs: 'keel://liquidity_pit.lcr_floor@4', style: 'threshold' },
        },
      },
      {
        id: 'lcr-trend', type: 'timeseries@1', pos: { x: 3, y: 0, w: 9, h: 4 },
        bind: {
          metric: 'keel://liquidity_pit.lcr_pct@4',
          dims: ['as_of_date'],
          window: { trailing: '60d' },
        },
      },
    ],
    interactions: [],
  };
}
