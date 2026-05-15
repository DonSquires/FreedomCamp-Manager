-- Migration: 20260713000004_bob_test_telemetry
-- Purpose: Creates the bob_test_run_telemetry table used by CI test harnesses
-- to persist service-test results for trend analysis and release gate auditing.

create table if not exists public.bob_test_run_telemetry (
  id              uuid primary key default gen_random_uuid(),
  run_id          text        not null,
  suite           text        not null,   -- 'web' | 'mobile' | 'voice' | 'chaos'
  tier            smallint    not null,   -- 1 | 2 | 3
  passed          boolean     not null,
  duration_ms     integer,
  error_summary   text,
  metadata        jsonb       default '{}',
  created_at      timestamptz default now()
);

comment on table public.bob_test_run_telemetry is
  'Bob CI test run results; written by scripts/run-test-with-bob-assist.mjs and the ops-bob-self-test workflow.';

-- Indexes for the most common query patterns
create index if not exists bob_test_run_telemetry_run_id_idx  on public.bob_test_run_telemetry (run_id);
create index if not exists bob_test_run_telemetry_suite_idx   on public.bob_test_run_telemetry (suite);
create index if not exists bob_test_run_telemetry_created_idx on public.bob_test_run_telemetry (created_at desc);

-- RLS: readable by admin/master only; written only by service-role (CI)
alter table public.bob_test_run_telemetry enable row level security;

create policy "bob_test_telemetry_read_admin_master"
  on public.bob_test_run_telemetry
  for select
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and p.role in ('admin', 'master')
    )
  );
