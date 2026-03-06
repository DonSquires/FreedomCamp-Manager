\pset pager off
\pset tuples_only on
\pset format unaligned

SELECT pg_get_functiondef(p.oid) || E'\n'
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname NOT IN ('pg_catalog', 'information_schema')
  AND n.nspname NOT LIKE 'pg_toast%'
  AND n.nspname NOT LIKE 'pg_temp%'
ORDER BY n.nspname, p.proname, p.oid;
