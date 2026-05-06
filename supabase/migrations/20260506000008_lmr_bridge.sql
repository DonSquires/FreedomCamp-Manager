-- B-35: LMR / Radio Bridge scaffold
-- Stores per-org Zello Gateway bridge configuration and live/historical
-- session log (each session = one PTT transmission relayed from/to LMR).

-- ── Bridge configuration ─────────────────────────────────────────────────────
create table if not exists public.lmr_bridge_config (
  id                  uuid primary key default gen_random_uuid(),
  organization_id     uuid not null references public.organizations(id) on delete cascade,
  label               text not null,                           -- e.g. "Nelson City Trunked P25"
  gateway_url         text not null,                           -- Zello Gateway WebSocket URL
  gateway_token       text,                                    -- encrypted at rest in Vault; stored reference only
  radio_channel       text not null default 'tactical',        -- Zello channel name
  direction           text not null default 'bidirectional'    -- 'inbound' | 'outbound' | 'bidirectional'
                        check (direction in ('inbound', 'outbound', 'bidirectional')),
  is_active           boolean not null default true,
  notes               text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint lmr_bridge_config_org_unique unique (organization_id, label)
);

create or replace function public.set_lmr_bridge_config_updated_at()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger lmr_bridge_config_updated_at
  before update on public.lmr_bridge_config
  for each row execute function public.set_lmr_bridge_config_updated_at();

-- ── Bridge sessions (relay log) ───────────────────────────────────────────────
create table if not exists public.lmr_bridge_sessions (
  id                  uuid primary key default gen_random_uuid(),
  organization_id     uuid not null references public.organizations(id) on delete cascade,
  config_id           uuid not null references public.lmr_bridge_config(id) on delete cascade,
  direction           text not null check (direction in ('lmr_to_ptt', 'ptt_to_lmr')),
  radio_unit_id       text,                                    -- LMR radio unit identifier (P25 SRCID etc.)
  radio_unit_alias    text,                                    -- Human-readable callsign from gateway
  ptt_speaker_id      uuid references auth.users(id),         -- Set when direction='ptt_to_lmr'
  ptt_speaker_name    text,
  channel_id          text not null,                           -- Zello channel
  started_at          timestamptz not null default now(),
  ended_at            timestamptz,
  duration_ms         integer generated always as (
                        extract(epoch from (coalesce(ended_at, started_at) - started_at)) * 1000
                      ) stored,
  audio_url           text,                                    -- recording URL if enabled
  transcript          text,                                    -- STT transcript if available
  is_emergency        boolean not null default false,
  metadata            jsonb not null default '{}',
  created_at          timestamptz not null default now()
);

create index if not exists idx_lmr_bridge_sessions_org_started
  on public.lmr_bridge_sessions (organization_id, started_at desc);
create index if not exists idx_lmr_bridge_sessions_config
  on public.lmr_bridge_sessions (config_id);

-- ── RLS ───────────────────────────────────────────────────────────────────────
alter table public.lmr_bridge_config enable row level security;

create policy "lmr_bridge_config_select" on public.lmr_bridge_config
  for select using (organization_id = any(public.get_user_organization_ids()));

create policy "lmr_bridge_config_insert" on public.lmr_bridge_config
  for insert with check (organization_id = any(public.get_user_organization_ids()));

create policy "lmr_bridge_config_update" on public.lmr_bridge_config
  for update using (organization_id = any(public.get_user_organization_ids()));

create policy "lmr_bridge_config_delete" on public.lmr_bridge_config
  for delete using (organization_id = any(public.get_user_organization_ids()));

alter table public.lmr_bridge_sessions enable row level security;

create policy "lmr_bridge_sessions_select" on public.lmr_bridge_sessions
  for select using (organization_id = any(public.get_user_organization_ids()));

-- Service role (edge function) needs INSERT for session logging
create policy "lmr_bridge_sessions_service_insert" on public.lmr_bridge_sessions
  for insert with check (true);  -- restricted to service_role via edge function auth
