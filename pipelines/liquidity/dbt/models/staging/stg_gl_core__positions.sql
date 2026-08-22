-- GL Core is already canonically shaped, so conformance here is typing:
-- the raw layer is strings by design, and this view gives each column the
-- type the conformed model promises.
select
    position_id,
    cast(as_of_date as date)                          as as_of_date,
    entity_id,
    currency,
    segment,
    counterparty_type,
    account_type,
    {{ parse_bool('insured_flag') }}                  as insured_flag,
    {{ parse_bool('is_secured') }}                    as is_secured,
    collateral_class,
    direction,
    cast(nullif(maturity_date, '') as date)           as maturity_date,
    cast(balance_usd as double)                       as balance_usd
from {{ source('raw', 'gl_core_positions_daily') }}
{% if var('as_of_date') %}
where cast(as_of_date as date) = cast('{{ var("as_of_date") }}' as date)
{% endif %}
