create or replace function public.reset_operational_data_preserving_bob(
  p_actor_id uuid,
  p_actor_email text,
  p_confirmation text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  owner_email constant text := 'squires.don@live.com';
  required_confirmation constant text := 'RESET NON-BOB OPERATIONAL DATA';
  v_actor_role text;
  v_deleted_profiles integer := 0;
  v_deleted_organizations integer := 0;
  v_deleted_rows bigint := 0;
  v_row_count bigint := 0;
  r record;
begin
  if coalesce(trim(p_confirmation), '') <> required_confirmation then
    raise exception 'Confirmation text mismatch';
  end if;

  select up.role
  into v_actor_role
  from public.user_profiles up
  where up.id = p_actor_id
    and lower(up.email) = lower(owner_email)
    and lower(up.email) = lower(coalesce(trim(p_actor_email), ''))
  limit 1;

  if v_actor_role is distinct from 'grand_master' then
    raise exception 'Only the Bob owner grand_master account can run this reset';
  end if;

  create temp table preserve_org_ids (
    id uuid primary key
  ) on commit drop;

  create temp table deleted_user_accounts (
    id uuid primary key,
    email text not null
  ) on commit drop;

  insert into preserve_org_ids (id)
  select distinct org_id
  from (
    select up.organization_id as org_id
    from public.user_profiles up
    where up.id = p_actor_id

    union all

    select up.employer_organization_id as org_id
    from public.user_profiles up
    where up.id = p_actor_id

    union all

    select case
      when value ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        then value::uuid
      else null
    end as org_id
    from public.user_profiles up
    cross join lateral unnest(coalesce(up.extra_organization_ids, array[]::text[])) as value
    where up.id = p_actor_id
  ) preserved
  where org_id is not null
  on conflict do nothing;

  for r in
    select c.table_name, c.column_name
    from information_schema.columns c
    where c.table_schema = 'public'
      and c.table_name like 'bob\_%' escape '\'
      and c.column_name in ('organization_id', 'org_id')
      and c.udt_name = 'uuid'
  loop
    execute format(
      'insert into preserve_org_ids (id)
       select distinct %1$I
       from public.%2$I
       where %1$I is not null
       on conflict do nothing',
      r.column_name,
      r.table_name
    );
  end loop;

  insert into deleted_user_accounts (id, email)
  select up.id, up.email
  from public.user_profiles up
  where up.id <> p_actor_id
    and lower(up.email) <> lower(owner_email)
  on conflict (id) do nothing;

  for r in
    select c.table_name, c.column_name
    from information_schema.columns c
    where c.table_schema = 'public'
      and c.column_name in ('organization_id', 'org_id')
      and c.table_name not like 'bob\_%' escape '\'
      and c.table_name not in ('organizations', 'user_profiles')
  loop
    execute format('delete from public.%I where %I is not null', r.table_name, r.column_name);
    get diagnostics v_row_count = row_count;
    v_deleted_rows := v_deleted_rows + v_row_count;
  end loop;

  for r in
    select c.table_name, c.column_name
    from information_schema.columns c
    where c.table_schema = 'public'
      and c.column_name in ('zone_id', 'observation_id')
      and c.table_name not like 'bob\_%' escape '\'
      and c.table_name not in ('organizations', 'user_profiles')
  loop
    execute format('delete from public.%I where %I is not null', r.table_name, r.column_name);
    get diagnostics v_row_count = row_count;
    v_deleted_rows := v_deleted_rows + v_row_count;
  end loop;

  for r in
    select c.table_name, c.column_name
    from information_schema.columns c
    where c.table_schema = 'public'
      and c.column_name in (
        'user_id',
        'actor_id',
        'performed_by',
        'deleted_by',
        'recorded_by',
        'assigned_to',
        'assigned_by',
        'notified_by',
        'admin_reviewed_by',
        'acknowledged_by',
        'scanned_by',
        'triggered_by',
        'approver_id',
        'requested_by',
        'created_by',
        'officer_id'
      )
      and c.table_name not like 'bob\_%' escape '\'
      and c.table_name not in ('organizations', 'user_profiles')
  loop
    execute format('delete from public.%I where %I is not null', r.table_name, r.column_name);
    get diagnostics v_row_count = row_count;
    v_deleted_rows := v_deleted_rows + v_row_count;
  end loop;

  update public.organizations
  set parent_organization_id = null
  where parent_organization_id is not null
    and parent_organization_id not in (select id from preserve_org_ids);

  delete from public.user_profiles up
  where up.id in (select dua.id from deleted_user_accounts dua);
  get diagnostics v_deleted_profiles = row_count;

  delete from public.organizations o
  where o.id not in (select id from preserve_org_ids);
  get diagnostics v_deleted_organizations = row_count;

  return jsonb_build_object(
    'ok', true,
    'confirmation', required_confirmation,
    'deleted_profiles', v_deleted_profiles,
    'deleted_organizations', v_deleted_organizations,
    'deleted_rows', v_deleted_rows,
    'preserved_organization_ids', (
      select coalesce(jsonb_agg(id order by id), '[]'::jsonb)
      from preserve_org_ids
    ),
    'affected_auth_users', (
      select coalesce(
        jsonb_agg(
          jsonb_build_object('id', dua.id, 'email', dua.email)
          order by lower(dua.email), dua.id
        ),
        '[]'::jsonb
      )
      from deleted_user_accounts dua
    )
  );
end;
$$;

revoke all on function public.reset_operational_data_preserving_bob(uuid, text, text) from public;
grant execute on function public.reset_operational_data_preserving_bob(uuid, text, text) to service_role;
