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
    and lower(up.email) = lower(coalesce(trim(p_actor_email), ''))
  limit 1;

  if v_actor_role is distinct from 'grand_master' then
    raise exception 'Only a verified grand_master account can run this reset';
  end if;

  create temp table preserve_org_ids (
    id uuid primary key
  ) on commit drop;

  create temp table delete_org_ids (
    id uuid primary key
  ) on commit drop;

  create temp table delete_zone_ids (
    id uuid primary key
  ) on commit drop;

  create temp table delete_observation_ids_text (
    id text primary key
  ) on commit drop;

  create temp table delete_observation_ids_uuid (
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
      when pg_input_is_valid(value, 'uuid'::regtype)
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

  insert into delete_org_ids (id)
  select o.id
  from public.organizations o
  where o.id not in (select id from preserve_org_ids)
  on conflict do nothing;

  insert into delete_zone_ids (id)
  select z.id
  from public.zones z
  where z.organization_id in (select id from delete_org_ids)
  on conflict do nothing;

  insert into delete_observation_ids_text (id)
  select o.observation_id
  from public.observations o
  where o.organization_id in (select id from delete_org_ids)
  on conflict do nothing;

  insert into delete_observation_ids_uuid (id)
  select o.id
  from public.observations o
  where o.organization_id in (select id from delete_org_ids)
    and o.id is not null
  on conflict do nothing;

  insert into deleted_user_accounts (id, email)
  select up.id, up.email
  from public.user_profiles up
  where up.id <> p_actor_id
    and not exists (
      select 1
      from preserve_org_ids p
      where p.id = up.organization_id
         or p.id = up.employer_organization_id
    )
    and not exists (
      select 1
      from unnest(coalesce(up.extra_organization_ids, array[]::text[])) as value
      join preserve_org_ids p
        on pg_input_is_valid(value, 'uuid'::regtype)
       and p.id = value::uuid
    )
  on conflict (id) do nothing;

  for r in
    select c.table_name, c.column_name
    from information_schema.columns c
    where c.table_schema = 'public'
      and c.column_name in ('organization_id', 'org_id')
      and c.table_name not like 'bob\_%' escape '\'
      and c.table_name not in ('organizations', 'user_profiles')
  loop
    execute format(
      'delete from public.%I where %I in (select id from delete_org_ids)',
      r.table_name,
      r.column_name
    );
    get diagnostics v_row_count = row_count;
    v_deleted_rows := v_deleted_rows + v_row_count;
  end loop;

  for r in
    select c.table_name, c.column_name, c.udt_name
    from information_schema.columns c
    where c.table_schema = 'public'
      and c.column_name in ('zone_id', 'observation_id')
      and c.table_name not like 'bob\_%' escape '\'
      and c.table_name not in ('organizations', 'user_profiles')
  loop
    if r.column_name = 'zone_id' then
      execute format(
        'delete from public.%I where %I in (select id from delete_zone_ids)',
        r.table_name,
        r.column_name
      );
    elsif r.udt_name = 'uuid' then
      execute format(
        'delete from public.%I where %I in (select id from delete_observation_ids_uuid)',
        r.table_name,
        r.column_name
      );
    else
      execute format(
        'delete from public.%I where %I in (select id from delete_observation_ids_text)',
        r.table_name,
        r.column_name
      );
    end if;
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
    execute format(
      'delete from public.%I where %I in (select id from deleted_user_accounts)',
      r.table_name,
      r.column_name
    );
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
