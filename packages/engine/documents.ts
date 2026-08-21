/** The two metrics views the surface opens with. */

export const VIEW_FILES = [
  'liquidity_pit',
  'irrbb_eve',
  'fr2052a_product_id',
  'lcr_outflow_rates',
  'fr2052a_prepared',
  'fr2052a_outflows',
  'fr2052a_submission',
  'fr2052a_variance',
  'murex_eu_binding',
] as const;
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

/**
 * FR 2052a product-ID mapping.
 *
 * An ordered rule set: the first rule whose condition holds assigns the
 * product ID. Order is load-bearing and declared, not incidental — `O.D.1`
 * must be tested before `O.D.3` or every insured retail balance falls through
 * to the less-stable bucket at more than three times the outflow rate.
 *
 * Every rule cites the paragraph it implements, because the rule set *is* the
 * regulatory interpretation and that is what model risk reviews.
 */
const FR2052A_PRODUCT_ID = `version: 1
kind: classification
name: fr2052a_product_id
display_name: FR 2052a — product ID assignment
source: alm.fct_2052a_positions

emits:
  column: product_id
  domain: fr2052a_product_ids
  notional: balance_usd
  on_no_match: error
  on_multi_match: first

effective:
  from: 2025-10-01

governance:
  owner: Liquidity Regulatory Reporting
  sr_11_7_tier: 1
  citation: FR 2052a Instructions
  validation_status: validated

rules:
  - id: OD-1
    emit: O.D.1
    label: Retail — insured, transactional
    when: direction = 'OUTFLOW' and is_secured = false and segment = 'RETAIL' and insured_flag = true and account_type = 'TRANSACTIONAL'
    citation: 12 CFR 249.32(a)(1)

  - id: OD-2
    emit: O.D.2
    label: Retail — insured, non-transactional
    when: direction = 'OUTFLOW' and is_secured = false and segment = 'RETAIL' and insured_flag = true
    citation: 12 CFR 249.32(a)(1)

  - id: OD-3
    emit: O.D.3
    label: Retail — uninsured
    when: direction = 'OUTFLOW' and is_secured = false and segment = 'RETAIL'
    citation: 12 CFR 249.32(a)(2)

  - id: OD-5
    emit: O.D.5
    label: Small business — insured
    when: direction = 'OUTFLOW' and is_secured = false and segment = 'SMALL_BUSINESS' and insured_flag = true
    citation: 12 CFR 249.32(a)(3)

  - id: OD-6
    emit: O.D.6
    label: Small business — uninsured
    when: direction = 'OUTFLOW' and is_secured = false and segment = 'SMALL_BUSINESS'
    citation: 12 CFR 249.32(a)(3)

  - id: OS-1
    emit: O.S.1
    label: Secured funding — level 1 collateral
    when: direction = 'OUTFLOW' and is_secured = true and collateral_class = 'L1'
    citation: 12 CFR 249.32(j)

  - id: OS-2
    emit: O.S.2
    label: Secured funding — level 2A collateral
    when: direction = 'OUTFLOW' and is_secured = true and collateral_class = 'L2A'
    citation: 12 CFR 249.32(j)

  - id: OS-3
    emit: O.S.3
    label: Secured funding — level 2B collateral
    when: direction = 'OUTFLOW' and is_secured = true and collateral_class = 'L2B'
    citation: 12 CFR 249.32(j)

  - id: OS-5
    emit: O.S.5
    label: Secured funding — non-HQLA collateral
    when: direction = 'OUTFLOW' and is_secured = true and collateral_class = 'NON_HQLA'
    citation: 12 CFR 249.32(j)

  - id: OW-1
    emit: O.W.1
    label: Wholesale — operational, non-financial
    when: direction = 'OUTFLOW' and is_secured = false and account_type = 'OPERATIONAL' and counterparty_type in ('NONFIN_CORP', 'SOVEREIGN')
    citation: 12 CFR 249.32(h)

  - id: OW-3
    emit: O.W.3
    label: Wholesale — financial institution
    when: direction = 'OUTFLOW' and is_secured = false and counterparty_type = 'FINANCIAL'
    citation: 12 CFR 249.32(h)(5)

  - id: OW-2
    emit: O.W.2
    label: Wholesale — non-operational, non-financial
    when: direction = 'OUTFLOW' and is_secured = false and segment in ('WHOLESALE', 'RETAIL', 'SMALL_BUSINESS')
    citation: 12 CFR 249.32(h)(2)

  - id: IS-1
    emit: I.S.1
    label: Secured lending — level 1 collateral
    when: direction = 'INFLOW' and is_secured = true and collateral_class = 'L1'
    citation: 12 CFR 249.33(f)

  - id: IS-2
    emit: I.S.2
    label: Secured lending — collateral other than level 1
    when: direction = 'INFLOW' and is_secured = true
    citation: 12 CFR 249.33(f)

  - id: IU-1
    emit: I.U.1
    label: Unsecured inflow — financial counterparty
    when: direction = 'INFLOW' and is_secured = false and counterparty_type = 'FINANCIAL'
    citation: 12 CFR 249.33(c)

  - id: IO-1
    emit: I.O.1
    label: Other inflows
    when: direction = 'INFLOW' and is_secured = false and segment in ('WHOLESALE', 'RETAIL', 'SMALL_BUSINESS')
    citation: 12 CFR 249.33(g)`;

