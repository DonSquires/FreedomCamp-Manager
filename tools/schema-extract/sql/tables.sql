\pset pager off
\pset tuples_only on
\pset format unaligned

SELECT 'schema|table|column|data_type|nullable|default';

SELECT
  c.table_schema || '|' ||
  c.table_name || '|' ||
  c.column_name || '|' ||
  c.data_type || '|' ||
  c.is_nullable || '|' ||
  COALESCE(REPLACE(c.column_default, E'\n', ' '), '')
FROM information_schema.columns c
JOIN information_schema.tables t
  ON c.table_schema = t.table_schema
 AND c.table_name = t.table_name
WHERE t.table_type = 'BASE TABLE'
  AND c.table_schema NOT IN ('pg_catalog', 'information_schema')
  AND c.table_schema NOT LIKE 'pg_toast%'
  AND c.table_schema NOT LIKE 'pg_temp%'
ORDER BY c.table_schema, c.table_name, c.ordinal_position;
