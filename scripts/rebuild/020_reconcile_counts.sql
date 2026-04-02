-- Rebuild reconciliation: compare key record counts after ETL
-- Run in source and target contexts as needed.

with counts as (
  select 'organizations' as table_name, count(*)::bigint as row_count from public.organizations
  union all select 'user_profiles', count(*) from public.user_profiles
  union all select 'zones', count(*) from public.zones
  union all select 'canonical_vehicles', count(*) from public.canonical_vehicles
  union all select 'canonical_scv', count(*) from public.canonical_scv
  union all select 'canonical_homeless', count(*) from public.canonical_homeless
  union all select 'observations', count(*) from public.observations
  union all select 'breach_alerts', count(*) from public.breach_alerts
  union all select 'infringement_notices', count(*) from public.infringement_notices
  union all select 'notices_to_vacate', count(*) from public.notices_to_vacate
  union all select 'patrols', count(*) from public.patrols
  union all select 'officer_shifts', count(*) from public.officer_shifts
  union all select 'incidents', count(*) from public.incidents
  union all select 'person_records', count(*) from public.person_records
  union all select 'dispute_intake', count(*) from public.dispute_intake
)
select *
from counts
order by table_name;

-- Optional integrity probes
select
  count(*) filter (where organization_id is null) as observations_missing_org,
  count(*) filter (where zone_id is null) as observations_missing_zone,
  count(*) filter (where plate_number is null or plate_number = '') as observations_missing_plate
from public.observations;

select
  count(*) filter (where organization_id is null) as breaches_missing_org,
  count(*) filter (where zone_id is null) as breaches_missing_zone,
  count(*) filter (where breach_type is null or breach_type = '') as breaches_missing_type
from public.breach_alerts;