/**
 * LCR inflow and outflow rates.
 *
 * These are the regulatory assumptions, so they live inside the governed
 * artifact rather than in an upstream table. The set is bounded, so the
 * compiler inlines it as a literal mapping — there is no join, and therefore
 * no fan-out to reason about.
 */
const LCR_OUTFLOW_RATES = `version: 1
kind: parameter_set
name: lcr_outflow_rates
display_name: LCR inflow / outflow rates
keys: [product_id]
value: outflow_rate

effective:
  from: 2025-10-01

governance:
  owner: Liquidity Regulatory Reporting
  sr_11_7_tier: 1
  citation: 12 CFR 249 Subpart D
  validation_status: validated

entries:
  - product_id: O.D.1
    outflow_rate: 0.03
    citation: 12 CFR 249.32(a)(1)

  - product_id: O.D.2
    outflow_rate: 0.03
    citation: 12 CFR 249.32(a)(1)

  - product_id: O.D.3
    outflow_rate: 0.10
    citation: 12 CFR 249.32(a)(2)

  - product_id: O.D.5
    outflow_rate: 0.03
    citation: 12 CFR 249.32(a)(3)

  - product_id: O.D.6
    outflow_rate: 0.10
    citation: 12 CFR 249.32(a)(3)

  - product_id: O.S.1
    outflow_rate: 0.00
    citation: 12 CFR 249.32(j)(1)

  - product_id: O.S.2
    outflow_rate: 0.15
    citation: 12 CFR 249.32(j)(2)

  - product_id: O.S.3
    outflow_rate: 0.25
    citation: 12 CFR 249.32(j)(3)

  - product_id: O.S.5
    outflow_rate: 1.00
    citation: 12 CFR 249.32(j)(4)

  - product_id: O.W.1
    outflow_rate: 0.25
    citation: 12 CFR 249.32(h)(1)

  - product_id: O.W.2
    outflow_rate: 0.40
    citation: 12 CFR 249.32(h)(2)

  - product_id: O.W.3
    outflow_rate: 1.00
    citation: 12 CFR 249.32(h)(5)

  - product_id: I.S.1
    outflow_rate: 0.00
    citation: 12 CFR 249.33(f)(1)

  - product_id: I.S.2
    outflow_rate: 0.50
    citation: 12 CFR 249.33(f)

  - product_id: I.U.1
    outflow_rate: 1.00
    citation: 12 CFR 249.33(c)

  - product_id: I.O.1
    outflow_rate: 0.50
    citation: 12 CFR 249.33(g)`;

/**
 * The view that composes them.
 *
 * `derivations` run per row, in order, before any measure aggregates: bucket
 * the maturity, assign the product ID, look up the rate, apply it. Measures
 * then aggregate the derived columns exactly as they aggregate source columns.
 */
const FR2052A_PREPARED = `version: 1
kind: prepared_source
name: fr2052a_prepared
source: alm.fct_2052a_positions

governance:
  owner: Liquidity Data Integration
  sr_11_7_tier: 1
  validation_status: validated
  change_ticket: ALM-4602

effective:
  from: 2024-01-01

derivations:
  - name: days_to_maturity
    op: days_between
    field: maturity_date
    anchor: as_of_date

  - name: maturity_bucket
    op: date_bucket
    field: maturity_date
    anchor: as_of_date
    ladder: fr2052a_maturity

  - name: product_id
    op: classify
    using: fr2052a_product_id

  - name: outflow_rate
    op: param_lookup
    using: lcr_outflow_rates
    keys: [product_id]`;


