{#
  The few places DuckDB and Spark SQL genuinely disagree, isolated here so
  model bodies stay engine-free.
#}

{# 'YYYYMMDD' string → DATE; '00000000' (Murex's "open position") → NULL #}
{% macro parse_compact_date(column) -%}
    {%- if target.type == 'spark' -%}
        to_date(nullif({{ column }}, '00000000'), 'yyyyMMdd')
    {%- else -%}
        CAST(strptime(nullif({{ column }}, '00000000'), '%Y%m%d') AS DATE)
    {%- endif -%}
{%- endmacro %}

{# landed string → BOOLEAN, accepting true/false and Y/N spellings #}
{% macro parse_bool(column) -%}
    CASE
        WHEN lower({{ column }}) IN ('true', 'y', 't', '1') THEN true
        WHEN lower({{ column }}) IN ('false', 'n', 'f', '0') THEN false
    END
{%- endmacro %}
