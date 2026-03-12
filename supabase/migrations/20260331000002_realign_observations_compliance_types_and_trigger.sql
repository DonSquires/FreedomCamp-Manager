-- Realign observations compliance-related columns and insert trigger semantics
-- to prevent runtime insert failures on drifted schemas.

BEGIN;

-- Ensure required columns exist (safe no-op when already present)
ALTER TABLE public.observations
  ADD COLUMN IF NOT EXISTS nights_stayed_this_month integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS consecutive_nights integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS breach_reason text,
  ADD COLUMN IF NOT EXISTS is_compliant boolean DEFAULT true;

DO $$
DECLARE
  v_type text;
BEGIN
  -- nights_stayed_this_month -> integer
  SELECT data_type INTO v_type
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name = 'observations'
    AND column_name = 'nights_stayed_this_month';

  IF v_type IS DISTINCT FROM 'integer' THEN
    EXECUTE $sql$
      ALTER TABLE public.observations
      ALTER COLUMN nights_stayed_this_month TYPE integer
      USING (
        CASE
          WHEN nights_stayed_this_month IS NULL THEN 0
          WHEN btrim(nights_stayed_this_month::text) = '' THEN 0
          WHEN btrim(nights_stayed_this_month::text) ~ '^-?[0-9]+$'
            THEN btrim(nights_stayed_this_month::text)::integer
          ELSE 0
        END
      )
    $sql$;
  END IF;

  -- consecutive_nights -> integer
  SELECT data_type INTO v_type
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name = 'observations'
    AND column_name = 'consecutive_nights';

  IF v_type IS DISTINCT FROM 'integer' THEN
    EXECUTE $sql$
      ALTER TABLE public.observations
      ALTER COLUMN consecutive_nights TYPE integer
      USING (
        CASE
          WHEN consecutive_nights IS NULL THEN 0
          WHEN btrim(consecutive_nights::text) = '' THEN 0
          WHEN btrim(consecutive_nights::text) ~ '^-?[0-9]+$'
            THEN btrim(consecutive_nights::text)::integer
          ELSE 0
        END
      )
    $sql$;
  END IF;

  -- is_compliant -> boolean
  SELECT data_type INTO v_type
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name = 'observations'
    AND column_name = 'is_compliant';

  IF v_type IS DISTINCT FROM 'boolean' THEN
    EXECUTE $sql$
      ALTER TABLE public.observations
      ALTER COLUMN is_compliant TYPE boolean
      USING (
        CASE
          WHEN is_compliant IS NULL THEN true
          WHEN lower(btrim(is_compliant::text)) IN ('true','t','1','yes','y') THEN true
          WHEN lower(btrim(is_compliant::text)) IN ('false','f','0','no','n') THEN false
          ELSE true
        END
      )
    $sql$;
  END IF;
END;
$$;

ALTER TABLE public.observations
  ALTER COLUMN nights_stayed_this_month SET DEFAULT 0,
  ALTER COLUMN consecutive_nights SET DEFAULT 0,
  ALTER COLUMN is_compliant SET DEFAULT true;

-- Drop legacy trigger if still present (old architecture uses observation_id assumptions)
DROP TRIGGER IF EXISTS trigger_auto_compliance_check ON public.observations;

-- Recreate trigger function with defensive casts from NEW.*::text
CREATE OR REPLACE FUNCTION public.auto_evaluate_compliance()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_matrix           RECORD;
  v_is_homeless      BOOLEAN := false;
  v_nz_hour          INTEGER;
  v_is_compliant     BOOLEAN := true;
  v_breach_type      TEXT    := NULL;
  v_breach_reason    TEXT    := NULL;
  v_nights_stayed    INTEGER := 0;
  v_consecutive      INTEGER := 0;
  v_self_contained   BOOLEAN := false;
