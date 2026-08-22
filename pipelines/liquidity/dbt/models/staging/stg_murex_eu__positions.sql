-- Murex EU, decoded to the canonical vocabulary.
--
-- The decode tables here mirror the governed `murex_eu` source binding in the
-- rules registry (RTL→RETAIL, I→INFLOW, …). The registry document is the
-- authority on what the codes mean; this model is where that meaning is
-- applied on the way into the conformed layer. If the two drift, the
-- accepted_values tests on the conformed model are what catches it.
select
    trade_id                                          as position_id,
    {{ parse_compact_date('cob_date') }}              as as_of_date,
    legal_ent                                         as entity_id,
    ccy                                               as currency,
    case cust_seg
        when 'RTL' then 'RETAIL'
        when 'SBB' then 'SMALL_BUSINESS'
        when 'WSL' then 'WHOLESALE'
    end                                               as segment,
    cpty_type                                         as counterparty_type,
    acct_type                                         as account_type,
    {{ parse_bool('fdic_ins') }}                      as insured_flag,
    {{ parse_bool('secured_flg') }}                   as is_secured,
    coll_class                                        as collateral_class,
    case flow_dir
        when 'I' then 'INFLOW'
        when 'O' then 'OUTFLOW'
    end                                               as direction,
    {{ parse_compact_date('mat_date') }}              as maturity_date,
    cast(bal_amt_usd as double)                       as balance_usd
from {{ source('raw', 'murex_eu_positions_daily') }}
{% if var('as_of_date') %}
where {{ parse_compact_date('cob_date') }} = cast('{{ var("as_of_date") }}' as date)
{% endif %}
