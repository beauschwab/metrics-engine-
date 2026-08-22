{#
  Custom schemas mean what they say.

  dbt's default prefixes the target schema (main_alm), but the canonical table
  the governed rules compile against is literally `alm.fct_2052a_positions` —
  the registry's plans read that name, so the warehouse must present it.
#}
{% macro generate_schema_name(custom_schema_name, node) -%}
    {%- if custom_schema_name is none -%}
        {{ target.schema }}
    {%- else -%}
        {{ custom_schema_name | trim }}
    {%- endif -%}
{%- endmacro %}
