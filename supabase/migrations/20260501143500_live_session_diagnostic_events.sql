create table if not exists public.live_session_diagnostic_events (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  session_id text not null,
  event_type text not null,
  route_path text,
  title text,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists live_session_diagnostic_events_org_created_idx
  on public.live_session_diagnostic_events (org_id, created_at desc);

create index if not exists live_session_diagnostic_events_user_created_idx
  on public.live_session_diagnostic_events (user_id, created_at desc);

create index if not exists live_session_diagnostic_events_session_created_idx
  on public.live_session_diagnostic_events (session_id, created_at desc);

alter table public.live_session_diagnostic_events enable row level security;

create policy "Users can read own live session diagnostics"
  on public.live_session_diagnostic_events
  for select
  using (auth.uid() = user_id);

create policy "Admins can read org live session diagnostics"
  on public.live_session_diagnostic_events
  for select
  using (
    exists (
      select 1
      from public.user_profiles up
      where up.id = auth.uid()
        and up.organization_id = live_session_diagnostic_events.org_id
        and up.role in ('admin', 'admin_officer', 'master', 'grand_master')
    )
  );