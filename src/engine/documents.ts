/** The two metrics views the surface opens with. */

export const VIEW_FILES = ['liquidity_pit', 'irrbb_eve'] as const;
export type ViewFile = (typeof VIEW_FILES)[number];

const LIQUIDITY_PIT = `version: 1
view: liquidity_pit
source: alm.fct_liquidity_position
targets: [duckdb, snowflake, databricks, bigquery, dremio]
grain:
  type: stock
  as_of_field: as_of_date
  max_query_span: P1D

measures:
  - name: hqla_total
    label: Total Eligible HQLA
    description: Post-haircut, post-cap eligible HQLA from the regulatory engine.
    type: simple
    agg: sum
    field: hqla_eligible_amount
    where: is_encumbered = false
    format: currency_usd
    valid_range: [0, 900000000000]
    sr_11_7_tier: 1
    citation: 12 CFR 249.20-22
    validation_status: validated
    change_ticket: ALM-4471

  - name: gross_outflows_30d
    type: simple
    agg: sum
    field: outflow_amount_30d
    format: currency_usd

  - name: capped_inflows_30d
    type: simple
    agg: sum
    field: inflow_amount_capped_30d
    format: currency_usd

  - name: net_cash_outflows_30d
    description: Total net cash outflows over the 30-day stress horizon, floored at zero.
    type: derived
    requires: [gross_outflows_30d, capped_inflows_30d]
    expression: >
      greatest(gross_outflows_30d - capped_inflows_30d, 0)
    format: currency_usd
    valid_range: [0, 900000000000]

  - name: lcr_pct
    label: Liquidity Coverage Ratio
    type: derived
    requires: [hqla_total, net_cash_outflows_30d]
    expression: >
      100.0 * hqla_total / nullif(net_cash_outflows_30d, 0)
    format: percent_1dp
    valid_range: [0, 500]
    sr_11_7_tier: 1
    citation: 12 CFR 249.20
    validation_status: validated

  - name: lcr_buffer
    type: derived
    requires: [lcr_pct]
    expression: >
      lcr_pct * 1.0473
    format: percent_1dp

  - name: lcr_stress
    type: derived
    requires: [lcr_pct]
    expression: >
      lcr_pct * 0.834
    format: percent_1dp
    valid_range: [0, 500]
    sr_11_7_tier: 2
    citation: 12 CFR 249.20

  - name: lcr_headroom
    type: derived
    requires: [lcr_pct, net_cash_outflows_30d]
    expression: >
      (lcr_pct - 100.0) / 100.0 * net_cash_outflows_30d
    format: currency_usd

  - name: hqla_us_unencumbered
    description: Eligible HQLA held by the US entity, excluding encumbered positions.
    type: simple
    agg: sum
    field: hqla_eligible_amount
    where: is_encumbered = false and entity_id = 'BANK_US'
    format: currency_usd

  - name: lcr_dod_change
    description: Day-over-day move in the coverage ratio.
    type: windowed
    requires: [lcr_pct]
    window.op: delta
    window.over: 1d
    window.order_by: as_of_date
    format: percent_1dp

  - name: lcr_vol_30d
    description: Volatility of the coverage ratio across the trailing 30 days.
    type: windowed
    requires: [lcr_pct]
    window.op: stddev
    window.over: 30d
    window.order_by: as_of_date
    format: percent_2dp

  - name: lcr_shortfall
    description: How far below the 100% minimum the ratio sits, zero when compliant.
    type: derived
    requires: [lcr_pct]
    expression: >
      case when lcr_pct < 100.0 then 100.0 - lcr_pct else 0.0 end
    format: percent_1dp`;

const IRRBB_EVE = `version: 1
view: irrbb_eve
source: alm.fct_repricing_gap
targets: [duckdb, snowflake, databricks, bigquery, dremio]
grain:
  type: stock
  as_of_field: as_of_date
  max_query_span: P1D

measures:
  - name: pv_assets
    description: Present value of asset cashflows on the base curve.
    type: simple
    agg: sum
    field: pv_asset_amount
    format: currency_usd

  - name: pv_liabilities
    description: Present value of liability cashflows on the base curve.
    type: simple
    agg: sum
    field: pv_liability_amount
    format: currency_usd

  - name: eve_base
    description: Economic value of equity on the base curve.
    type: derived
    requires: [pv_assets, pv_liabilities]
    expression: >
      pv_assets - pv_liabilities
    format: currency_usd
    valid_range: [-900000000000, 900000000000]
    sr_11_7_tier: 1
    citation: SR 96-13
    validation_status: validated

  - name: eve_up200
    description: Economic value of equity under a parallel +200bp shock.
    type: derived
    requires: [pv_assets, pv_liabilities]
    expression: >
      pv_assets * 0.9412 - pv_liabilities * 0.9689
    format: currency_usd

  - name: eve_delta_up200
    type: derived
    requires: [eve_base, eve_up200]
    expression: >
      eve_up200 - eve_base
    format: currency_usd
    valid_range: [-900000000000, 900000000000]
    sr_11_7_tier: 1
    citation: SR 96-13
    validation_status: in_review

  - name: nii_12m_smoothed
    type: windowed
    requires: [nii_12m_legacy]
    expression: >
      ema(nii_12m_legacy, 3)
    partition_by: [entity]
    order_by: [as_of_date]
    format: currency_usd

  - name: desk_overlay
    type: simple
    agg: sum
    field: tsy_desk_pnl
    format: currency_usd

  - name: eve_delta_vol_30d
    description: Volatility of the +200bp EVE change across the trailing 30 days.
    type: windowed
    requires: [eve_delta_up200]
    window.op: stddev
    window.over: 30d
    window.order_by: as_of_date
    format: currency_usd

  - name: eve_risk_band
    description: Supervisory band — 1 when the EVE change exceeds 15% of base equity, else 0.
    type: derived
    requires: [eve_delta_up200, eve_base]
    expression: >
      case when abs(eve_delta_up200) > 0.15 * eve_base then 1.0 else 0.0 end
    format: number`;

export const INITIAL_DOCS: Record<ViewFile, string> = {
  liquidity_pit: LIQUIDITY_PIT,
  irrbb_eve: IRRBB_EVE,
};

/** The measure each view opens on. */
export const DEFAULT_MEASURE: Record<ViewFile, string> = {
  liquidity_pit: 'lcr_pct',
  irrbb_eve: 'eve_delta_up200',
};
