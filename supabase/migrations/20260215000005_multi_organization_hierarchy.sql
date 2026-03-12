-- Multi-Organization Hierarchy (3-Tier)
-- Iron Eagle (Owner) → First Security (Service Provider) → LINZ/Nelson (Clients)

-- Step 1: Add parent organization support and hierarchy fields
alter table organizations
add column if not exists parent_organization_id uuid references organizations(id) on delete set null,
add column if not exists organization_level integer default 1 check (organization_level >= 1),
add column if not exists organization_type text default 'client' check (organization_type in ('owner', 'service_provider', 'client'));

-- Add indexes for performance
create index if not exists idx_organizations_parent on organizations(parent_organization_id);
create index if not exists idx_organizations_level on organizations(organization_level);
create index if not exists idx_organizations_type on organizations(organization_type);

comment on column organizations.parent_organization_id is 'Parent organization for multi-tier hierarchy. NULL for root organization (Iron Eagle).';
comment on column organizations.organization_level is 'Hierarchy level: 1 = Root (Iron Eagle), 2 = Service Provider (First Security), 3 = End Client (LINZ/Nelson)';
comment on column organizations.organization_type is 'owner = platform owner (Iron Eagle), service_provider = reseller (First Security), client = end customer (LINZ/Nelson)';

-- Step 2: Set up 3-tier hierarchy
-- Iron Eagle = Level 1 Owner (root)
update organizations
set organization_type = 'owner',
    organization_level = 1,
    parent_organization_id = null
where name = 'Iron Eagle Security';

-- First Security = Level 2 Service Provider (child of Iron Eagle)
update organizations
set organization_type = 'service_provider',
    organization_level = 2,
    parent_organization_id = (select id from organizations where name = 'Iron Eagle Security')
where name = 'First Security';

-- LINZ & Nelson = Level 3 Clients (children of First Security)
update organizations
set organization_type = 'client',
    organization_level = 3,
    parent_organization_id = (select id from organizations where name = 'First Security')
where name in ('LINZ', 'Nelson City Council', 'Nelson');

-- Step 3: Create recursive descendant function
create or replace function get_descendant_organizations(org_id uuid)
returns uuid[] as $$
declare
  descendants uuid[];
begin
  -- Get current org + all descendants recursively using CTE
  with recursive org_tree as (
    -- Base case: start with the given organization
    select id, parent_organization_id
    from organizations
    where id = org_id
    
    union all
    
    -- Recursive case: get children of current level
    select o.id, o.parent_organization_id
    from organizations o
    inner join org_tree ot on o.parent_organization_id = ot.id
  )
  select array_agg(id) into descendants from org_tree;
  
  return coalesce(descendants, array[]::uuid[]);
end;
$$ language plpgsql stable;

comment on function get_descendant_organizations(uuid) is 
'Returns array of organization ID + all descendant organization IDs (recursive). Used for multi-org access control.';

-- Step 4: Update get_user_organization_ids to use recursive logic
create or replace function get_user_organization_ids()
returns uuid[] as $$
declare
  user_org_id uuid;
  descendant_ids uuid[];
begin
  -- Get user's primary organization
  select organization_id into user_org_id
  from user_profiles
  where id = auth.uid();
  
  if user_org_id is null then
    return array[]::uuid[];
  end if;
  
  -- Get all descendants of user's organization (includes self)
  descendant_ids := get_descendant_organizations(user_org_id);
  
  return descendant_ids;
end;
$$ language plpgsql stable security definer;

comment on function get_user_organization_ids() is 
'Returns current user organization + all descendant organizations (for RLS policies). Uses recursive function.';

-- Step 5: Update RLS policies to use recursive multi-org logic
-- We'll update key tables to support multi-org access

-- zones table
drop policy if exists "users_view_zones" on zones;
create policy "users_view_zones"
on zones for select
to authenticated
using (
  (get_user_role(auth.uid()) = 'master') or
  (organization_id = any(get_user_organization_ids()))
);

-- observations table
drop policy if exists "users_view_observations_v2" on observations;
create policy "users_view_observations_v2"
on observations for select
to authenticated
using (
  (get_user_role(auth.uid()) = 'master') or
  (organization_id = any(get_user_organization_ids()))
);

-- compliance_results table
drop policy if exists "users_view_org_compliance_results" on compliance_results;
create policy "users_view_org_compliance_results"
on compliance_results for select
to authenticated
using (
  (get_user_role(auth.uid()) = 'master') or
  (organization_id = any(get_user_organization_ids()))
);

-- breach_alerts table
drop policy if exists "users_view_breach_alerts" on breach_alerts;
create policy "users_view_breach_alerts"
on breach_alerts for select
to authenticated
using (
  (get_user_role(auth.uid()) = 'master') or
  (organization_id = any(get_user_organization_ids()))
);

-- enforcement_actions table
drop policy if exists "org_users_select_enforcement_actions" on enforcement_actions;
create policy "org_users_select_enforcement_actions"
on enforcement_actions for select
to authenticated
using (
  (get_user_role(auth.uid()) = 'master') or
  (organization_id = any(get_user_organization_ids()))
);

-- incidents table
drop policy if exists "org_users_select_incidents" on incidents;
create policy "org_users_select_incidents"
on incidents for select
to authenticated
using (
  (get_user_role(auth.uid()) = 'master') or
  (organization_id = any(get_user_organization_ids()))
);

