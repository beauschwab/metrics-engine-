-- The canonical position table — the one name every governed rule compiles
-- against. Sourcing systems arrive here with identical shape and vocabulary;
-- nothing downstream knows or cares which system a row came from beyond the
-- lineage column.
--
-- No product IDs, no rates, no buckets: classification is the registry's.
-- This table ends where governed derivation begins.
--
-- Note on per-feed runs: the union reads every staging view even when the
-- source_system var restricts the batch to one feed, so a sibling feed's raw
-- table must exist (any batch). Every chain lands before it conforms, so
-- only a cold-start warehouse that has never landed a sibling feed notices.
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
where 1 = 1
{% if is_incremental() and var('as_of_date') %}
  and as_of_date = cast('{{ var("as_of_date") }}' as date)
{% endif %}
{% if var('source_system') %}
  -- One feed's sub-partition: the batch carries only this system's rows, so
  -- the composite-key replacement above touches only this system's slice.
  and source_system = '{{ var("source_system") }}'
{% endif %}
