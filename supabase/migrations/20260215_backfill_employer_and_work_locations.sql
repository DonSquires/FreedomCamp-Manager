-- =====================================================
-- Backfill Employer Organization ID and Authorized Work Locations
-- =====================================================
-- Migration: 20260215_backfill_employer_and_work_locations.sql
-- Purpose: Set employer_organization_id and authorized_work_locations for existing users
-- Status: Safe to run multiple times (idempotent)

-- Step 1: Create temporary function to get all organization IDs as array
create or replace function get_all_organization_ids()
returns uuid[]
language sql
stable
as $$
  select array_agg(id) from organizations where is_active = true;
$$;

-- Step 2: Create temporary function to get descendant organization IDs
create or replace function get_org_descendants(org_id uuid)
returns uuid[]
language sql
stable
as $$
  with recursive descendants as (
    -- Start with the organization itself
    select id, parent_organization_id
    from organizations
    where id = org_id
    
    union all
    
    -- Recursively find all children
    select o.id, o.parent_organization_id
    from organizations o
    inner join descendants d on o.parent_organization_id = d.id
  )
  select array_agg(id) from descendants;
$$;

-- =====================================================
-- BACKFILL LOGIC
-- =====================================================

do $$
declare
  iron_eagle_id uuid;
  first_security_id uuid;
  nelson_id uuid;
  linz_id uuid;
  tasman_id uuid;
  
  iron_eagle_descendants uuid[];
  first_security_descendants uuid[];
  
  users_updated integer := 0;
  total_users integer;
