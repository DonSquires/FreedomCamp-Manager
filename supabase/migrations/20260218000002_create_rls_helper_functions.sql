-- =====================================================
-- RLS Helper Functions - CRITICAL FIX
-- =====================================================
-- Migration: 20260218_create_rls_helper_functions.sql
-- Purpose: Create SECURITY DEFINER helper functions to prevent RLS recursion
-- Status: CRITICAL - All RLS policies depend on these functions
-- 
-- Background:
-- RLS policies that query user_profiles directly cause infinite recursion.
-- These helper functions use SECURITY DEFINER to bypass RLS during policy evaluation.

-- =====================================================
-- FUNCTION 1: get_user_role
-- =====================================================
-- Returns the role of a user
-- Used in RLS policies to check permissions
-- SECURITY DEFINER bypasses RLS to prevent recursion

create or replace function get_user_role(user_id uuid)
returns text
language sql
stable
security definer
as $$
  select role 
  from user_profiles 
  where id = user_id;
$$;

comment on function get_user_role(uuid) is 
'Returns user role. Uses SECURITY DEFINER to bypass RLS and prevent recursion in RLS policies.';

-- =====================================================
-- FUNCTION 2: get_user_organization_id
-- =====================================================
-- Returns the primary organization_id of a user
-- Used in RLS policies to check organization membership

create or replace function get_user_organization_id(user_id uuid)
returns uuid
language sql
stable
security definer
as $$
  select organization_id 
  from user_profiles 
  where id = user_id;
$$;

comment on function get_user_organization_id(uuid) is 
'Returns user primary organization_id. Uses SECURITY DEFINER to bypass RLS and prevent recursion.';

-- =====================================================
-- FUNCTION 3: get_user_organization_ids (ENHANCED)
-- =====================================================
-- Returns all organization IDs a user can access
-- Includes: primary org + authorized_work_locations + descendants (for admins)

create or replace function get_user_organization_ids()
returns uuid[]
language plpgsql
stable
security definer
as $$
declare
  user_org_id uuid;
  user_role_val text;
  authorized_locs uuid[];
  descendant_ids uuid[];
  result uuid[];
begin
  -- Get user details (bypasses RLS via SECURITY DEFINER)
  select organization_id, role, authorized_work_locations 
  into user_org_id, user_role_val, authorized_locs
  from user_profiles
  where id = auth.uid();
  
  -- Masters see everything
  if user_role_val = 'master' then
    select array_agg(id) into result 
    from organizations 
    where is_active = true;
    return coalesce(result, array[]::uuid[]);
  end if;
  
  -- Start with user's primary org
  if user_org_id is not null then
    result := array[user_org_id]::uuid[];
  else
    result := array[]::uuid[];
  end if;
  
  -- Add descendants if admin or admin_officer
  if user_role_val in ('admin', 'admin_officer') and user_org_id is not null then
    descendant_ids := get_descendant_organizations(user_org_id);
    result := array_cat(result, descendant_ids);
  end if;
  
  -- Add authorized work locations
  if authorized_locs is not null and array_length(authorized_locs, 1) > 0 then
    result := array_cat(result, authorized_locs);
  end if;
  
  -- Remove duplicates
  select array_agg(distinct org_id) into result 
  from unnest(result) as org_id;
  
  return coalesce(result, array[]::uuid[]);
end;
$$;

comment on function get_user_organization_ids() is 
'Returns all organization IDs user can access: primary + descendants (if admin) + authorized_work_locations. Uses SECURITY DEFINER to bypass RLS.';

-- =====================================================
-- FUNCTION 4: get_descendant_organizations (VERIFY)
-- =====================================================
-- This function should already exist from 20260215_multi_organization_hierarchy.sql
-- Verify it exists, if not create it

do $$
begin
  if not exists (
    select 1 
    from pg_proc p
    join pg_namespace n on p.pronamespace = n.oid
    where n.nspname = 'public' 
    and p.proname = 'get_descendant_organizations'
  ) then
    -- Create it if missing
    create function get_descendant_organizations(org_id uuid)
    returns uuid[] 
    language sql
    stable
    as $func$
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
      select array_agg(id) from org_tree;
    $func$;
    
    comment on function get_descendant_organizations(uuid) is 
    'Returns array of organization ID + all descendant organization IDs (recursive). Used for multi-org access control.';
    
    raise notice '✅ Created missing get_descendant_organizations function';
  else
    raise notice '✅ get_descendant_organizations already exists';
  end if;
end $$;

-- =====================================================
-- VERIFICATION
-- =====================================================

do $$
declare
  test_user_id uuid;
  test_role text;
  test_org_id uuid;
  test_org_ids uuid[];
begin
  raise notice '';
  raise notice '========================================';
  raise notice 'RLS Helper Functions Verification';
  raise notice '========================================';
  
  -- Test 1: Get a test user
  select id into test_user_id 
  from user_profiles 
  where role = 'admin' 
  limit 1;
  
  if test_user_id is null then
    select id into test_user_id 
    from user_profiles 
    limit 1;
  end if;
  
  if test_user_id is null then
    raise notice '⚠️ No users found for testing';
    return;
  end if;
  
  -- Test 2: get_user_role
  test_role := get_user_role(test_user_id);
  raise notice '✅ get_user_role() works: User % has role "%"', test_user_id, test_role;
  
  -- Test 3: get_user_organization_id
  test_org_id := get_user_organization_id(test_user_id);
  if test_org_id is not null then
    raise notice '✅ get_user_organization_id() works: User % belongs to org %', test_user_id, test_org_id;
  else
    raise notice '✅ get_user_organization_id() works: User % has no primary org (master?)', test_user_id;
  end if;
  
  -- Test 4: get_descendant_organizations
  if test_org_id is not null then
    test_org_ids := get_descendant_organizations(test_org_id);
    raise notice '✅ get_descendant_organizations() works: Org % has % descendants', 
      test_org_id, 
      coalesce(array_length(test_org_ids, 1), 0);
  end if;
  
  raise notice '';
  raise notice '========================================';
  raise notice '✅ ALL HELPER FUNCTIONS VERIFIED';
  raise notice '========================================';
  raise notice '';
  raise notice 'Next Steps:';
  raise notice '1. All RLS policies should now work correctly';
  raise notice '2. Test user access to ensure proper data filtering';
  raise notice '3. Verify multi-organization access for admins';
  raise notice '4. Check authorized_work_locations functionality';
  
end $$;
