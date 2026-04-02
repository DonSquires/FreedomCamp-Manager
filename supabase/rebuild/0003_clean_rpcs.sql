-- FreedomCamp Manager clean rebuild RPCs
-- Date: 2026-04-01
-- Depends on: 0001_clean_baseline.sql, 0002_clean_rls.sql

-- -----------------------------------------------------------------------------
-- Utility: NZ working-day due date helper (20 working days default)
-- -----------------------------------------------------------------------------
create or replace function public.calculate_nz_working_day_due_date(
  received_at timestamptz,
  working_days_target integer default 20
)
returns date
language plpgsql
as $$
declare
  working_days integer := 0;
  due_date date := received_at::date;
begin
  if working_days_target < 1 then
    return due_date;
  end if;

  while working_days < working_days_target loop
    due_date := due_date + 1;

    -- Mon-Fri only; public holidays can be layered in a future migration.
    if extract(isodow from due_date) between 1 and 5 then
      working_days := working_days + 1;
    end if;
  end loop;

  return due_date;
end;
$$;

-- -----------------------------------------------------------------------------
-- Compliance snapshot RPC for a single observation context
-- -----------------------------------------------------------------------------
create or replace function public.calculate_vehicle_compliance_clean(
  p_plate_number text,
  p_zone_id uuid,
  p_observation_time timestamptz
)
returns table (
  is_compliant boolean,
  breach_type text,
  breach_reason text,
  nights_stayed integer,
  consecutive_nights integer,
  matrix_snapshot jsonb
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_month_start date := date_trunc('month', p_observation_time)::date;
  v_month_end date := (date_trunc('month', p_observation_time) + interval '1 month')::date;
  v_today date := p_observation_time::date;
  v_max_nights integer := 3;
  v_max_consecutive integer := 1;
  v_requires_sc boolean := false;
  v_zone_matrix jsonb := '{}'::jsonb;
  v_nights_stayed integer := 0;
  v_consecutive integer := 0;
  v_is_self_contained boolean := false;
  v_breach_type text := null;
  v_breach_reason text := null;
  v_is_compliant boolean := true;
begin
  select
    zcm.max_nights_per_month,
    zcm.max_consecutive_nights,
    zcm.requires_self_contained,
    jsonb_build_object(
      'max_nights_per_month', zcm.max_nights_per_month,
      'max_consecutive_nights', zcm.max_consecutive_nights,
      'requires_self_contained', zcm.requires_self_contained,
      'after_hours_prohibited', zcm.after_hours_prohibited,
      'effective_from', zcm.effective_from,
      'effective_to', zcm.effective_to
    )
  into
    v_max_nights,
    v_max_consecutive,
    v_requires_sc,
    v_zone_matrix
  from public.zone_compliance_matrix zcm
  where zcm.zone_id = p_zone_id
    and zcm.effective_from <= v_today
    and (zcm.effective_to is null or zcm.effective_to >= v_today)
  order by zcm.effective_from desc
  limit 1;

  select count(*)::int
  into v_nights_stayed
  from public.observations o
  where o.zone_id = p_zone_id
    and o.plate_number = p_plate_number
    and o.recorded_at::date >= v_month_start
    and o.recorded_at::date < v_month_end
    and o.recorded_at::date <= v_today;

  with daily as (
    select distinct o.recorded_at::date as d
    from public.observations o
    where o.zone_id = p_zone_id
      and o.plate_number = p_plate_number
      and o.recorded_at::date <= v_today
  ), streak as (
    select d,
      d - (row_number() over (order by d))::int as grp
    from daily
  )
  select coalesce(max(streak_len), 0)
  into v_consecutive
  from (
    select grp, count(*)::int as streak_len
    from streak
    group by grp
  ) s;

  select coalesce(cs.is_self_contained, false)
  into v_is_self_contained
  from public.canonical_scv cs
  where cs.plate_number = p_plate_number;

  if v_requires_sc and not v_is_self_contained then
    v_is_compliant := false;
    v_breach_type := 'self_contained';
    v_breach_reason := 'Zone requires certified self-contained vehicles';
  elsif v_nights_stayed > v_max_nights then
    v_is_compliant := false;
    v_breach_type := 'monthly_limit';
    v_breach_reason := format('Vehicle stayed %s nights this month, limit is %s', v_nights_stayed, v_max_nights);
  elsif v_consecutive > v_max_consecutive then
    v_is_compliant := false;
    v_breach_type := 'consecutive_nights';
    v_breach_reason := format('Vehicle stayed %s consecutive nights, limit is %s', v_consecutive, v_max_consecutive);
  end if;

  return query
  select
    v_is_compliant,
    v_breach_type,
    v_breach_reason,
    v_nights_stayed,
    v_consecutive,
    v_zone_matrix;
end;
$$;

-- -----------------------------------------------------------------------------
-- Observation write-through helper: evaluates and persists compliance fields
-- -----------------------------------------------------------------------------
create or replace function public.apply_compliance_to_observation(
  p_observation_id uuid
)
returns table (
  observation_id uuid,
  is_compliant boolean,
  breach_type text,
  breach_reason text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_obs public.observations%rowtype;
  v_result record;
begin
  select *
  into v_obs
  from public.observations
  where observations.observation_id = p_observation_id;

  if not found then
    raise exception 'Observation % not found', p_observation_id;
  end if;

  select *
  into v_result
  from public.calculate_vehicle_compliance_clean(v_obs.plate_number, v_obs.zone_id, v_obs.recorded_at);

  update public.observations
  set
    is_compliant = v_result.is_compliant,
    breach_type = v_result.breach_type,
    breach_reason = v_result.breach_reason,
    nights_stayed_this_month = v_result.nights_stayed,
    consecutive_nights = v_result.consecutive_nights,
    compliance_snapshot = v_result.matrix_snapshot,
    updated_at = now()
  where observations.observation_id = p_observation_id;

  return query
  select
    p_observation_id,
    v_result.is_compliant,
    v_result.breach_type,
    v_result.breach_reason;
end;
$$;

-- -----------------------------------------------------------------------------
-- Breach upsert helper from observation
-- -----------------------------------------------------------------------------
create or replace function public.upsert_breach_alert_from_observation(
  p_observation_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_obs public.observations%rowtype;
  v_alert_id uuid;
begin
  select *
  into v_obs
  from public.observations
  where observations.observation_id = p_observation_id;

  if not found then
    raise exception 'Observation % not found', p_observation_id;
  end if;

  if v_obs.is_compliant is true or v_obs.breach_type is null then
    return null;
  end if;

  select ba.id
  into v_alert_id
  from public.breach_alerts ba
  where ba.observation_id = p_observation_id
  limit 1;

  if v_alert_id is null then
    insert into public.breach_alerts (
      organization_id,
      zone_id,
      observation_id,
      plate_number,
      breach_type,
      breach_details,
      status
    ) values (
      v_obs.organization_id,
      v_obs.zone_id,
      v_obs.observation_id,
      v_obs.plate_number,
      v_obs.breach_type,
      jsonb_build_object('reason', v_obs.breach_reason),
      'pending'
    )
    returning id into v_alert_id;
  else
    update public.breach_alerts
    set
      breach_type = v_obs.breach_type,
      breach_details = jsonb_build_object('reason', v_obs.breach_reason),
      updated_at = now()
    where id = v_alert_id;
  end if;

  return v_alert_id;
end;
$$;

-- -----------------------------------------------------------------------------
-- Atomic notice number generation per organization
-- -----------------------------------------------------------------------------
create or replace function public.next_infringement_notice_number(
  p_organization_id uuid
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_next bigint;
  v_prefix text;
begin
  insert into public.infringement_notice_counters (organization_id, next_number)
  values (p_organization_id, 1)
  on conflict (organization_id) do nothing;

  update public.infringement_notice_counters
  set next_number = next_number + 1,
      updated_at = now()
  where organization_id = p_organization_id
  returning next_number - 1 into v_next;

  v_prefix := to_char(now() at time zone 'Pacific/Auckland', 'YYYYMM');
  return format('INF-%s-%s', v_prefix, lpad(v_next::text, 6, '0'));
end;
$$;

-- -----------------------------------------------------------------------------
-- Permissions: authenticated callers can execute clean RPCs.
-- RLS still controls data visibility.
-- -----------------------------------------------------------------------------
grant execute on function public.calculate_nz_working_day_due_date(timestamptz, integer) to authenticated, service_role;
grant execute on function public.calculate_vehicle_compliance_clean(text, uuid, timestamptz) to authenticated, service_role;
grant execute on function public.apply_compliance_to_observation(uuid) to authenticated, service_role;
grant execute on function public.upsert_breach_alert_from_observation(uuid) to authenticated, service_role;
grant execute on function public.next_infringement_notice_number(uuid) to authenticated, service_role;