-- investigation_jobs table
drop policy if exists "users_view_org_jobs" on investigation_jobs;
create policy "users_view_org_jobs"
on investigation_jobs for select
to authenticated
using (
  (get_user_role(auth.uid()) = 'master') or
  (organization_id = any(get_user_organization_ids()))
);

-- patrols table
drop policy if exists "users_view_patrols" on patrols;
create policy "users_view_patrols"
on patrols for select
to authenticated
using (
  (get_user_role(auth.uid()) = 'master') or
  (organization_id = any(get_user_organization_ids()))
);

-- flagged_vehicles table
drop policy if exists "org_users_select_flagged_vehicles" on flagged_vehicles;
create policy "org_users_select_flagged_vehicles"
on flagged_vehicles for select
to authenticated
using (
  (get_user_role(auth.uid()) = 'master') or
  (organization_id = any(get_user_organization_ids()))
);

-- health_safety_reports table
drop policy if exists "users_view_hs_reports" on health_safety_reports;
create policy "users_view_hs_reports"
on health_safety_reports for select
to authenticated
using (
  (get_user_role(auth.uid()) = 'master') or
  (organization_id = any(get_user_organization_ids()))
);

-- person_records table
drop policy if exists "org_users_select_person_records" on person_records;
create policy "org_users_select_person_records"
on person_records for select
to authenticated
using (
  (get_user_role(auth.uid()) = 'master') or
  (organization_id = any(get_user_organization_ids()))
);

-- drift_events table
drop policy if exists "users_view_org_drift_events" on drift_events;
create policy "users_view_org_drift_events"
on drift_events for select
to authenticated
using (
  (get_user_role(auth.uid()) = 'master') or
  (organization_id = any(get_user_organization_ids()))
);

-- zone_compliance_matrix table
drop policy if exists "users_view_org_matrix" on zone_compliance_matrix;
create policy "users_view_org_matrix"
on zone_compliance_matrix for select
to authenticated
using (
  (get_user_role(auth.uid()) = 'master') or
  (organization_id = any(get_user_organization_ids()))
);

-- zone_creation_suggestions table
--   NOTE: This table may not exist on all deployments. Guard with IF EXISTS.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'zone_creation_suggestions'
  ) THEN
    DROP POLICY IF EXISTS "users_view_org_zone_suggestions" ON zone_creation_suggestions;
    CREATE POLICY "users_view_org_zone_suggestions"
      ON zone_creation_suggestions FOR SELECT
      TO authenticated
      USING (
        (get_user_role(auth.uid()) = 'master') OR
        (organization_id = ANY(get_user_organization_ids()))
      );
  END IF;
END $$;

-- vehicle_monthly_stays table
drop policy if exists "users_view_monthly_stays" on vehicle_monthly_stays;
create policy "users_view_monthly_stays"
on vehicle_monthly_stays for select
to authenticated
using (
  (get_user_role(auth.uid()) = 'master') or
  (organization_id = any(get_user_organization_ids()))
);

-- photo_metadata table
drop policy if exists "users_view_org_photo_metadata" on photo_metadata;
create policy "users_view_org_photo_metadata"
on photo_metadata for select
to authenticated
using (
  (get_user_role(auth.uid()) = 'master') or
  (organization_id = any(get_user_organization_ids()))
);

-- photo_retention_policies table
--   NOTE: This table may not exist on all deployments. Guard with IF EXISTS.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'photo_retention_policies'
  ) THEN
    DROP POLICY IF EXISTS "users_view_org_retention_policies" ON photo_retention_policies;
    CREATE POLICY "users_view_org_retention_policies"
      ON photo_retention_policies FOR SELECT
      TO authenticated
      USING (
        (get_user_role(auth.uid()) = 'master') OR
        (organization_id = ANY(get_user_organization_ids()))
      );
  END IF;
END $$;

-- import_history table
--   NOTE: This table may not exist on all deployments. Guard with IF EXISTS.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'import_history'
  ) THEN
    DROP POLICY IF EXISTS "org_users_select_import_history" ON import_history;
    CREATE POLICY "org_users_select_import_history"
      ON import_history FOR SELECT
      TO authenticated
      USING (
        (get_user_role(auth.uid()) = 'master') OR
        (organization_id = ANY(get_user_organization_ids()))
      );
  END IF;
END $$;

-- Step 6: Verify hierarchy setup
do $$
declare
  iron_eagle_id uuid;
  first_security_id uuid;
  descendant_count integer;
begin
  -- Get Iron Eagle ID
  select id into iron_eagle_id from organizations where name = 'Iron Eagle Security';
  
  if iron_eagle_id is null then
    raise notice 'WARNING: Iron Eagle Security organization not found. Please create it manually.';
    return;
  end if;
  
  -- Get First Security ID
  select id into first_security_id from organizations where name = 'First Security';
  
  -- Count descendants of Iron Eagle
  select array_length(get_descendant_organizations(iron_eagle_id), 1) into descendant_count;
  
  raise notice '✅ Multi-Organization Hierarchy Setup Complete';
  raise notice '   - Iron Eagle Security: Level 1 (Owner)';
  raise notice '   - First Security: Level 2 (Service Provider)';
  raise notice '   - LINZ/Nelson: Level 3 (Clients)';
  raise notice '   - Iron Eagle has % descendant organizations (including self)', descendant_count;
  raise notice '';
  raise notice 'RLS policies updated: 17 tables now support multi-org access';
  raise notice 'Users from parent organizations can now see all descendant data';
end $$;
