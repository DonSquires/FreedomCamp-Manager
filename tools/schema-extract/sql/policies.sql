\pset pager off
\pset tuples_only on
\pset format unaligned

SELECT
  'CREATE POLICY ' || quote_ident(pol.polname) ||
  ' ON ' || quote_ident(n.nspname) || '.' || quote_ident(c.relname) ||
  CASE pol.polcmd
    WHEN 'r' THEN ' FOR SELECT'
    WHEN 'a' THEN ' FOR INSERT'
    WHEN 'w' THEN ' FOR UPDATE'
    WHEN 'd' THEN ' FOR DELETE'
    ELSE ''
  END ||
  CASE
    WHEN pol.polroles IS NULL OR array_length(pol.polroles, 1) IS NULL THEN ''
    ELSE ' TO ' || array_to_string(
      ARRAY(
        SELECT quote_ident(r.rolname)
        FROM pg_roles r
        WHERE r.oid = ANY (pol.polroles)
        ORDER BY r.rolname
      ), ', '
    )
  END ||
  CASE
    WHEN pol.polqual IS NULL THEN ''
    ELSE ' USING (' || pg_get_expr(pol.polqual, pol.polrelid) || ')'
  END ||
  CASE
    WHEN pol.polwithcheck IS NULL THEN ''
    ELSE ' WITH CHECK (' || pg_get_expr(pol.polwithcheck, pol.polrelid) || ')'
  END ||
  ';'
FROM pg_policy pol
JOIN pg_class c ON c.oid = pol.polrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname NOT IN ('pg_catalog', 'information_schema')
  AND n.nspname NOT LIKE 'pg_toast%'
  AND n.nspname NOT LIKE 'pg_temp%'
ORDER BY n.nspname, c.relname, pol.polname;
