-- Expose live catalog audit via RPC so backend can use service-role wiring
-- without requiring direct DATABASE_URL/PG* runtime secrets.

create or replace function public.execute_live_schema_audit()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  has_pg_stat_statements boolean := false;
  index_coverage_candidates jsonb := '[]'::jsonb;
  sort_hotspots jsonb := '[]'::jsonb;
  optimization_candidates jsonb := '[]'::jsonb;
begin
  select to_regclass('extensions.pg_stat_statements') is not null
  into has_pg_stat_statements;

  with index_counts as (
    select schemaname, tablename, count(*)::bigint as index_count
    from pg_indexes
    where schemaname not in ('pg_catalog', 'information_schema')
    group by schemaname, tablename
  ),
  coverage as (
    select
      st.schemaname as schema_name,
      st.relname as table_name,
      coalesce(st.n_live_tup, 0)::bigint as estimated_rows,
      coalesce(st.seq_scan, 0)::bigint as seq_scan,
      coalesce(st.idx_scan, 0)::bigint as idx_scan,
      coalesce(ic.index_count, 0)::bigint as index_count,
      (coalesce(ic.index_count, 0) = 0) as lacks_indexes,
      (
        (case when coalesce(ic.index_count, 0) = 0 then 70 else 35 end)
        + (case when coalesce(st.n_live_tup, 0) > 10000 then 20 else 0 end)
        + least(10, floor(coalesce(st.seq_scan, 0)::numeric / 1000))
      )::int as priority_score
    from pg_stat_user_tables st
    left join index_counts ic
      on ic.schemaname = st.schemaname
     and ic.tablename = st.relname
    where st.schemaname not in ('pg_catalog', 'information_schema')
  )
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'category', 'index_coverage',
        'schema', schema_name,
        'table', table_name,
        'detail', case
          when lacks_indexes then 'No indexes detected on this table in pg_indexes.'
          else format('Sequential scans (%s) significantly exceed index scans (%s).', seq_scan, idx_scan)
        end,
        'riskLevel', case when estimated_rows > 10000 then 'high' else 'medium' end,
        'rewardLevel', case when estimated_rows > 10000 then 'high' else 'medium' end,
        'priorityScore', priority_score
      )
      order by priority_score desc
    ),
    '[]'::jsonb
  )
  into index_coverage_candidates
  from (
    select *
    from coverage
    where lacks_indexes = true or seq_scan > idx_scan * 3
    order by priority_score desc
    limit 80
  ) ranked_coverage;

  if has_pg_stat_statements then
    select coalesce(
      jsonb_agg(
        jsonb_build_object(
          'category', 'sort_hotspot',
          'schema', 'public',
          'table', 'query_workload',
          'detail', left(regexp_replace(query, '\s+', ' ', 'g'), 220),
          'riskLevel', case
            when ((coalesce(shared_blks_read, 0) + coalesce(temp_blks_written, 0) * 3) / 100.0 + coalesce(calls, 0) / 100.0) >= 60 then 'high'
            when ((coalesce(shared_blks_read, 0) + coalesce(temp_blks_written, 0) * 3) / 100.0 + coalesce(calls, 0) / 100.0) >= 35 then 'medium'
            else 'low'
          end,
          'rewardLevel', case
            when ((coalesce(shared_blks_read, 0) + coalesce(temp_blks_written, 0) * 3) / 100.0 + coalesce(calls, 0) / 100.0) >= 50 then 'high'
            else 'medium'
          end,
          'priorityScore', greatest(
            20,
            least(100, floor((coalesce(shared_blks_read, 0) + coalesce(temp_blks_written, 0) * 3) / 100.0 + coalesce(calls, 0) / 100.0))
          )
        )
        order by coalesce(temp_blks_written, 0) desc, coalesce(shared_blks_read, 0) desc, coalesce(total_exec_time, 0) desc
      ),
      '[]'::jsonb
    )
    into sort_hotspots
    from (
      select *
      from extensions.pg_stat_statements
      where lower(query) like '% order by %'
      order by coalesce(temp_blks_written, 0) desc, coalesce(shared_blks_read, 0) desc, coalesce(total_exec_time, 0) desc
      limit 100
    ) ranked_statements;
  end if;

  optimization_candidates := (
    select coalesce(jsonb_agg(candidate), '[]'::jsonb)
    from (
      select candidate
      from jsonb_array_elements(index_coverage_candidates) as candidate
      union all
      select candidate
      from jsonb_array_elements(sort_hotspots) as candidate
    ) combined
  );

  return jsonb_build_object(
    'generatedAt', now(),
    'source', 'rpc_catalog',
    'metadata', jsonb_build_object(
      'pgStatStatementsAvailable', has_pg_stat_statements
    ),
    'indexCoverageCandidates', index_coverage_candidates,
    'sortHotspots', sort_hotspots,
    'riskRewardMatrix', (
      select coalesce(
        jsonb_agg(
          jsonb_build_object(
            'candidate', format('%s.%s', c->>'schema', c->>'table'),
            'reward', case
              when c->>'category' = 'sort_hotspot'
                then 'Reduces expensive ORDER BY runtime, temp spill, and dashboard latency.'
              else 'Improves lookup/select performance and reduces sequential scan pressure.'
            end,
            'risk', 'Additional index storage and write-path overhead during INSERT/UPDATE/DELETE operations.',
            'recommendation', case
              when coalesce((c->>'priorityScore')::int, 0) >= 75 then 'High priority'
              when coalesce((c->>'priorityScore')::int, 0) >= 50 then 'Medium priority'
              else 'Low priority'
            end,
            'priorityScore', coalesce((c->>'priorityScore')::int, 0)
          )
          order by coalesce((c->>'priorityScore')::int, 0) desc
        ),
        '[]'::jsonb
      )
      from (
        select c
        from jsonb_array_elements(optimization_candidates) as c
        limit 40
      ) ranked
    ),
    'optimizationCandidates', optimization_candidates
  );
end;
$$;

revoke all on function public.execute_live_schema_audit() from public;
grant execute on function public.execute_live_schema_audit() to authenticated;
grant execute on function public.execute_live_schema_audit() to service_role;
