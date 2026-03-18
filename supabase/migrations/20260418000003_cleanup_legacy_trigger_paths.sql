-- ============================================================================
-- Cleanup legacy trigger paths after observations-first compliance migration
-- Date: 2026-04-18
--
-- Why:
--   Live trigger inventory shows legacy compliance_results trigger chains still
--   present. The current pipeline evaluates compliance directly on observations
--   and creates breach_alerts from observations context.
--
-- What this migration does:
--   1) Removes legacy trigger chain that relies on compliance_results as source
--      of truth (now deprecated for live workflow).
--   2) Removes duplicate updated_at trigger on investigation_jobs.
--   3) Rewrites set_enforcement_plate_number() to use observations first and
--      only fall back to vehicle_observations_v2 when present.
--
-- Safety:
--   - All DROP operations are IF EXISTS / guarded.
--   - Function rewrite is backward-compatible with legacy compatibility view.
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1) Remove deprecated compliance_results trigger chain
-- ---------------------------------------------------------------------------

DROP TRIGGER IF EXISTS trigger_auto_create_compliance_result ON public.observations;

DO $$
BEGIN
  IF to_regclass('public.compliance_results') IS NOT NULL THEN
    EXECUTE 'DROP TRIGGER IF EXISTS trigger_sync_observation_compliance ON public.compliance_results';
    EXECUTE 'DROP TRIGGER IF EXISTS trigger_create_breach_alert_from_compliance ON public.compliance_results';
    EXECUTE 'DROP TRIGGER IF EXISTS trigger_auto_create_breach_alert ON public.compliance_results';
  END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- 2) Remove duplicate updated_at trigger on investigation_jobs
--    Keep trigger_update_investigation_jobs_updated_at (uses nz_now())
-- ---------------------------------------------------------------------------

DROP TRIGGER IF EXISTS trg_investigation_jobs_updated_at ON public.investigation_jobs;

-- ---------------------------------------------------------------------------
-- 3) Normalise enforcement plate lookup to observations-first
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.set_enforcement_plate_number()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  -- Get plate from vehicle_record if not already set
  IF NEW.plate_number IS NULL AND NEW.vehicle_record_id IS NOT NULL THEN
    SELECT plate_number INTO NEW.plate_number
    FROM public.vehicle_records
    WHERE id = NEW.vehicle_record_id;
  END IF;

  -- Primary source: canonical observations table
  IF NEW.plate_number IS NULL AND NEW.observation_id IS NOT NULL THEN
    SELECT plate_number INTO NEW.plate_number
    FROM public.observations
    WHERE observation_id = NEW.observation_id;
  END IF;

  -- Legacy fallback: compatibility view/table if it still exists
  IF NEW.plate_number IS NULL
     AND NEW.observation_id IS NOT NULL
     AND to_regclass('public.vehicle_observations_v2') IS NOT NULL THEN
    EXECUTE '
      SELECT plate_number
      FROM public.vehicle_observations_v2
      WHERE observation_id = $1
    '
    INTO NEW.plate_number
    USING NEW.observation_id;
  END IF;

  RETURN NEW;
END;
$function$;

COMMIT;
