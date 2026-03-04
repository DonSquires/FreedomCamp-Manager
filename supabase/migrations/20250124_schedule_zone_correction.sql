-- Enable pg_cron extension for scheduled jobs
-- NOTE: pg_cron requires the Supabase Pro plan. On Free plan this entire
-- scheduling section is skipped gracefully — the edge function can still be
-- triggered manually or via webhook without pg_cron.
DO $$
BEGIN
  CREATE EXTENSION IF NOT EXISTS pg_cron;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'pg_cron not available on this plan (requires Supabase Pro). Scheduled jobs will be skipped. Error: %', SQLERRM;
END $$;

-- Schedule GPS zone correction to run daily at 3am NZ time (NZDT: UTC+13, NZST: UTC+12)
-- Using 2pm UTC which is approximately 3am NZ time (accounting for daylight saving variations)
-- (Only runs if pg_cron was successfully enabled above)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.schedule(
      'daily-gps-zone-correction',
      '0 14 * * *', -- 2pm UTC = ~3am NZDT
      $cron$
      select
        net.http_post(
          url := current_setting('app.supabase_url') || '/functions/v1/correct-zone-assignments',
          headers := jsonb_build_object(
            'Content-Type', 'application/json',
            'Authorization', 'Bearer ' || current_setting('app.supabase_service_role_key')
          ),
          body := '{}'::jsonb
        ) as request_id;
      $cron$
    );
    RAISE NOTICE 'Scheduled daily-gps-zone-correction (2pm UTC / ~3am NZDT)';
  ELSE
    RAISE WARNING 'pg_cron not available — daily-gps-zone-correction cron job was NOT scheduled. Upgrade to Supabase Pro to enable scheduling.';
  END IF;
END $$;

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

-- Comment on the scheduled job (only if pg_cron was enabled)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    COMMENT ON EXTENSION pg_cron IS 'Scheduled job: daily-gps-zone-correction runs at 3am NZ time to correct vehicle record zone assignments based on GPS coordinates';
  END IF;
END $$;