const FR2052A_OUTFLOWS = `version: 1
kind: metrics_view
view: fr2052a_outflows
source: alm.fct_2052a_positions
prepared: fr2052a_prepared
targets: [duckdb, snowflake, databricks, bigquery, dremio]
grain:
  type: stock
  as_of_field: as_of_date
  max_query_span: P1D

derivations:
  - name: weighted_amount
    op: expr
    expression: balance_usd * outflow_rate

measures:
  - name: gross_outflow_balance
    description: Unweighted balance of all outflow positions maturing within 30 days.
    type: simple
    agg: sum
    field: balance_usd
    where: direction = 'OUTFLOW' and days_to_maturity <= 30
    format: currency_usd
    valid_range: [0, 900000000000]

  - name: weighted_outflows_30d
    description: Outflow balances after applying the regulatory run-off rate.
    type: simple
    agg: sum
    field: weighted_amount
    where: direction = 'OUTFLOW' and days_to_maturity <= 30
    format: currency_usd
    valid_range: [0, 900000000000]
    sr_11_7_tier: 1
    citation: 12 CFR 249.32
    validation_status: validated

  - name: weighted_inflows_30d
    description: Inflow balances after applying the regulatory inflow rate.
    type: simple
    agg: sum
    field: weighted_amount
    where: direction = 'INFLOW' and days_to_maturity <= 30
    format: currency_usd
    valid_range: [0, 900000000000]

  - name: capped_inflows_30d
    description: Inflows are recognised only up to 75% of outflows.
    type: derived
    requires: [weighted_inflows_30d, weighted_outflows_30d]
    expression: >
      least(weighted_inflows_30d, 0.75 * weighted_outflows_30d)
    format: currency_usd
    valid_range: [0, 900000000000]

  - name: net_outflows_30d
    description: Total net cash outflows, floored at zero.
    type: derived
    requires: [weighted_outflows_30d, capped_inflows_30d]
    expression: >
      greatest(weighted_outflows_30d - capped_inflows_30d, 0)
    format: currency_usd
    valid_range: [0, 900000000000]
    sr_11_7_tier: 1
    citation: 12 CFR 249.30
    validation_status: validated

  - name: retail_outflows_30d
    description: Run-off from retail deposit product IDs only.
    type: simple
    agg: sum
    field: weighted_amount
    where: product_id in ('O.D.1', 'O.D.2', 'O.D.3') and days_to_maturity <= 30
    format: currency_usd
    valid_range: [0, 900000000000]`;

/**
 * The filed artifact.
 *
 * A report is a declared grouping over a view's measures plus where the result
 * lands. It is what the nightly pipeline pins and materialises — the grain of
 * the submission, not a number on a screen.
 */
const FR2052A_SUBMISSION = `version: 1
kind: report
name: fr2052a_submission
display_name: FR 2052a — daily submission
view: fr2052a_outflows
grouping: [product_id, maturity_bucket, currency, entity_id]
measures: [gross_outflow_balance, weighted_outflows_30d]

materialize:
  target: iceberg
  table: reg.fr2052a_daily
  partition_by: [as_of_date]
  mode: overwrite_partitions

governance:
  owner: Liquidity Regulatory Reporting
  sr_11_7_tier: 1
  citation: FR 2052a Instructions
  validation_status: validated`;


/**
 * The morning question.
 *
 * A report says what is being filed. It cannot say whether a number moved more
 * than it should have overnight, because that is a statement about a change and
 * a report is a statement about a day. This watches the rollups the rules
 * produce and judges each day-over-day move against thresholds that are either
 * fixed by policy or derived from how much that particular series normally
 * moves.
 *
 * The grain is deliberately coarser than the submission's. Watching every
 * product ID by bucket by currency by entity yields hundreds of series, most of
 * them too thin for a standard deviation to mean anything; watching product ID
 * by entity gives series with enough history to have a dispersion worth
 * comparing against.
 */