begin
  raise notice '========================================';
  raise notice 'Starting Employer + Work Locations Backfill';
  raise notice '========================================';
  
  -- Get total users count
  select count(*) into total_users from user_profiles;
  raise notice 'Total users in system: %', total_users;
  
  -- Step 1: Find organization IDs by name (case-insensitive, partial match)
  raise notice '';
  raise notice 'Step 1: Finding organization IDs...';
  
  select id into iron_eagle_id 
  from organizations 
  where lower(name) like '%iron eagle%' 
  limit 1;
  
  select id into first_security_id 
  from organizations 
  where lower(name) like '%first security%' 
  limit 1;
  
  select id into nelson_id 
  from organizations 
  where lower(name) like '%nelson%' and lower(name) like '%council%'
  limit 1;
  
  select id into linz_id 
  from organizations 
  where lower(name) = 'linz'
  limit 1;
  
  select id into tasman_id 
  from organizations 
  where lower(name) like '%tasman%' 
  limit 1;
  
  -- Log found organizations
  if iron_eagle_id is not null then
    raise notice '✅ Found Iron Eagle: %', iron_eagle_id;
  else
    raise notice '⚠️ Iron Eagle organization not found';
  end if;
  
  if first_security_id is not null then
    raise notice '✅ Found First Security: %', first_security_id;
  else
    raise notice '⚠️ First Security organization not found';
  end if;
  
  if nelson_id is not null then
    raise notice '✅ Found Nelson City Council: %', nelson_id;
  else
    raise notice '⚠️ Nelson City Council organization not found';
  end if;
  
  if linz_id is not null then
    raise notice '✅ Found LINZ: %', linz_id;
  else
    raise notice 'ℹ️ LINZ organization not found (may not exist yet)';
  end if;
  
  if tasman_id is not null then
    raise notice '✅ Found Tasman District Council: %', tasman_id;
  else
    raise notice 'ℹ️ Tasman District Council organization not found (may not exist yet)';
  end if;
  
  -- Step 2: Get descendant organizations for each parent
  raise notice '';
  raise notice 'Step 2: Computing descendant organizations...';
  
  if iron_eagle_id is not null then
    iron_eagle_descendants := get_org_descendants(iron_eagle_id);
    raise notice 'Iron Eagle + descendants: % organizations', array_length(iron_eagle_descendants, 1);
  end if;
  
  if first_security_id is not null then
    first_security_descendants := get_org_descendants(first_security_id);
    raise notice 'First Security + descendants: % organizations', array_length(first_security_descendants, 1);
  end if;
  
  -- =====================================================
  -- BACKFILL 1: IRON EAGLE USERS (Master/Admin)
  -- =====================================================
  raise notice '';
  raise notice '========================================';
  raise notice 'BACKFILL 1: Iron Eagle Users';
  raise notice '========================================';
  
  if iron_eagle_id is not null then
    update user_profiles
    set 
      employer_organization_id = iron_eagle_id,
      authorized_work_locations = get_all_organization_ids(), -- 100% visibility
      updated_at = now()
    where organization_id = iron_eagle_id
      and employer_organization_id is null;
    
    get diagnostics users_updated = row_count;
    raise notice '✅ Updated % Iron Eagle users with full access', users_updated;
  else
    raise notice '⚠️ Skipping Iron Eagle users (org not found)';
  end if;
  
  -- =====================================================
  -- BACKFILL 2: FIRST SECURITY USERS
  -- =====================================================
  raise notice '';
  raise notice '========================================';
  raise notice 'BACKFILL 2: First Security Users';
  raise notice '========================================';
  
  if first_security_id is not null then
    update user_profiles
    set 
      employer_organization_id = first_security_id,
      authorized_work_locations = first_security_descendants, -- First Security + descendants
      updated_at = now()
    where organization_id = first_security_id
      and employer_organization_id is null;
    
    get diagnostics users_updated = row_count;
    raise notice '✅ Updated % First Security users with access to % organizations', 
      users_updated, 
      array_length(first_security_descendants, 1);
  else
    raise notice '⚠️ Skipping First Security users (org not found)';
  end if;
  
  -- =====================================================
  -- BACKFILL 3: NELSON CITY COUNCIL USERS
  -- =====================================================
  raise notice '';
  raise notice '========================================';
  raise notice 'BACKFILL 3: Nelson City Council Users';
  raise notice '========================================';
  
  if nelson_id is not null then
    update user_profiles
    set 
      employer_organization_id = nelson_id,
      authorized_work_locations = array[nelson_id]::uuid[], -- Nelson only
      updated_at = now()
    where organization_id = nelson_id
      and employer_organization_id is null;
    
    get diagnostics users_updated = row_count;
    raise notice '✅ Updated % Nelson users with Nelson-only access', users_updated;
  else
    raise notice '⚠️ Skipping Nelson users (org not found)';
  end if;
  
  -- =====================================================
  -- BACKFILL 4: LINZ USERS (if any exist)
  -- =====================================================
  raise notice '';
  raise notice '========================================';
  raise notice 'BACKFILL 4: LINZ Users';
  raise notice '========================================';
  
  if linz_id is not null then
    update user_profiles
    set 
      employer_organization_id = linz_id,
      authorized_work_locations = array[linz_id]::uuid[], -- LINZ only
      updated_at = now()
    where organization_id = linz_id
      and employer_organization_id is null;
    
    get diagnostics users_updated = row_count;
    raise notice '✅ Updated % LINZ users with LINZ-only access', users_updated;
  else
    raise notice 'ℹ️ Skipping LINZ users (org not found - expected)';
  end if;
  
  -- =====================================================
  -- BACKFILL 5: TASMAN DISTRICT COUNCIL USERS (if any exist)
  -- =====================================================
  raise notice '';
  raise notice '========================================';
  raise notice 'BACKFILL 5: Tasman District Council Users';
  raise notice '========================================';
  
  if tasman_id is not null then
    update user_profiles
    set 
      employer_organization_id = tasman_id,
      authorized_work_locations = array[tasman_id]::uuid[], -- Tasman only
      updated_at = now()
    where organization_id = tasman_id
      and employer_organization_id is null;
    
    get diagnostics users_updated = row_count;
    raise notice '✅ Updated % Tasman users with Tasman-only access', users_updated;
  else
    raise notice 'ℹ️ Skipping Tasman users (org not found - expected)';
  end if;
  
  -- =====================================================
  -- BACKFILL 6: USERS WITH NO ORGANIZATION (Generic/Orphaned)
  -- =====================================================
  raise notice '';
  raise notice '========================================';
  raise notice 'BACKFILL 6: Users With No Organization';
  raise notice '========================================';
  
  -- For users with no organization_id, leave employer_organization_id null
  -- and authorized_work_locations empty (they'll need manual assignment)
  select count(*) into users_updated
  from user_profiles
  where organization_id is null
    and employer_organization_id is null;
  
  if users_updated > 0 then
    raise notice '⚠️ Found % users with no organization - these need manual assignment', users_updated;
    raise notice '   These users will have restricted access until manually configured.';
  else
    raise notice '✅ No orphaned users found';
  end if;
  
  -- =====================================================
  -- SUMMARY
  -- =====================================================
  raise notice '';
  raise notice '========================================';
  raise notice 'BACKFILL SUMMARY';
  raise notice '========================================';
  
  select 
    count(*) filter (where employer_organization_id is not null) as configured,
    count(*) filter (where employer_organization_id is null) as unconfigured,
    count(*) as total
  into 
    users_updated, 
    total_users, 
    total_users
  from user_profiles;
  
  raise notice 'Users with employer configured: % / %', users_updated, total_users;
  raise notice 'Users needing manual config: %', total_users - users_updated;
  
  -- Show breakdown by organization
  raise notice '';
  raise notice 'Breakdown by Employer Organization:';
  
  for users_updated, iron_eagle_id in 
    select count(*), employer_organization_id::text
    from user_profiles
    where employer_organization_id is not null
    group by employer_organization_id
  loop
    raise notice '  % users: %', users_updated, 
      coalesce((select name from organizations where id::text = iron_eagle_id), 'Unknown');
  end loop;
  
  raise notice '';
  raise notice '========================================';
  raise notice '✅ Backfill Complete!';
  raise notice '========================================';
  
end $$;

-- =====================================================
-- CLEANUP: Drop temporary functions
-- =====================================================
drop function if exists get_all_organization_ids();
drop function if exists get_org_descendants(uuid);

-- =====================================================
-- VERIFICATION QUERY (run separately to check results)
-- =====================================================
comment on table user_profiles is 'User profiles with employer and authorized work locations. Run this query to verify backfill:

SELECT 
  u.email,
  u.role,
  u.first_name || '' '' || u.last_name as name,
  emp.name as employer,
  array_agg(distinct work.name) as authorized_work_locations
FROM user_profiles u
LEFT JOIN organizations emp ON emp.id = u.employer_organization_id
LEFT JOIN organizations work ON work.id = ANY(u.authorized_work_locations)
GROUP BY u.id, u.email, u.role, u.first_name, u.last_name, emp.name
ORDER BY emp.name, u.role, u.email;
';
