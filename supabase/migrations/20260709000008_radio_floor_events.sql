-- Migration: radio_floor_events
-- Phase 0-1 Group B — Floor Control audit trail
-- Stores floor acquire/release/override events with org-scoped RLS.

create table if not exists public.radio_floor_events (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  channel_id text not null,
  session_id text not null,
  event_type text not null check (event_type in ('acquire', 'release', 'override')),
  status text not null check (status in ('requested', 'granted', 'rejected', 'released')),
  speaker_id uuid references public.user_profiles(id) on delete set null,
  operator_id uuid references public.user_profiles(id) on delete set null,
  reason text,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists radio_floor_events_org_id_idx
  on public.radio_floor_events (org_id);
create index if not exists radio_floor_events_channel_id_idx
  on public.radio_floor_events (channel_id);
create index if not exists radio_floor_events_session_id_idx
  on public.radio_floor_events (session_id);
create index if not exists radio_floor_events_event_type_idx
  on public.radio_floor_events (event_type);
create index if not exists radio_floor_events_created_at_idx
  on public.radio_floor_events (created_at desc);

comment on table public.radio_floor_events is
  'PTT floor-control events (acquire/release/override) for Phase 0-1 audit and replay.';

alter table public.radio_floor_events enable row level security;

drop policy if exists radio_floor_events_select_own_org on public.radio_floor_events;
drop policy if exists radio_floor_events_insert_own_org on public.radio_floor_events;
drop policy if exists radio_floor_events_update_admin on public.radio_floor_events;

create policy radio_floor_events_select_own_org
  on public.radio_floor_events for select
  using (
    exists (
      select 1
      from public.user_profiles up
      where up.id = auth.uid()
        and up.organization_id = radio_floor_events.org_id
    )
  );

create policy radio_floor_events_insert_own_org
  on public.radio_floor_events for insert
  with check (
    exists (
      select 1
      from public.user_profiles up
      where up.id = auth.uid()
        and up.organization_id = radio_floor_events.org_id
    )
  );

create policy radio_floor_events_update_admin
  on public.radio_floor_events for update
  using (
    exists (
      select 1
      from public.user_profiles up
      where up.id = auth.uid()
        and up.organization_id = radio_floor_events.org_id
        and up.role in ('admin', 'admin_officer', 'master', 'grand_master')
    )
  );
