-- =============================================================================
-- Schema extraction queries for FreedomCamp-Manager / Supabase (PostgreSQL)
-- Run via:  psql -f queries.sql  (or via run_extract.sh which splits output)
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. TABLES: column definitions
-- ---------------------------------------------------------------------------
\echo '-- tables --'
SELECT
    t.table_schema,
    t.table_name,
    c.column_name,
    c.ordinal_position,
    c.column_default,
    c.is_nullable,
    c.data_type,
    c.character_maximum_length,
    c.numeric_precision,
    c.numeric_scale
FROM information_schema.tables  t
JOIN information_schema.columns c
     ON c.table_schema = t.table_schema
    AND c.table_name   = t.table_name
WHERE t.table_schema NOT IN ('pg_catalog', 'information_schema')
  AND t.table_type = 'BASE TABLE'
ORDER BY t.table_schema, t.table_name, c.ordinal_position;

-- ---------------------------------------------------------------------------
-- 2. VIEWS: view definitions
-- ---------------------------------------------------------------------------
\echo '-- views --'
SELECT
    schemaname  AS view_schema,
    viewname    AS view_name,
    definition  AS view_definition
FROM pg_views
WHERE schemaname NOT IN ('pg_catalog', 'information_schema')
ORDER BY schemaname, viewname;

-- ---------------------------------------------------------------------------
-- 3. FUNCTIONS: full DDL via pg_get_functiondef
-- ---------------------------------------------------------------------------
\echo '-- functions --'
SELECT
    n.nspname                          AS function_schema,
    p.proname                          AS function_name,
    pg_get_functiondef(p.oid)          AS function_ddl,
    pg_get_function_arguments(p.oid)   AS arguments,
    pg_get_function_result(p.oid)      AS return_type,
    l.lanname                          AS language
FROM pg_proc       p
JOIN pg_namespace  n ON n.oid = p.pronamespace
JOIN pg_language   l ON l.oid = p.prolang
WHERE n.nspname NOT IN ('pg_catalog', 'information_schema')
  AND p.prokind IN ('f', 'p')   -- functions and procedures
ORDER BY n.nspname, p.proname;

-- ---------------------------------------------------------------------------
-- 4. TRIGGERS: full DDL via pg_get_triggerdef
-- ---------------------------------------------------------------------------
\echo '-- triggers --'
SELECT
    trigger_schema,
    trigger_name,
    event_object_schema  AS table_schema,
    event_object_table   AS table_name,
    event_manipulation   AS event,
    action_timing        AS timing,
    action_statement     AS action,
    pg_get_triggerdef(t.oid) AS trigger_ddl
FROM information_schema.triggers      i
JOIN pg_trigger                        t  ON t.tgname = i.trigger_name
JOIN pg_class                          c  ON c.oid = t.tgrelid
JOIN pg_namespace                      n  ON n.oid = c.relnamespace
                                         AND n.nspname = i.event_object_schema
WHERE trigger_schema NOT IN ('pg_catalog', 'information_schema')
ORDER BY trigger_schema, event_object_table, trigger_name;

-- ---------------------------------------------------------------------------
-- 5. ROW-LEVEL SECURITY POLICIES
-- ---------------------------------------------------------------------------
\echo '-- policies --'
SELECT
    schemaname   AS policy_schema,
    tablename    AS table_name,
    policyname   AS policy_name,
    permissive,
    roles,
    cmd          AS command,
    qual         AS using_expression,
    with_check   AS with_check_expression
FROM pg_policies
WHERE schemaname NOT IN ('pg_catalog', 'information_schema')
ORDER BY schemaname, tablename, policyname;

-- ---------------------------------------------------------------------------
-- 6. INDEXES
-- ---------------------------------------------------------------------------
\echo '-- indexes --'
SELECT
    schemaname   AS index_schema,
    tablename    AS table_name,
    indexname    AS index_name,
    indexdef     AS index_definition
FROM pg_indexes
WHERE schemaname NOT IN ('pg_catalog', 'information_schema')
ORDER BY schemaname, tablename, indexname;
