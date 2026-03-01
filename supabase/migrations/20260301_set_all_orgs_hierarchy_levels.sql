-- Set all organizations to correct hierarchy levels
-- Iron Eagle Security = Level 1 (owner)
-- First Security = Level 2 (service_provider)
-- All other organizations = Level 3 (client)

-- Step 1: Default ALL organizations to Level 3 (client)
update organizations
set organization_type = 'client',
    organization_level = 3
where name not in ('Iron Eagle Security', 'First Security');

-- Step 2: Set First Security as Level 2 (service_provider)
update organizations
set organization_type = 'service_provider',
    organization_level = 2,
    parent_organization_id = (select id from organizations where name = 'Iron Eagle Security' limit 1)
where name = 'First Security';

-- Step 3: Set Iron Eagle Security as Level 1 (owner)
update organizations
set organization_type = 'owner',
    organization_level = 1,
    parent_organization_id = null
where name = 'Iron Eagle Security';

-- Step 4: Set parent_organization_id for all level-3 clients to First Security
update organizations
set parent_organization_id = (select id from organizations where name = 'First Security' limit 1)
where organization_level = 3
  and (parent_organization_id is null or parent_organization_id != (select id from organizations where name = 'First Security' limit 1));
