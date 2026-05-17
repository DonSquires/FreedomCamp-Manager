-- Migration: user_radio_preferences
-- Phase 0-4 — per-user radio playback preference storage.
-- Stores audio playback mode (original | translated | both) and preferred
-- target language for translation relay. Org-scoped for RLS.

create table if not exists user_radio_preferences (
  id                    uuid primary key default gen_random_uuid(),
  user_id               uuid not null references auth.users(id) on delete cascade,
  org_id                uuid not null references public.organizations(id) on delete cascade,
  audio_playback_mode   text not null default 'original'
                          check (audio_playback_mode in ('original', 'translated', 'both')),
  preferred_language    text not null default 'en-NZ',
  tts_relay_enabled     boolean not null default false,
  updated_at            timestamptz not null default now(),
  unique (user_id, org_id)
);

create index if not exists user_radio_preferences_user_id_idx on user_radio_preferences (user_id);
create index if not exists user_radio_preferences_org_id_idx  on user_radio_preferences (org_id);

comment on table user_radio_preferences is
  'Per-user radio playback and translation preferences. One row per user per org.';

-- RLS
alter table public.user_radio_preferences enable row level security;

create policy "user_radio_preferences_select_own"
  on public.user_radio_preferences for select
  using (auth.uid() = user_id);

create policy "user_radio_preferences_insert_own"
  on public.user_radio_preferences for insert
  with check (auth.uid() = user_id);

create policy "user_radio_preferences_update_own"
  on public.user_radio_preferences for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "user_radio_preferences_delete_own"
  on public.user_radio_preferences for delete
  using (auth.uid() = user_id);
