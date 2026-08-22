-- The conformed grain: one row per source position per day. A duplicate here
-- double-counts a balance in every downstream number, so it fails the build.
select source_system, position_id, as_of_date, count(*) as n
from {{ ref('fct_2052a_positions') }}
group by 1, 2, 3
having count(*) > 1
