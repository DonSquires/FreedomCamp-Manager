-- Migration: radio_voice_profiles and radio_voice_consents
-- Phase 1 Group A — Radio Core schema
-- Consented voice profile registry and auditable consent/revocation records.
-- Per ADR 006: no enrollment allowed without active consent. Revocation is immediate.

create table if not exists radio_voice_profiles (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references organizations(id) on delete cascade,
  officer_id      uuid not null references public.user_profiles(id) on delete cascade,
  provider        text not null check (provider in ('coqui-xtts')),
  model_ref       text not null,  -- provider-internal reference to the enrolled voice model
  enrolled_at     timestamptz not null default now(),
  revoked_at      timestamptz,
  is_active       boolean not null generated always as (revoked_at is null) stored,
  created_at      timestamptz not null default now(),
  unique (org_id, officer_id, provider)
);

create index if not exists radio_voice_profiles_org_id_idx     on radio_voice_profiles (org_id);
create index if not exists radio_voice_profiles_officer_id_idx on radio_voice_profiles (officer_id);

comment on table radio_voice_profiles is
  'Consented voice profiles for Phase 5 voice-twin synthesis. is_active=false immediately after revocation. No synthesis permitted without active profile.';

-- -------------------------------------------------------------------------

create table if not exists radio_voice_consents (
  id               uuid primary key default gen_random_uuid(),
  org_id           uuid not null references organizations(id) on delete cascade,
  officer_id       uuid not null references public.user_profiles(id) on delete cascade,
  voice_profile_id uuid references radio_voice_profiles(id) on delete set null,
  purpose          text not null,
  retention_days   integer not null default 90,
  provider         text not null,
  consented_at     timestamptz not null default now(),
  revoked_at       timestamptz,
  revocation_reason text,
  created_at       timestamptz not null default now()
);

create index if not exists radio_voice_consents_org_id_idx     on radio_voice_consents (org_id);
create index if not exists radio_voice_consents_officer_id_idx on radio_voice_consents (officer_id);

comment on table radio_voice_consents is
  'Auditable consent and revocation records for voice-twin enrollment. Per ADR 006: revocation blocks synthesis within 60s.';
