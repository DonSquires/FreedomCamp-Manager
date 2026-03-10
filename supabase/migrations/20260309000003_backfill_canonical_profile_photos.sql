-- Backfill canonical profile photos from latest observations and keep them hydrated.
-- This safely handles environments that may have either `photo_url` or `photo`.

DO $$
DECLARE
  obs_photo_expr text;
  obs_photo_column text;
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'observations' AND column_name = 'photo_url'
  ) THEN
    obs_photo_expr := 'o.photo_url';
    obs_photo_column := 'photo_url';
  ELSIF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'observations' AND column_name = 'photo'
  ) THEN
    obs_photo_expr := 'o.photo';
    obs_photo_column := 'photo';
  ELSE
    obs_photo_expr := NULL;
    obs_photo_column := NULL;
  END IF;

  IF obs_photo_expr IS NULL THEN
    RAISE NOTICE 'No observation photo column found. Skipping profile photo backfill.';
    RETURN;
  END IF;

  EXECUTE format($sql$
    WITH latest_photo AS (
      SELECT DISTINCT ON (o.plate_number)
        o.plate_number,
        %1$s AS photo_source
      FROM public.observations o
      WHERE %1$s IS NOT NULL
        AND btrim(%1$s::text) <> ''
      ORDER BY o.plate_number, o.recorded_at DESC
    )
    UPDATE public.canonical_vehicles cv
    SET
      profile_photo = lp.photo_source,
      profile_photo_selected_at = COALESCE(cv.profile_photo_selected_at, now()),
      updated_at = now()
    FROM latest_photo lp
    WHERE cv.plate_number = lp.plate_number
      AND (cv.profile_photo IS NULL OR btrim(cv.profile_photo) = '');
  $sql$, obs_photo_expr);

  EXECUTE format($sql$
    CREATE OR REPLACE FUNCTION public.set_canonical_profile_photo_from_observation()
    RETURNS trigger
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = public
    AS $$
    DECLARE
      incoming_photo text;
    BEGIN
      incoming_photo := %1$s;
      IF incoming_photo IS NULL OR btrim(incoming_photo) = '' THEN
        RETURN NEW;
      END IF;

      UPDATE public.canonical_vehicles cv
      SET
        profile_photo = incoming_photo,
        profile_photo_selected_at = COALESCE(cv.profile_photo_selected_at, now()),
        updated_at = now()
      WHERE cv.plate_number = NEW.plate_number
        AND (cv.profile_photo IS NULL OR btrim(cv.profile_photo) = '');

      RETURN NEW;
    END;
    $$;
  $sql$, replace(obs_photo_expr, 'o.', 'NEW.'));

  DROP TRIGGER IF EXISTS trg_set_canonical_profile_photo_from_observation ON public.observations;

  EXECUTE format($sql$
    CREATE TRIGGER trg_set_canonical_profile_photo_from_observation
    AFTER INSERT OR UPDATE OF plate_number, %1$I
    ON public.observations
    FOR EACH ROW
    EXECUTE FUNCTION public.set_canonical_profile_photo_from_observation();
  $sql$, obs_photo_column);

END $$;
