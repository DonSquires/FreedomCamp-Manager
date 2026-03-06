\pset pager off
\pset tuples_only on
\pset format unaligned

SELECT
  'CREATE OR REPLACE VIEW ' || quote_ident(n.nspname) || '.' || quote_ident(c.relname) ||
  ' AS ' || pg_get_viewdef(c.oid, true) || ';'
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE c.relkind = 'v'
  AND n.nspname NOT IN ('pg_catalog', 'information_schema')
  AND n.nspname NOT LIKE 'pg_toast%'
  AND n.nspname NOT LIKE 'pg_temp%'
ORDER BY n.nspname, c.relname;
