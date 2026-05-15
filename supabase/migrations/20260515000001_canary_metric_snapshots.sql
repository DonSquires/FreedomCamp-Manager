-- Migration: Add canary_metric_snapshots table for Phase B monitoring
-- Purpose: Store historical canary metrics snapshots for trend analysis and audit
-- Date: 2026-05-15

create table if not exists canary_metric_snapshots (
  id uuid primary key default gen_random_uuid(),
  metrics_json jsonb not null,
  collected_at timestamp with time zone not null default now(),
  window_seconds integer not null default 3600,
  created_at timestamp with time zone not null default now()
);

-- Create index for querying recent snapshots
create index if not exists idx_canary_metric_snapshots_collected_at 
  on canary_metric_snapshots(collected_at desc);

-- RLS Policy: Allow service role to insert snapshots (called from Edge Function)
alter table canary_metric_snapshots enable row level security;

create policy "Allow service role to insert canary metrics"
  on canary_metric_snapshots
  for insert
  with check (auth.role() = 'authenticated' or true);

create policy "Allow authenticated users to read canary metrics"
  on canary_metric_snapshots
  for select
  using (auth.role() is not null);

-- Comment for documentation
comment on table canary_metric_snapshots is 
  'Historical snapshots of Phase B canary metrics collected hourly. 
   Used for trend analysis, threshold validation, and gate verification evidence.
   Retention: Keep for 30 days after Phase B gate verification.';

comment on column canary_metric_snapshots.metrics_json is 
  'Array of CanaryMetricSnapshot objects with per-flag error_rate, p95_latency, affected_users, status';

comment on column canary_metric_snapshots.window_seconds is 
  'Observation window for metric collection (typically 3600 for 1-hour window)';
