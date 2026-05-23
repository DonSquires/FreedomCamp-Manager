-- Migration: radio_transmissions
-- Phase 1 Group A — Radio Core schema
-- One row per push-to-talk transmission session.
-- All rows are org-scoped; RLS enforces tenant isolation.

create table if not exists radio_transmissions (
  id               uuid primary key default gen_random_uuid(),
  org_id           uuid not null references organizations(id) on delete cascade,
  channel_id       text not null,
  channel_type     text not null check (channel_type in ('org', 'incident', 'direct', 'emergency')),
  speaker_id       uuid not null references public.user_profiles(id) on delete restrict,
  speaker_name     text not null,
  started_at       timestamptz not null default now(),
  ended_at         timestamptz,
  duration_ms      integer generated always as (
                     extract(epoch from (coalesce(ended_at, started_at) - started_at)) * 1000
                   ) stored,
  recording_enabled boolean not null default false,
  is_emergency     boolean not null default false,
  floor_granted_at timestamptz,
  floor_released_at timestamptz,
  metadata         jsonb not null default '{}',
  created_at       timestamptz not null default now()
);

create index if not exists radio_transmissions_org_id_idx        on radio_transmissions (org_id);
create index if not exists radio_transmissions_channel_id_idx    on radio_transmissions (channel_id);
create index if not exists radio_transmissions_speaker_id_idx    on radio_transmissions (speaker_id);
create index if not exists radio_transmissions_started_at_idx    on radio_transmissions (started_at desc);

comment on table radio_transmissions is
  'One row per PTT transmission session. Org-scoped. Source of truth for floor control audit.';
