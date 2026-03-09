-- Monthly geofence drift review dashboard
-- Usage: run after scripts/review_zone_geofences.ts

-- 1) Summary for latest review month
select
  review_month,
  event_type,
  count(*) as event_count
from public.drift_events
where review_month is not null
  and event_type in ('geofence_new_zone', 'geofence_boundary_change', 'geofence_degraded_zone')
group by review_month, event_type
order by review_month desc, event_type;

-- 2) Zones with repeated geofence degradation in last 6 months
select
  z.organization_id,
  z.id as zone_id,
  z.name as zone_name,
  count(*) as degradation_events
from public.drift_events de
join public.zones z on z.id = de.zone_id
where de.event_type = 'geofence_degraded_zone'
  and de.review_month >= (date_trunc('month', now())::date - interval '6 months')::date
group by z.organization_id, z.id, z.name
having count(*) >= 2
order by degradation_events desc, z.name;

-- 3) Latest snapshot quality by organization
with latest_month as (
  select max(snapshot_month) as snapshot_month
  from public.zone_geofence_monthly_snapshots
)
select
  s.organization_id,
  s.quality_status,
  count(*) as zone_count
from public.zone_geofence_monthly_snapshots s
join latest_month lm on lm.snapshot_month = s.snapshot_month
group by s.organization_id, s.quality_status
order by s.organization_id, s.quality_status;
