-- Fix grand_master organization scope so platform owners can access and assign
-- users across all organizations, as required by the instruction manual.

create or replace function public.get_user_organization_ids()
returns uuid[] as $$
declare
  user_role text;
  user_org_id uuid;
  descendant_ids uuid[];
begin
  user_role := public.get_user_role(auth.uid());

  if user_role = 'grand_master' then
    return coalesce(
      (select array_agg(id order by id) from public.organizations),
      array[]::uuid[]
    );
  end if;

  select organization_id into user_org_id
  from public.user_profiles
  where id = auth.uid();

  if user_org_id is null then
    return array[]::uuid[];
  end if;

  descendant_ids := public.get_descendant_organizations(user_org_id);
  return coalesce(descendant_ids, array[user_org_id]::uuid[]);
end;
$$ language plpgsql stable security definer;

comment on function public.get_user_organization_ids() is
'Returns the caller org scope for RLS. grand_master receives all organization ids; all other roles receive their primary org plus descendants.';

notify pgrst, 'reload schema';