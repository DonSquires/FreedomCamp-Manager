-- Performance indexes for observations queries
-- These ensure fast filtering on date, org, zone, and plate number

-- Core filter indexes (if not exist)
create index if not exists idx_observations_recorded_at 
  on public.observations(recorded_at);

create index if not exists idx_observations_organization_id 
  on public.observations(organization_id);

create index if not exists idx_observations_zone_id 
  on public.observations(zone_id);

create index if not exists idx_observations_plate_number 
  on public.observations(plate_number);

-- GPS coordinate indexes for map bounds queries
create index if not exists idx_observations_gps_latitude 
  on public.observations(gps_latitude);

create index if not exists idx_observations_gps_longitude 
  on public.observations(gps_longitude);

-- Composite index for common filter combinations
create index if not exists idx_observations_filters 
  on public.observations(organization_id, zone_id, recorded_at desc);

-- Comment explaining the indexes
comment on index idx_observations_recorded_at is 
  'Fast filtering by date range - used in all admin queries';

comment on index idx_observations_filters is 
  'Composite index for common filter combinations (org + zone + date)';

comment on index idx_observations_gps_latitude is 
  'GPS coordinate index for map bounds queries (cluster drilldowns)';
