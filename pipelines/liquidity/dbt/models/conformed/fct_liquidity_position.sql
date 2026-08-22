-- The HQLA side of the house, conformed. The governed `hqla_total` measure
-- (12 CFR 249.20-22) reads hqla_eligible_amount filtered on is_encumbered.
select
    security_id,
    entity_id,
    as_of_date,
    hqla_level,
    hqla_eligible_amount,
    is_encumbered,
    currency
from {{ ref('stg_treasury__hqla') }}
{% if is_incremental() and var('as_of_date') %}
where as_of_date = cast('{{ var("as_of_date") }}' as date)
{% endif %}
