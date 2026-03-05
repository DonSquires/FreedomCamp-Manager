-- =====================================================
-- PERSON OBSERVATIONS TABLE
-- Links person records to canonical vehicles and zones through observations
-- Enables many-to-many relationships (one person can have multiple vehicles, one vehicle can have multiple associated persons)
-- =====================================================

-- Create person_observations table
create table if not exists public.person_observations (
  id uuid primary key default gen_random_uuid(),
  person_id uuid not null references public.person_records(id) on delete cascade,
  plate_number text references public.canonical_vehicles(plate_number) on delete cascade,
  zone_id uuid not null references public.zones(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  observation_type text not null check (observation_type in ('vehicle_associated', 'zone_sighting', 'welfare_check', 'incident_linked', 'trespass_notice', 'homeless_verification')),
  recorded_by uuid not null references public.user_profiles(id) on delete cascade,
  recorded_at timestamptz not null default now(),
  gps_latitude numeric(10, 8),
  gps_longitude numeric(11, 8),
  gps_accuracy numeric(10, 2),
  officer_notes text,
  evidence_photos text[] default array[]::text[],
  metadata jsonb default '{}'::jsonb, -- For flexible additional data
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Indices for performance
create index if not exists idx_person_observations_person on public.person_observations(person_id);
create index if not exists idx_person_observations_plate on public.person_observations(plate_number);
create index if not exists idx_person_observations_zone on public.person_observations(zone_id);
create index if not exists idx_person_observations_org on public.person_observations(organization_id);
create index if not exists idx_person_observations_recorded_at on public.person_observations(recorded_at desc);
create index if not exists idx_person_observations_type on public.person_observations(observation_type);

-- RLS Policies
alter table public.person_observations enable row level security;

-- Users can view observations from their organization
create policy "users_view_org_person_observations"
  on public.person_observations for select
  using (
    get_user_role(auth.uid()) = 'master' OR 
    organization_id = get_user_organization_id(auth.uid())
  );

-- Users can create person observations for their organization
create policy "users_create_person_observations"
  on public.person_observations for insert
  with check (
    recorded_by = auth.uid() AND
    (organization_id = get_user_organization_id(auth.uid()) OR get_user_role(auth.uid()) = 'master')
  );

-- Admins can update person observations
create policy "admins_update_person_observations"
  on public.person_observations for update
  using (
    (get_user_role(auth.uid()) = ANY (array['admin', 'master'])) AND
    (get_user_role(auth.uid()) = 'master' OR organization_id = get_user_organization_id(auth.uid()))
  );

-- Super delete policy
create policy "super_delete_person_observations"
  on public.person_observations for delete
  using (
    exists (
      select 1 from user_profiles
      where id = auth.uid()
      and email = 'don.squire@firstsecurity.co.nz'
      and permissions @> '["super_delete"]'::jsonb
    )
  );

-- Updated_at trigger
create trigger update_person_observations_updated_at
  before update on public.person_observations
  for each row
  execute function update_updated_at_column();

-- Add helper function to get person observations with details
create or replace function get_person_observation_history(p_person_id uuid)
returns table (
  id uuid,
  observation_type text,
  recorded_at timestamptz,
  officer_name text,
  zone_name text,
  plate_number text,
  officer_notes text,
  evidence_photos text[],
  vehicle_make text,
  vehicle_model text,
  vehicle_color text
) language plpgsql security definer as $$
begin
  return query
  select 
    po.id,
    po.observation_type,
    po.recorded_at,
    concat(up.first_name, ' ', up.last_name) as officer_name,
    z.name as zone_name,
    po.plate_number,
    po.officer_notes,
    po.evidence_photos,
    cv.vehicle_make,
    cv.vehicle_model,
    cv.vehicle_color
  from person_observations po
  left join user_profiles up on up.id = po.recorded_by
  left join zones z on z.id = po.zone_id
  left join canonical_vehicles cv on cv.plate_number = po.plate_number
  where po.person_id = p_person_id
  order by po.recorded_at desc;
end;
$$;

-- Update person_records with aggregated observation count trigger
create or replace function update_person_observation_count()
returns trigger language plpgsql security definer as $$
begin
  update person_records
  set 
    total_interactions = (
      select count(*) 
      from person_observations 
      where person_id = new.person_id
    ),
    last_contact_at = new.recorded_at,
    updated_at = now()
  where id = new.person_id;
  
  return new;
end;
$$;

create trigger trigger_update_person_observation_count
  after insert on public.person_observations
  for each row
  execute function update_person_observation_count();

-- Comment
comment on table public.person_observations is 'Links person records to vehicles and zones through observations. Enables tracking of person-vehicle relationships, zone sightings, and welfare checks without rigid one-to-one constraints.';
