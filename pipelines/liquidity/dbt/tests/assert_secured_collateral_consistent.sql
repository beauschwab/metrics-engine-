-- The invariant the secured-funding rules (O.S.*) lean on: secured positions
-- state their collateral class, unsecured ones state UNSECURED. The contracts
-- assert this per feed; this restates it over the union, where a future
-- source system would first get it wrong.
select *
from {{ ref('fct_2052a_positions') }}
where (is_secured and collateral_class = 'UNSECURED')
   or (not is_secured and collateral_class <> 'UNSECURED')
