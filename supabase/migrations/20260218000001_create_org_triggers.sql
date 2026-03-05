-- =====================================================
-- Organization Triggers - AUTO VALIDATION
-- =====================================================
-- Migration: 20260218_create_org_triggers.sql
-- Purpose: Auto-calculate organization levels and prevent circular references
-- Status: HIGH PRIORITY - Prevents invalid organization hierarchies

-- =====================================================
-- PREREQUISITE: Ensure get_descendant_organizations exists
-- =====================================================
-- This function should exist from 20260215_multi_organization_hierarchy.sql
-- But we'll verify and create if missing

do $$
begin
  if not exists (
    select 1 from pg_proc where proname = 'get_descendant_organizations'
  ) then
    -- Create the recursive descendant function
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
      select array_agg(id) from org_tree where id is not null;
    $func$;
    
    raise notice '✅ Created get_descendant_organizations function';
  else
    raise notice '✅ get_descendant_organizations function already exists';
  end if;
end $$;

comment on function get_descendant_organizations(uuid) is 
'Returns array of organization ID + all descendant organization IDs (recursive). Used for multi-org access control.';

-- =====================================================
-- FUNCTION 1: Auto-Calculate Organization Level
-- =====================================================
-- Automatically sets organization_level based on parent depth
-- Level 1 = Root (no parent)
-- Level 2 = Direct child of root
-- Level 3+ = Nested children

create or replace function auto_calculate_org_level()
returns trigger
language plpgsql
as $$
begin
  -- If no parent, this is a root organization (level 1)
  if new.parent_organization_id is null then
    new.organization_level := 1;
  else
    -- Calculate level as parent's level + 1
    select organization_level + 1 
    into new.organization_level
    from organizations 
    where id = new.parent_organization_id;
    
    -- If parent not found, default to level 1
    if new.organization_level is null then
      new.organization_level := 1;
    end if;
  end if;
  
  return new;
end;
$$;

comment on function auto_calculate_org_level() is 
'Automatically calculates organization_level based on parent hierarchy depth. Triggered before INSERT or UPDATE.';

-- =====================================================
-- FUNCTION 2: Prevent Circular References
-- =====================================================
-- Blocks creation of circular parent-child loops
-- Example: A → B → C → A (invalid)

create or replace function prevent_circular_org_reference()
returns trigger
language plpgsql
as $$
declare
  descendant_ids uuid[];
begin
  -- Skip check if no parent
  if new.parent_organization_id is null then
    return new;
  end if;
  
  -- Check 1: Organization cannot be its own parent
  if new.id = new.parent_organization_id then
    raise exception 'Organization cannot be its own parent';
  end if;
  
  -- Check 2: Check if creating a loop (new org is in parent's ancestor chain)
  -- Get all descendants of the proposed parent
  descendant_ids := get_descendant_organizations(new.parent_organization_id);
  
  -- If descendant_ids is not null and contains the current org, it's a loop
  if descendant_ids is not null and new.id = any(descendant_ids) then
    raise exception 'Circular reference detected: Organization "%" cannot be a child of "%" because it would create a loop',
      new.name,
      (select name from organizations where id = new.parent_organization_id);
  end if;
  
  return new;
end;
$$;

comment on function prevent_circular_org_reference() is 
'Prevents circular parent-child references in organization hierarchy. Triggered before INSERT or UPDATE.';

-- =====================================================
-- TRIGGER 1: Auto-Calculate Level
-- =====================================================

drop trigger if exists trigger_auto_calculate_org_level on organizations;

create trigger trigger_auto_calculate_org_level
  before insert or update of parent_organization_id
  on organizations
  for each row
  execute function auto_calculate_org_level();

comment on trigger trigger_auto_calculate_org_level on organizations is 
'Automatically calculates organization_level when parent_organization_id changes';

-- =====================================================
-- TRIGGER 2: Prevent Circular References
-- =====================================================

drop trigger if exists trigger_prevent_circular_org_reference on organizations;

create trigger trigger_prevent_circular_org_reference
  before insert or update of parent_organization_id
  on organizations
  for each row
  execute function prevent_circular_org_reference();

comment on trigger trigger_prevent_circular_org_reference on organizations is 
'Blocks circular parent-child references in organization hierarchy';

-- =====================================================
-- BACKFILL: Recalculate All Organization Levels
-- =====================================================
-- Ensure all existing organizations have correct levels
-- IMPORTANT: Temporarily disable circular check trigger for backfill

do $$
declare
  org_record record;
  updated_count integer := 0;
begin
  raise notice '';
  raise notice '========================================';
  raise notice 'Recalculating Organization Levels';
  raise notice '========================================';
  
  -- Temporarily disable the circular check trigger for backfill
  alter table organizations disable trigger trigger_prevent_circular_org_reference;
  
  -- Process in order: roots first, then children
  for org_record in 
    select id, name, parent_organization_id
    from organizations
    order by 
      case when parent_organization_id is null then 1 else 2 end,
      created_at
  loop
    -- Update will trigger auto_calculate_org_level
    update organizations
    set parent_organization_id = parent_organization_id -- Dummy update to trigger
    where id = org_record.id;
    
    updated_count := updated_count + 1;
  end loop;
  
  -- Re-enable the circular check trigger
  alter table organizations enable trigger trigger_prevent_circular_org_reference;
  
  raise notice '✅ Recalculated levels for % organizations', updated_count;
  
  -- Display hierarchy
  raise notice '';
  raise notice 'Organization Hierarchy:';
  for org_record in
    select 
      name,
      organization_level,
      (select name from organizations p where p.id = o.parent_organization_id) as parent_name
    from organizations o
    order by organization_level, name
  loop
    if org_record.parent_name is not null then
      raise notice '  Level %: % (parent: %)', 
        org_record.organization_level, 
        org_record.name,
        org_record.parent_name;
    else
      raise notice '  Level %: % (ROOT)', 
        org_record.organization_level, 
        org_record.name;
    end if;
  end loop;
  
  raise notice '';
  raise notice '========================================';
  raise notice '✅ ORGANIZATION TRIGGERS ACTIVE';
  raise notice '========================================';
  
end $$;

-- =====================================================
-- VERIFICATION TEST
-- =====================================================

do $$
declare
  test_org_id uuid;
  test_org_name text;
begin
  raise notice '';
  raise notice 'Testing Circular Reference Prevention...';
  
  -- Get any existing organization for testing
  select id, name into test_org_id, test_org_name
  from organizations
  limit 1;
  
  if test_org_id is null then
    raise notice 'ℹ️ No organizations found for testing - skipping circular reference test';
    return;
  end if;
  
  -- This should fail (organization cannot be its own parent)
  begin
    update organizations
    set parent_organization_id = id
    where id = test_org_id;
    
    raise exception 'TEST FAILED: Circular reference was allowed!';
  exception
    when others then
      if sqlerrm like '%cannot be its own parent%' then
        raise notice '✅ Test passed: Self-reference blocked for org "%"', test_org_name;
      else
        raise notice '⚠️ Test failed with unexpected error: %', sqlerrm;
      end if;
  end;
  
  raise notice '';
end $$;
