-- Set all organizations to correct hierarchy levels
-- Iron Eagle Security = Level 1 (owner)
-- First Security = Level 2 (service_provider)
-- All other organizations = Level 3 (client)

do $$
declare
  iron_eagle_id uuid;
  first_security_id uuid;
begin
  -- Look up IDs once
  select id into iron_eagle_id from organizations where name = 'Iron Eagle Security' limit 1;
  select id into first_security_id from organizations where name = 'First Security' limit 1;

  -- Step 1: Default ALL organizations to Level 3 (client)
  update organizations
  set organization_type = 'client',
      organization_level = 3
  where name not in ('Iron Eagle Security', 'First Security');

  -- Step 2: Set First Security as Level 2 (service_provider)
  if first_security_id is not null then
    update organizations
    set organization_type = 'service_provider',
        organization_level = 2,
        parent_organization_id = iron_eagle_id
    where id = first_security_id;
  end if;

  -- Step 3: Set Iron Eagle Security as Level 1 (owner)
  if iron_eagle_id is not null then
    update organizations
    set organization_type = 'owner',
        organization_level = 1,
        parent_organization_id = null
    where id = iron_eagle_id;
  end if;

  -- Step 4: Set parent_organization_id for all level-3 clients to First Security
  if first_security_id is not null then
    update organizations
    set parent_organization_id = first_security_id
    where organization_level = 3
      and (parent_organization_id is null or parent_organization_id != first_security_id);
  end if;
end $$;
