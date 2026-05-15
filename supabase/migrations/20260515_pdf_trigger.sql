-- ============================================================
-- PDF Trigger: Automated compliance notice generation
-- Fires an async HTTP call to generate-compliance-pdf edge
-- function whenever a SMOKE_COMPLAINT or BIOSECURITY_BREACH
-- incident row is inserted into public.incidents.
--
-- Requires: pg_net extension (pre-installed on Supabase)
-- ============================================================

-- Ensure pg_net is available
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

-- ============================================================
-- Trigger function
-- ============================================================
CREATE OR REPLACE FUNCTION public.handle_automated_breach_notice()
RETURNS TRIGGER AS $$
DECLARE
  _url     text;
  _svc_key text;
BEGIN
  -- Only fire for breach incident types
  IF NEW.type NOT IN ('SMOKE_COMPLAINT', 'BIOSECURITY_BREACH') THEN
    RETURN NEW;
  END IF;

  -- Resolve Supabase project URL and service role key from app settings
  -- These must be set via: ALTER DATABASE postgres SET app.settings.supabase_url = '...';
  --                         ALTER DATABASE postgres SET app.settings.service_role_key = '...';
  BEGIN
    _url     := current_setting('app.settings.supabase_url', true);
    _svc_key := current_setting('app.settings.service_role_key', true);
  EXCEPTION WHEN OTHERS THEN
    -- Settings not configured; skip async trigger silently
    RAISE WARNING 'handle_automated_breach_notice: app.settings not configured, skipping PDF generation for incident %', NEW.id;
    RETURN NEW;
  END;

  IF _url IS NULL OR _svc_key IS NULL THEN
    RAISE WARNING 'handle_automated_breach_notice: empty app.settings, skipping PDF generation for incident %', NEW.id;
    RETURN NEW;
  END IF;

  -- Asynchronously invoke the edge function using pg_net (non-blocking)
  PERFORM net.http_post(
    url     := _url || '/functions/v1/generate-compliance-pdf',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer ' || _svc_key
    ),
    body    := jsonb_build_object(
      'incident_id', NEW.id,
      'type',        NEW.type,
      'location',    COALESCE(NEW.location_string, NEW.raw_desc, 'Unknown location'),
      'timestamp',   to_char(COALESCE(NEW.created_at, NOW()) AT TIME ZONE 'Pacific/Auckland', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
    )
  );

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- Attach trigger to incidents table (idempotent)
-- ============================================================
DROP TRIGGER IF EXISTS on_breach_detected_generate_pdf ON public.incidents;

CREATE TRIGGER on_breach_detected_generate_pdf
  AFTER INSERT ON public.incidents
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_automated_breach_notice();

-- Grant execute to supabase_functions_admin (role used by edge function invoker)
ALTER FUNCTION public.handle_automated_breach_notice() OWNER TO supabase_admin;
