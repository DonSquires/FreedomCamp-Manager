-- Rebuild ETL: migrate core data from live schema to clean baseline
-- Usage: run after loading clean baseline on target project.

begin;

-- Organizations
insert into public.organizations (id, name, legal_name, timezone, is_active, created_at, updated_at)
select
  o.id,
  o.name,
  null,
  coalesce(o.timezone, 'Pacific/Auckland'),
  coalesce(o.is_active, true),
  coalesce(o.created_at, now()),
  coalesce(o.updated_at, now())
from public.organizations o
on conflict (id) do update
set
  name = excluded.name,
  timezone = excluded.timezone,
  is_active = excluded.is_active,
  updated_at = excluded.updated_at;

-- User profiles (restrict to clean role model)
insert into public.user_profiles (id, organization_id, email, full_name, role, is_active, created_at, updated_at)
select
  up.id,
  up.organization_id,
  up.email,
  trim(concat_ws(' ', up.first_name, up.last_name)) as full_name,
  case
    when up.role = 'admin_officer' then 'admin'
    when up.role = 'nzscv_monitor' then 'officer'
    when up.role in ('officer','admin','master','grand_master') then up.role
    else 'officer'
  end as role,
  coalesce(up.is_active, true),
  coalesce(up.created_at, now()),
  coalesce(up.updated_at, now())
from public.user_profiles up
where up.organization_id is not null
on conflict (id) do update
set
  organization_id = excluded.organization_id,
  email = excluded.email,
  full_name = excluded.full_name,
  role = excluded.role,
  is_active = excluded.is_active,
  updated_at = excluded.updated_at;

-- Zones
insert into public.zones (id, organization_id, name, zone_type, is_active, geometry_geojson, created_at, updated_at)
select
  z.id,
  z.organization_id,
  z.name,
  coalesce(z.zone_type, 'standard'),
  coalesce(z.is_active, true),
  coalesce(z.geojson, null),
  coalesce(z.created_at, now()),
  coalesce(z.updated_at, now())
from public.zones z
where z.organization_id is not null
on conflict (id) do update
set
  name = excluded.name,
  zone_type = excluded.zone_type,
  is_active = excluded.is_active,
  geometry_geojson = excluded.geometry_geojson,
  updated_at = excluded.updated_at;

-- Canonical tables
insert into public.canonical_vehicles (vehicle_id, plate_number, vehicle_make, vehicle_model, vehicle_color, vehicle_year, first_seen_at, last_seen_at, total_observations, created_at, updated_at)
select
  coalesce(cv.vehicle_id, gen_random_uuid()),
  cv.plate_number,
  cv.vehicle_make,
  cv.vehicle_model,
  cv.vehicle_color,
  cv.vehicle_year,
  coalesce(cv.first_seen_at, now()),
  coalesce(cv.last_seen_at, now()),
  coalesce(cv.total_observations, 0),
  coalesce(cv.created_at, now()),
  coalesce(cv.updated_at, now())
from public.canonical_vehicles cv
where cv.plate_number is not null
on conflict (plate_number) do update
set
  vehicle_make = excluded.vehicle_make,
  vehicle_model = excluded.vehicle_model,
  vehicle_color = excluded.vehicle_color,
  vehicle_year = excluded.vehicle_year,
  last_seen_at = greatest(public.canonical_vehicles.last_seen_at, excluded.last_seen_at),
  total_observations = greatest(public.canonical_vehicles.total_observations, excluded.total_observations),
  updated_at = excluded.updated_at;

insert into public.canonical_scv (plate_number, is_self_contained, certificate_number, certificate_expiry, source, checked_at, created_at, updated_at)
select
  cs.plate_number,
  coalesce(cs.is_self_contained, false),
  cs.certificate_number,
  cs.certificate_expiry,
  cs.source,
  cs.checked_at,
  coalesce(cs.created_at, now()),
  coalesce(cs.updated_at, now())
from public.canonical_scv cs
where cs.plate_number is not null
on conflict (plate_number) do update
set
  is_self_contained = excluded.is_self_contained,
  certificate_number = excluded.certificate_number,
  certificate_expiry = excluded.certificate_expiry,
  source = excluded.source,
  checked_at = excluded.checked_at,
  updated_at = excluded.updated_at;

insert into public.canonical_homeless (plate_number, status, notes, confirmed_by, confirmed_at, created_at, updated_at)
select
  ch.plate_number,
  coalesce(ch.status, 'none'),
  ch.notes,
  ch.confirmed_by,
  ch.confirmed_at,
  coalesce(ch.created_at, now()),
  coalesce(ch.updated_at, now())
from public.canonical_homeless ch
where ch.plate_number is not null
on conflict (plate_number) do update
set
  status = excluded.status,
  notes = excluded.notes,
  confirmed_by = excluded.confirmed_by,
  confirmed_at = excluded.confirmed_at,
  updated_at = excluded.updated_at;

-- Observations
insert into public.observations (
  observation_id,
  organization_id,
  zone_id,
  recorded_by,
  plate_number,
  recorded_at,
  gps_latitude,
  gps_longitude,
  photo_url,
  officer_notes,
  is_compliant,
  breach_type,
  breach_reason,
  nights_stayed_this_month,
  consecutive_nights,
  compliance_snapshot,
  idempotency_key,
  created_at,
  updated_at
)
select
  o.observation_id,
  o.organization_id,
  o.zone_id,
  o.recorded_by,
  o.plate_number,
  o.recorded_at,
  o.gps_latitude,
  o.gps_longitude,
  coalesce(o.photo_url, o.photo),
  coalesce(o.officer_notes, o.observation_notes),
  coalesce(o.is_compliant, true),
  o.breach_type,
  o.breach_reason,
  coalesce(o.nights_stayed_this_month, 0),
  coalesce(o.consecutive_nights, 0),
  o.compliance_snapshot,
  o.idempotency_key,
  coalesce(o.created_at, now()),
  coalesce(o.updated_at, now())
from public.observations o
where o.organization_id is not null
  and o.zone_id is not null
  and o.plate_number is not null
on conflict (observation_id) do update
set
  is_compliant = excluded.is_compliant,
  breach_type = excluded.breach_type,
  breach_reason = excluded.breach_reason,
  nights_stayed_this_month = excluded.nights_stayed_this_month,
  consecutive_nights = excluded.consecutive_nights,
  compliance_snapshot = excluded.compliance_snapshot,
  updated_at = excluded.updated_at;

-- Breach alerts
insert into public.breach_alerts (
  id,
  organization_id,
  zone_id,
  observation_id,
  plate_number,
  breach_type,
  breach_details,
  status,
  assigned_to,
  admin_review_notes,
  resolved_at,
  created_at,
  updated_at
)
select
  ba.id,
  ba.organization_id,
  ba.zone_id,
  ba.observation_id,
  ba.plate_number,
  ba.breach_type,
  coalesce(ba.breach_details, '{}'::jsonb),
  coalesce(ba.status, 'pending'),
  ba.assigned_to,
  ba.admin_review_notes,
  ba.resolved_at,
  coalesce(ba.created_at, now()),
  coalesce(ba.updated_at, now())
from public.breach_alerts ba
where ba.organization_id is not null
  and ba.zone_id is not null
on conflict (id) do update
set
  status = excluded.status,
  assigned_to = excluded.assigned_to,
  admin_review_notes = excluded.admin_review_notes,
  resolved_at = excluded.resolved_at,
  updated_at = excluded.updated_at;

commit;
