-- PTT Diagnostic Events Table
-- Stores RTCPeerConnection.getStats() telemetry polled every 5s from browser clients.
-- Used to identify ICE/TURN failures, packet loss spikes, and latency regressions.
-- 7-day rolling retention enforced via pg_cron delete job.

create table if not exists public.ptt_diagnostic_events (
  id            uuid        not null default gen_random_uuid() primary key,
  org_id        uuid        not null references public.organizations(id) on delete cascade,
  user_id       uuid        not null references auth.users(id) on delete cascade,
  channel_id    text        not null,
  -- WebRTC stats
  rtt_ms        numeric(8,2),          -- round-trip time in milliseconds (null = unknown)
  packet_loss   numeric(5,2),          -- packet loss percentage 0–100
  jitter_ms     numeric(8,2),          -- jitter in milliseconds
  ice_type      text,                  -- 'host' | 'srflx' | 'relay' | null
  packets_sent  bigint,
  packets_recv  bigint,
  -- Context
  created_at    timestamptz not null default now()
);

-- Index for time-series queries per org
create index if not exists ptt_diagnostic_events_org_created
  on public.ptt_diagnostic_events (org_id, created_at desc);

-- Index for per-user queries
create index if not exists ptt_diagnostic_events_user_created
  on public.ptt_diagnostic_events (user_id, created_at desc);

-- Row Level Security
alter table public.ptt_diagnostic_events enable row level security;

-- Admins and master role can read their org's telemetry
do $$
declare
  v_profile_table text;
begin
  if to_regclass('public.profiles') is not null then
    v_profile_table := 'public.profiles';
  elsif to_regclass('public.user_profiles') is not null then
    v_profile_table := 'public.user_profiles';
  else
    v_profile_table := null;
  end if;

  execute 'drop policy if exists "ptt_diagnostic_events_select" on public.ptt_diagnostic_events';

  if v_profile_table is null then
    execute $sql$
      create policy "ptt_diagnostic_events_select" on public.ptt_diagnostic_events
        for select
        using (auth.uid() = user_id)
    $sql$;
  else
    execute format($fmt$
      create policy "ptt_diagnostic_events_select" on public.ptt_diagnostic_events
        for select
        using (
          auth.uid() = user_id
          or exists (
            select 1 from %s p
            where p.id = auth.uid()
              and (p.role in ('admin', 'master', 'grand_master') or p.organization_id = org_id)
          )
        )
    $fmt$, v_profile_table);
  end if;
end $$;

-- Any authenticated user can insert their own telemetry
create policy "ptt_diagnostic_events_insert" on public.ptt_diagnostic_events
  for insert
  with check (auth.uid() = user_id);

-- -----------------------------------------------------------------------
-- 7-day TTL: pg_cron job (runs nightly at 02:00 UTC)
-- Requires pg_cron extension enabled in Supabase dashboard.
-- If pg_cron is not available, data can be pruned via a scheduled Edge Function.
-- -----------------------------------------------------------------------
do $$
begin
  if exists (
    select 1 from pg_extension where extname = 'pg_cron'
  ) then
    perform cron.schedule(
      'ptt_diagnostic_events_prune',
      '0 2 * * *',
      $cron$delete from public.ptt_diagnostic_events where created_at < now() - interval '7 days'$cron$
    );
  end if;
end $$;