const FR2052A_VARIANCE = `version: 1
kind: variance_monitor
name: fr2052a_variance
display_name: FR 2052a — day-over-day outflow variance
report: fr2052a_submission
measure: weighted_outflows_30d

watch:
  grain: [product_id, entity_id]

effective:
  from: 2025-10-01

governance:
  owner: Liquidity Regulatory Reporting
  sr_11_7_tier: 2
  citation: SR 11-7
  validation_status: validated

thresholds:
  - id: HARD-USD
    basis: static_abs
    limit: 1000000
    severity: error
    citation: Internal liquidity risk policy 4.2
    description: Any overnight move above $1mm in a product bucket is escalated.

  - id: RETAIL-PCT
    basis: static_pct
    limit: 12.0
    severity: warn
    applies_to: product_id in ('O.D.1', 'O.D.2', 'O.D.3')
    citation: Internal liquidity risk policy 4.3
    description: Retail run-off is sticky, so a double-digit daily move is unusual.

  - id: SIGMA-30
    basis: stddev_30d
    sigma: 3.0
    severity: warn
    citation: SR 11-7 outcomes analysis
    description: Three sigma against the trailing 30 daily moves for this rollup.

  - id: SIGMA-60
    basis: stddev_60d
    sigma: 2.5
    severity: info
    citation: SR 11-7 outcomes analysis
    description: A wider window catches a drift the 30-day window has absorbed.`;

/**
 * A client system's table, mapped to the canonical source.
 *
 * The rules are written once against canonical names. This says what those
 * names are called in one particular book — and, where the vocabularies differ
 * too, which client code means which canonical value. The registry generates an
 * adapter view from this, and the canonical plan runs on top of it unchanged.
 *
 * It is a governed artifact for the same reason a rate table is: a wrong
 * mapping changes what a number means exactly as much as a wrong rule does.
 */
const MUREX_EU_BINDING = `version: 1
kind: source_binding
name: murex_eu
display_name: Murex — EU book
binds: alm.fct_2052a_positions
table: murex.v_liq_positions

governance:
  owner: Liquidity Data Integration
  sr_11_7_tier: 2
  validation_status: validated

columns:
  - canonical: as_of_date
    column: COB_DATE

  - canonical: balance_usd
    column: BAL_AMT_USD
    note: already USD in this feed — no conversion in the adapter

  - canonical: maturity_date
    column: MAT_DATE

  - canonical: segment
    column: CUST_SEG
    map: {RTL: RETAIL, SBB: SMALL_BUSINESS, WSL: WHOLESALE}

  - canonical: direction
    column: FLOW_DIR
    map: {I: INFLOW, O: OUTFLOW}

  - canonical: insured_flag
    column: FDIC_INS

  - canonical: is_secured
    column: SECURED_FLG

  - canonical: counterparty_type
    column: CPTY_TYPE

  - canonical: account_type
    column: ACCT_TYPE

  - canonical: collateral_class
    column: COLL_CLASS

  - canonical: currency
    column: CCY

  - canonical: entity_id
    column: LEGAL_ENT`;


export const INITIAL_DOCS: Record<ViewFile, string> = {
  liquidity_pit: LIQUIDITY_PIT,
  irrbb_eve: IRRBB_EVE,
  fr2052a_product_id: FR2052A_PRODUCT_ID,
  lcr_outflow_rates: LCR_OUTFLOW_RATES,
  fr2052a_prepared: FR2052A_PREPARED,
  fr2052a_outflows: FR2052A_OUTFLOWS,
  fr2052a_submission: FR2052A_SUBMISSION,
  fr2052a_variance: FR2052A_VARIANCE,
  murex_eu_binding: MUREX_EU_BINDING,
};

/** What each document opens on — a measure, or the artifact itself. */
export const DEFAULT_MEASURE: Record<ViewFile, string> = {
  liquidity_pit: 'lcr_pct',
  irrbb_eve: 'eve_delta_up200',
  fr2052a_product_id: 'OD-1',
  lcr_outflow_rates: 'O.D.1',
  fr2052a_prepared: 'product_id',
  fr2052a_outflows: 'net_outflows_30d',
  fr2052a_submission: 'fr2052a_submission',
  fr2052a_variance: 'HARD-USD',
  murex_eu_binding: 'balance_usd',
};
