-- The HQLA side of the house, conformed. The governed `hqla_total` measure
-- (12 CFR 249.20-22) reads hqla_eligible_amount filtered on is_encumbered.
--
-- One producing system today, but the same (as_of_date, source_system)
-- sub-partition contract as the positions table: a second HQLA source lands
-- as a sibling sub-partition, not a schema change.
select
    'treasury' as source_system,
    security_id,
    entity_id,
    as_of_date,
    hqla_level,
    hqla_eligible_amount,
    is_encumbered,
    currency
from {{ ref('stg_treasury__hqla') }}
where 1 = 1
{% if is_incremental() and var('as_of_date') %}
  and as_of_date = cast('{{ var("as_of_date") }}' as date)
{% endif %}
