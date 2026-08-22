-- The canonical position table — the one name every governed rule compiles
-- against. Sourcing systems arrive here with identical shape and vocabulary;
-- nothing downstream knows or cares which system a row came from beyond the
-- lineage column.
--
-- No product IDs, no rates, no buckets: classification is the registry's.
-- This table ends where governed derivation begins.
with unioned as (
    select 'gl_core' as source_system, * from {{ ref('stg_gl_core__positions') }}
    union all
    select 'murex_eu' as source_system, * from {{ ref('stg_murex_eu__positions') }}
)

select
    source_system,
    position_id,
    as_of_date,
    entity_id,
    currency,
    segment,
    counterparty_type,
    account_type,
    insured_flag,
    is_secured,
    collateral_class,
    direction,
    maturity_date,
    balance_usd
from unioned
{% if is_incremental() and var('as_of_date') %}
where as_of_date = cast('{{ var("as_of_date") }}' as date)
{% endif %}
