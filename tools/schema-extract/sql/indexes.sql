\pset pager off
\pset tuples_only on
\pset format unaligned

SELECT pg_get_indexdef(i.indexrelid) || ';'
FROM pg_index i
JOIN pg_class idx ON idx.oid = i.indexrelid
JOIN pg_class tbl ON tbl.oid = i.indrelid
JOIN pg_namespace n ON n.oid = tbl.relnamespace
WHERE n.nspname NOT IN ('pg_catalog', 'information_schema')
  AND n.nspname NOT LIKE 'pg_toast%'
  AND n.nspname NOT LIKE 'pg_temp%'
ORDER BY n.nspname, tbl.relname, idx.relname;
