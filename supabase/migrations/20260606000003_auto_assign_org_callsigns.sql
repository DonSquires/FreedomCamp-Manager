-- Auto-assign radio callsigns using employer organization initials.
-- Examples: FSN23 (First Security Nelson), NCC10 (Nelson City Council)

ALTER TABLE public.user_profiles
  ADD COLUMN IF NOT EXISTS callsign text;

CREATE TABLE IF NOT EXISTS public.user_callsign_counters (
  organization_id uuid PRIMARY KEY REFERENCES public.organizations(id) ON DELETE CASCADE,
  next_number integer NOT NULL DEFAULT 1,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION public.build_org_callsign_prefix(org_name text)
RETURNS text
LANGUAGE plpgsql
AS $$
DECLARE
  prefix text;
BEGIN
  SELECT COALESCE(string_agg(initial, '' ORDER BY ordinality), 'ORG')
    INTO prefix
  FROM (
    SELECT
      upper(left(regexp_replace(word, '[^A-Za-z0-9]', '', 'g'), 1)) AS initial,
      ordinality
    FROM regexp_split_to_table(COALESCE(org_name, ''), '\\s+') WITH ORDINALITY AS t(word, ordinality)
    WHERE regexp_replace(word, '[^A-Za-z0-9]', '', 'g') <> ''
      AND lower(word) NOT IN ('the', 'and', 'of', 'limited', 'ltd', 'pty', 'inc', 'group', 'company')
    ORDER BY ordinality
    LIMIT 3
  ) initials;

  IF prefix IS NULL OR length(prefix) < 2 THEN
    prefix := 'ORG';
  END IF;

  RETURN prefix;
END;
$$;

CREATE OR REPLACE FUNCTION public.assign_user_callsign()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  target_org_id uuid;
  target_org_name text;
  prefix text;
  candidate text;
  n integer;
  i integer;
BEGIN
  IF NEW.callsign IS NOT NULL AND btrim(NEW.callsign) <> '' THEN
    RETURN NEW;
  END IF;

  target_org_id := COALESCE(NEW.employer_organization_id, NEW.organization_id);

  IF target_org_id IS NULL THEN
    NEW.callsign := 'UNIT' || right(replace(COALESCE(NEW.id::text, gen_random_uuid()::text), '-', ''), 2);
    RETURN NEW;
  END IF;

  SELECT o.name INTO target_org_name
  FROM public.organizations o
  WHERE o.id = target_org_id;

  prefix := public.build_org_callsign_prefix(target_org_name);

  FOR i IN 1..50 LOOP
    INSERT INTO public.user_callsign_counters (organization_id, next_number, updated_at)
    VALUES (target_org_id, 2, now())
    ON CONFLICT (organization_id)
    DO UPDATE SET
      next_number = public.user_callsign_counters.next_number + 1,
      updated_at = now()
    RETURNING next_number - 1 INTO n;

    candidate := prefix || lpad(n::text, 2, '0');

    IF NOT EXISTS (
      SELECT 1
      FROM public.user_profiles up
      WHERE COALESCE(up.employer_organization_id, up.organization_id) = target_org_id
        AND upper(COALESCE(up.callsign, '')) = upper(candidate)
        AND up.id <> COALESCE(NEW.id, '00000000-0000-0000-0000-000000000000'::uuid)
    ) THEN
      NEW.callsign := candidate;
      RETURN NEW;
    END IF;
  END LOOP;

  NEW.callsign := prefix || right(replace(COALESCE(NEW.id::text, gen_random_uuid()::text), '-', ''), 2);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_assign_user_callsign ON public.user_profiles;
CREATE TRIGGER trg_assign_user_callsign
BEFORE INSERT OR UPDATE OF callsign, organization_id, employer_organization_id
ON public.user_profiles
FOR EACH ROW
WHEN (NEW.callsign IS NULL OR btrim(NEW.callsign) = '')
EXECUTE FUNCTION public.assign_user_callsign();

UPDATE public.user_profiles
SET callsign = NULL
WHERE callsign IS NULL OR btrim(callsign) = '';

CREATE UNIQUE INDEX IF NOT EXISTS idx_user_profiles_org_callsign_unique
ON public.user_profiles (COALESCE(employer_organization_id, organization_id), upper(callsign))
WHERE callsign IS NOT NULL AND btrim(callsign) <> '';
