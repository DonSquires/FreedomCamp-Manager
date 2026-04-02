-- FreedomCamp Manager clean rebuild baseline
-- Date: 2026-04-01
-- Purpose: standalone baseline for clean rebuild track.
-- Safety: this file is intentionally outside supabase/migrations until cutover planning is approved.

create extension if not exists pgcrypto;

-- -----------------------------------------------------------------------------
-- Shared helpers
-- -----------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- -----------------------------------------------------------------------------
-- Core tenancy and identity
-- -----------------------------------------------------------------------------
create table if not exists public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  legal_name text,
  timezone text not null default 'Pacific/Auckland',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.user_profiles (
  id uuid primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  email text not null,
  full_name text,
  role text not null check (role in ('officer','admin','master','grand_master')),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, email)
);

-- -----------------------------------------------------------------------------
-- Geospatial compliance model
-- -----------------------------------------------------------------------------
create table if not exists public.zones (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  zone_type text,
  is_active boolean not null default true,
  geometry_geojson jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, name)
);

create table if not exists public.zone_compliance_matrix (
  id uuid primary key default gen_random_uuid(),
  zone_id uuid not null references public.zones(id) on delete cascade,
  effective_from date not null,
  effective_to date,
  max_nights_per_month integer not null default 3,
  max_consecutive_nights integer not null default 1,
  requires_self_contained boolean not null default false,
  after_hours_prohibited boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.zone_legal_config (
  id uuid primary key default gen_random_uuid(),
  zone_id uuid not null unique references public.zones(id) on delete cascade,
  issuing_authority text,
  payment_url text,
  objection_url text,
  dispute_url text,
  notice_contact_email text,
  notice_contact_phone text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.zone_signage_evidence (
  id uuid primary key default gen_random_uuid(),
  zone_id uuid not null references public.zones(id) on delete cascade,
  image_url text not null,
  captured_at timestamptz,
  captured_by uuid references public.user_profiles(id),
  notes text,
  created_at timestamptz not null default now()
);

-- -----------------------------------------------------------------------------
-- Vehicle canonical model
-- -----------------------------------------------------------------------------
create table if not exists public.canonical_vehicles (
  vehicle_id uuid primary key default gen_random_uuid(),
  plate_number text not null unique,
  vehicle_make text,
  vehicle_model text,
  vehicle_color text,
  vehicle_year integer,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  total_observations integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.canonical_scv (
  id uuid primary key default gen_random_uuid(),
  plate_number text not null unique,
  is_self_contained boolean not null default false,
  certificate_number text,
  certificate_expiry date,
  source text,
  checked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.canonical_homeless (
  id uuid primary key default gen_random_uuid(),
  plate_number text not null unique,
  status text not null default 'none' check (status in ('none','flagged','confirmed')),
  notes text,
  confirmed_by uuid references public.user_profiles(id),
  confirmed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- -----------------------------------------------------------------------------
-- Observations and enforcement
-- -----------------------------------------------------------------------------
create table if not exists public.observations (
  observation_id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  zone_id uuid not null references public.zones(id),
  recorded_by uuid references public.user_profiles(id),
  plate_number text not null,
  recorded_at timestamptz not null,
  gps_latitude numeric,
  gps_longitude numeric,
  photo_url text,
  officer_notes text,
  is_compliant boolean not null default true,
  breach_type text,
  breach_reason text,
  nights_stayed_this_month integer not null default 0,
  consecutive_nights integer not null default 0,
  compliance_snapshot jsonb,
  idempotency_key text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (idempotency_key)
);

create index if not exists idx_observations_org_recorded on public.observations (organization_id, recorded_at desc);
create index if not exists idx_observations_plate_recorded on public.observations (plate_number, recorded_at desc);

create table if not exists public.breach_alerts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  zone_id uuid not null references public.zones(id),
  observation_id uuid references public.observations(observation_id) on delete set null,
  plate_number text,
  breach_type text not null,
  breach_details jsonb not null default '{}'::jsonb,
  status text not null default 'pending' check (status in ('pending','acknowledged','enforcement_started','resolved','dismissed')),
  assigned_to uuid references public.user_profiles(id),
  admin_review_notes text,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.enforcement_cases (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  plate_number text not null,
  status text not null default 'open' check (status in ('open','in_progress','closed')),
  opened_by uuid references public.user_profiles(id),
  opened_at timestamptz not null default now(),
  closed_at timestamptz,
  close_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.enforcement_case_events (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.enforcement_cases(id) on delete cascade,
  event_type text not null,
  event_payload jsonb not null default '{}'::jsonb,
  created_by uuid references public.user_profiles(id),
  created_at timestamptz not null default now()
);

create table if not exists public.infringement_notice_counters (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  next_number bigint not null default 1,
  updated_at timestamptz not null default now()
);

create table if not exists public.infringement_notices (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  observation_id uuid references public.observations(observation_id) on delete set null,
  case_id uuid references public.enforcement_cases(id) on delete set null,
  notice_number text not null,
  plate_number text not null,
  issued_at timestamptz not null default now(),
  status text not null default 'issued' check (status in ('issued','paid','withdrawn','void')),
  amount_cents integer,
  document_url text,
  created_by uuid references public.user_profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, notice_number)
);

create table if not exists public.notices_to_vacate (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  observation_id uuid references public.observations(observation_id) on delete set null,
  plate_number text not null,
  issued_at timestamptz not null default now(),
  expiry_at timestamptz,
  status text not null default 'active' check (status in ('active','expired','cancelled')),
  document_url text,
  created_by uuid references public.user_profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- -----------------------------------------------------------------------------
-- Patrol and welfare
-- -----------------------------------------------------------------------------
create table if not exists public.patrols (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  starts_at timestamptz,
  ends_at timestamptz,
  status text not null default 'scheduled' check (status in ('scheduled','active','completed','cancelled')),
  created_by uuid references public.user_profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.patrol_schedule_zones (
  id uuid primary key default gen_random_uuid(),
  patrol_id uuid not null references public.patrols(id) on delete cascade,
  zone_id uuid not null references public.zones(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (patrol_id, zone_id)
);

create table if not exists public.patrol_checkpoints (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  zone_id uuid references public.zones(id) on delete set null,
  name text not null,
  qr_code text,
  latitude numeric,
  longitude numeric,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.checkpoint_visits (
  id uuid primary key default gen_random_uuid(),
  checkpoint_id uuid not null references public.patrol_checkpoints(id) on delete cascade,
  officer_id uuid not null references public.user_profiles(id) on delete cascade,
  patrol_id uuid references public.patrols(id) on delete set null,
  visited_at timestamptz not null default now(),
  latitude numeric,
  longitude numeric,
  created_at timestamptz not null default now()
);

create table if not exists public.officer_shifts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  officer_id uuid not null references public.user_profiles(id) on delete cascade,
  started_at timestamptz not null,
  ended_at timestamptz,
  status text not null default 'active' check (status in ('active','completed','cancelled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.officer_welfare_settings (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  check_interval_minutes integer not null default 45,
  grace_minutes integer not null default 15,
  escalation_email text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.officer_activity_log (
  id uuid primary key default gen_random_uuid(),
  officer_id uuid not null references public.user_profiles(id) on delete cascade,
  shift_id uuid references public.officer_shifts(id) on delete set null,
  activity_type text not null,
  latitude numeric,
  longitude numeric,
  recorded_at timestamptz not null default now(),
  payload jsonb not null default '{}'::jsonb
);

create table if not exists public.officer_welfare_alerts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  officer_id uuid not null references public.user_profiles(id) on delete cascade,
  shift_id uuid references public.officer_shifts(id) on delete set null,
  alert_type text not null,
  status text not null default 'open' check (status in ('open','acknowledged','resolved')),
  triggered_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid references public.user_profiles(id),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- -----------------------------------------------------------------------------
-- Incidents and persons
-- -----------------------------------------------------------------------------
create table if not exists public.incidents (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  observation_id uuid references public.observations(observation_id) on delete set null,
  incident_type text not null,
  severity text,
  summary text,
  details text,
  status text not null default 'open' check (status in ('open','in_progress','closed')),
  reported_by uuid references public.user_profiles(id),
  reported_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.incident_attachments (
  id uuid primary key default gen_random_uuid(),
  incident_id uuid not null references public.incidents(id) on delete cascade,
  file_url text not null,
  file_type text,
  uploaded_by uuid references public.user_profiles(id),
  uploaded_at timestamptz not null default now()
);

create table if not exists public.health_safety_reports (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  incident_id uuid references public.incidents(id) on delete set null,
  report_number text,
  status text not null default 'open',
  details text,
  created_by uuid references public.user_profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.person_records (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  first_name text,
  last_name text,
  aliases jsonb,
  risk_level text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.person_vehicle_links (
  id uuid primary key default gen_random_uuid(),
  person_id uuid not null references public.person_records(id) on delete cascade,
  plate_number text not null,
  relationship_type text,
  created_at timestamptz not null default now(),
  unique (person_id, plate_number)
);

create table if not exists public.person_observations (
  id uuid primary key default gen_random_uuid(),
  person_id uuid not null references public.person_records(id) on delete cascade,
  observation_id uuid not null references public.observations(observation_id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (person_id, observation_id)
);

create table if not exists public.person_interactions (
  id uuid primary key default gen_random_uuid(),
  person_id uuid not null references public.person_records(id) on delete cascade,
  officer_id uuid references public.user_profiles(id),
  interaction_type text,
  notes text,
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

-- -----------------------------------------------------------------------------
-- Governance, privacy, disputes
-- -----------------------------------------------------------------------------
create table if not exists public.audit_log (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete cascade,
  actor_id uuid references public.user_profiles(id),
  action text not null,
  entity_type text,
  entity_id text,
  metadata jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now()
);

create table if not exists public.dispute_intake (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete set null,
  notice_number text,
  plate_number text,
  claimant_name text,
  claimant_email text,
  claim_text text,
  status text not null default 'submitted' check (status in ('submitted','under_review','resolved','rejected')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.privacy_curtain_settings (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  blur_plate_images boolean not null default false,
  blur_person_images boolean not null default false,
  redact_export_pii boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.privacy_access_log (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  actor_id uuid references public.user_profiles(id),
  purpose text,
  entity_type text,
  entity_id text,
  accessed_at timestamptz not null default now()
);

create table if not exists public.retention_policies (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  data_class text not null,
  retention_days integer not null,
  hard_delete boolean not null default false,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, data_class)
);

-- -----------------------------------------------------------------------------
-- Updated-at triggers
-- -----------------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array[
    'organizations','user_profiles','zones','zone_compliance_matrix','zone_legal_config',
    'canonical_vehicles','canonical_scv','canonical_homeless','observations','breach_alerts',
    'enforcement_cases','infringement_notice_counters','infringement_notices','notices_to_vacate',
    'patrols','patrol_checkpoints','officer_shifts','officer_welfare_settings','officer_welfare_alerts',
    'incidents','health_safety_reports','person_records','dispute_intake','privacy_curtain_settings',
    'retention_policies'
  ]
  loop
    execute format('drop trigger if exists trg_%I_set_updated_at on public.%I', t, t);
    execute format('create trigger trg_%I_set_updated_at before update on public.%I for each row execute function public.set_updated_at()', t, t);
  end loop;
end
$$;

-- -----------------------------------------------------------------------------
-- Placeholder RLS posture
-- -----------------------------------------------------------------------------
-- Full policy implementation should be added in 0002_clean_rls.sql during rebuild.
alter table public.organizations enable row level security;
alter table public.user_profiles enable row level security;
alter table public.zones enable row level security;
alter table public.observations enable row level security;
alter table public.breach_alerts enable row level security;

-- Minimal bootstrap read policy for service role compatibility during bring-up.
create policy if not exists service_role_all_organizations on public.organizations
  for all using (auth.role() = 'service_role') with check (auth.role() = 'service_role');
