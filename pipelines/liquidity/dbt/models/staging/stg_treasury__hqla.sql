-- Treasury HQLA inventory, typed.
select
    security_id,
    entity_id,
    cast(as_of_date as date)                          as as_of_date,
    hqla_level,
    cast(hqla_eligible_amount as double)              as hqla_eligible_amount,
    {{ parse_bool('is_encumbered') }}                 as is_encumbered,
    currency
from {{ source('raw', 'treasury_hqla_daily') }}
{% if var('as_of_date') %}
where cast(as_of_date as date) = cast('{{ var("as_of_date") }}' as date)
{% endif %}