BEGIN
  v_nights_stayed := COALESCE(
    NULLIF(regexp_replace(COALESCE(NEW.nights_stayed_this_month::text, ''), '[^0-9-]', '', 'g'), '')::integer,
    0
  );

  v_consecutive := COALESCE(
    NULLIF(regexp_replace(COALESCE(NEW.consecutive_nights::text, ''), '[^0-9-]', '', 'g'), '')::integer,
    0
  );

  v_self_contained := lower(COALESCE(NEW.self_contained::text, 'false')) IN ('true','t','1','yes','y');

  SELECT *
    INTO v_matrix
    FROM zone_compliance_matrix
   WHERE zone_id = NEW.zone_id
     AND effective_from <= NEW.recorded_at
     AND (effective_to IS NULL OR effective_to > NEW.recorded_at)
   ORDER BY version DESC
   LIMIT 1;

  IF NOT FOUND THEN
    SELECT
      self_contained_required,
      self_contained_required AS requires_csc,
      nights_per_month,
      max_consecutive_nights,
      day_visit_only,
      TRUE AS homeless_exemption
    INTO v_matrix
    FROM zones
    WHERE id = NEW.zone_id;

    IF NOT FOUND THEN
      NEW.nights_stayed_this_month := v_nights_stayed;
      NEW.consecutive_nights := v_consecutive;
      RETURN NEW;
    END IF;
  END IF;

  SELECT (homeless_status = 'confirmed')
    INTO v_is_homeless
    FROM canonical_vehicles
   WHERE plate_number = NEW.plate_number;

  IF NOT FOUND THEN
    v_is_homeless := false;
  END IF;

  IF COALESCE(v_matrix.day_visit_only, false) THEN
    v_nz_hour := EXTRACT(HOUR FROM NEW.recorded_at AT TIME ZONE 'Pacific/Auckland')::integer;
    IF v_nz_hour >= 20 OR v_nz_hour < 8 THEN
      v_is_compliant := false;
      v_breach_type := 'day_visit_violation';
      v_breach_reason := format('Night visit in day-only zone (observed at %s:00 NZ time)', v_nz_hour);
    END IF;
  END IF;

  IF v_is_compliant AND v_matrix.nights_per_month IS NOT NULL THEN
    IF v_nights_stayed > v_matrix.nights_per_month THEN
      IF NOT (v_is_homeless AND COALESCE(v_matrix.homeless_exemption, true)) THEN
        v_is_compliant := false;
        v_breach_type := 'monthly_limit';
        v_breach_reason := format(
          'Exceeded monthly stay limit: %s nights stayed, limit is %s',
          v_nights_stayed,
          v_matrix.nights_per_month
        );
      END IF;
    END IF;
  END IF;

  IF v_is_compliant AND v_matrix.max_consecutive_nights IS NOT NULL THEN
    IF v_consecutive > v_matrix.max_consecutive_nights THEN
      IF NOT (v_is_homeless AND COALESCE(v_matrix.homeless_exemption, true)) THEN
        v_is_compliant := false;
        v_breach_type := 'consecutive_nights';
        v_breach_reason := format(
          'Exceeded consecutive nights limit: %s consecutive nights, limit is %s',
          v_consecutive,
          v_matrix.max_consecutive_nights
        );
      END IF;
    END IF;
  END IF;

  IF v_is_compliant AND (
    COALESCE(v_matrix.self_contained_required, false)
    OR COALESCE(v_matrix.requires_csc, false)
  ) THEN
    IF NOT v_self_contained THEN
      IF NOT (v_is_homeless AND COALESCE(v_matrix.homeless_exemption, true)) THEN
        v_is_compliant := false;
        v_breach_type := 'self_contained';
        v_breach_reason := 'Zone requires a self-contained vehicle; no valid CSC on record';
      END IF;
    END IF;
  END IF;

  NEW.nights_stayed_this_month := v_nights_stayed;
  NEW.consecutive_nights := v_consecutive;
  NEW.is_compliant := v_is_compliant;
  NEW.breach_type := v_breach_type;
  NEW.breach_reason := v_breach_reason;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_auto_evaluate_compliance ON public.observations;
CREATE TRIGGER trg_auto_evaluate_compliance
  BEFORE INSERT ON public.observations
  FOR EACH ROW
  EXECUTE FUNCTION public.auto_evaluate_compliance();

-- Refresh PostgREST cache
NOTIFY pgrst, 'reload schema';

COMMIT;
