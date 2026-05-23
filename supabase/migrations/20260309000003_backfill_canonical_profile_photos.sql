-- Backfill canonical profile photos from latest observations and keep them hydrated.
-- Uses JSON projection so this works whether observations has `photo_url` or `photo`.

WITH latest_photo AS (
  SELECT DISTINCT ON (o.plate_number)
    o.plate_number,
    COALESCE(to_jsonb(o)->>'photo_url', to_jsonb(o)->>'photo') AS photo_source
  FROM public.observations o
  WHERE COALESCE(to_jsonb(o)->>'photo_url', to_jsonb(o)->>'photo') IS NOT NULL
    AND btrim(COALESCE(to_jsonb(o)->>'photo_url', to_jsonb(o)->>'photo')) <> ''
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

CREATE OR REPLACE FUNCTION public.set_canonical_profile_photo_from_observation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  incoming_photo text;
BEGIN
  incoming_photo := COALESCE(to_jsonb(NEW)->>'photo_url', to_jsonb(NEW)->>'photo');
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
$fn$;

DROP TRIGGER IF EXISTS trg_set_canonical_profile_photo_from_observation ON public.observations;

CREATE TRIGGER trg_set_canonical_profile_photo_from_observation
AFTER INSERT OR UPDATE ON public.observations
FOR EACH ROW
EXECUTE FUNCTION public.set_canonical_profile_photo_from_observation();
