-- Enable pg_cron extension for scheduled jobs
create extension if not exists pg_cron;

-- Schedule GPS zone correction to run daily at 3am NZ time (NZDT: UTC+13, NZST: UTC+12)
-- Using 2pm UTC which is approximately 3am NZ time (accounting for daylight saving variations)
select cron.schedule(
  'daily-gps-zone-correction',
  '0 14 * * *', -- 2pm UTC = ~3am NZDT
  $$
  select
    net.http_post(
      url := current_setting('app.supabase_url') || '/functions/v1/correct-zone-assignments',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || current_setting('app.supabase_service_role_key')
      ),
      body := '{}'::jsonb
    ) as request_id;
  $$
);

-- Create a function to manually trigger zone correction (for testing/admin use)
create or replace function public.trigger_zone_correction()
returns jsonb
language plpgsql
security definer
as $$
declare
  response jsonb;
begin
  -- Only allow master users or super admin to trigger this
  if not (
    exists (
      select 1 from public.user_profiles
      where id = auth.uid()
      and (
        role = 'master'
        or (email = 'don.squire@firstsecurity.co.nz' and permissions @> '["super_delete"]'::jsonb)
      )
    )
  ) then
    raise exception 'Unauthorized: Only master users can trigger zone correction';
  end if;

  -- Trigger the Edge Function
  select
    net.http_post(
      url := current_setting('app.supabase_url') || '/functions/v1/correct-zone-assignments',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || current_setting('app.supabase_service_role_key')
      ),
      body := '{}'::jsonb
    ) into response;

  return jsonb_build_object(
    'success', true,
    'message', 'Zone correction job triggered successfully',
    'response', response
  );
exception
  when others then
    return jsonb_build_object(
      'success', false,
      'error', sqlerrm
    );
end;
$$;

-- Grant execute permission on the trigger function
grant execute on function public.trigger_zone_correction() to authenticated;

-- Comment on the scheduled job
comment on extension pg_cron is 'Scheduled job: daily-gps-zone-correction runs at 3am NZ time to correct vehicle record zone assignments based on GPS coordinates';
