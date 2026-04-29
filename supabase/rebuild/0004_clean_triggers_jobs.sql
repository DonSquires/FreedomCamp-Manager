-- FieldOps Manager clean rebuild triggers and jobs
-- Date: 2026-04-01
-- Depends on: 0001_clean_baseline.sql, 0003_clean_rpcs.sql

-- -----------------------------------------------------------------------------
-- Trigger function: evaluate compliance and ensure breach alert state on insert
-- -----------------------------------------------------------------------------
create or replace function public.trg_observation_apply_compliance_and_breach()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.apply_compliance_to_observation(new.observation_id);
  perform public.upsert_breach_alert_from_observation(new.observation_id);

  return new;
end;
$$;

drop trigger if exists trg_observation_apply_compliance_and_breach on public.observations;
create trigger trg_observation_apply_compliance_and_breach
after insert on public.observations
for each row
execute function public.trg_observation_apply_compliance_and_breach();

-- -----------------------------------------------------------------------------
-- Trigger function: upsert breach when compliance fields are edited
-- -----------------------------------------------------------------------------
create or replace function public.trg_observation_sync_breach_on_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if (new.is_compliant is distinct from old.is_compliant)
     or (new.breach_type is distinct from old.breach_type)
     or (new.breach_reason is distinct from old.breach_reason) then
    perform public.upsert_breach_alert_from_observation(new.observation_id);
  end if;

  return new;
end;
$$;

drop trigger if exists trg_observation_sync_breach_on_update on public.observations;
create trigger trg_observation_sync_breach_on_update
after update on public.observations
for each row
execute function public.trg_observation_sync_breach_on_update();

-- -----------------------------------------------------------------------------
-- Scheduled jobs scaffolding (optional pg_cron support)
-- -----------------------------------------------------------------------------
create extension if not exists pg_cron;

-- Daily maintenance placeholder function for clean schedule orchestration.
create or replace function public.run_daily_clean_maintenance()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Placeholder orchestration point:
  -- - cleanup-and-recalculate
  -- - photo-maintenance
  -- - nightly-privacy-cleanup
  return;
end;
$$;

-- Register cron only when pg_cron is available and schema permissions allow.
do $$
begin
  if exists (
    select 1
    from information_schema.schemata
    where schema_name = 'cron'
  ) then
    if not exists (
      select 1
      from cron.job
      where jobname = 'clean_daily_maintenance'
    ) then
      perform cron.schedule(
        'clean_daily_maintenance',
        '15 2 * * *',
        $$select public.run_daily_clean_maintenance();$$
      );
    end if;
  end if;
exception
  when others then
    -- Non-fatal in environments without cron permissions.
    null;
end
$$;
