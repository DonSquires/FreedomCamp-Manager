-- Set Don Squires as grand_master for Iron Eagle and align profile lock behavior.

DO $$
DECLARE
  v_owner_org_id uuid;
BEGIN
  SELECT id
    INTO v_owner_org_id
  FROM public.organizations
  WHERE lower(name) IN (
    'iron eagle security limited',
    'iron eagle security',
    'iron eagle'
  )
  ORDER BY CASE lower(name)
    WHEN 'iron eagle security limited' THEN 1
    WHEN 'iron eagle security' THEN 2
    ELSE 3
  END
  LIMIT 1;

  IF v_owner_org_id IS NULL THEN
    RAISE EXCEPTION 'Iron Eagle organization not found. Expected one of: Iron Eagle Security Limited, Iron Eagle Security, Iron Eagle';
  END IF;

  UPDATE public.user_profiles
  SET
    role = 'grand_master',
    first_name = 'Don',
    last_name = 'Squires',
    organization_id = v_owner_org_id,
    employer_organization_id = v_owner_org_id,
    updated_at = now()
  WHERE lower(email) = 'squires.don@live.com';
END $$;

CREATE OR REPLACE FUNCTION public.enforce_owner_profile_lock()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  owner_email constant text := 'squires.don@live.com';
  owner_role constant text := 'grand_master';
  owner_org_id uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF lower(COALESCE(OLD.email, '')) = owner_email THEN
      RAISE EXCEPTION 'Owner profile cannot be deleted';
    END IF;
    RETURN OLD;
  END IF;

  -- Reserve owner email from reassignment to other profiles.
  IF lower(COALESCE(NEW.email, '')) = owner_email AND lower(COALESCE(OLD.email, '')) <> owner_email THEN
    RAISE EXCEPTION 'Owner email is reserved and cannot be reassigned';
  END IF;

  IF lower(COALESCE(NEW.email, '')) <> owner_email AND lower(COALESCE(OLD.email, '')) <> owner_email THEN
    RETURN NEW;
  END IF;

  SELECT id
    INTO owner_org_id
  FROM public.organizations
  WHERE lower(name) IN (
    'iron eagle security limited',
    'iron eagle security',
    'iron eagle'
  )
  ORDER BY CASE lower(name)
    WHEN 'iron eagle security limited' THEN 1
    WHEN 'iron eagle security' THEN 2
    ELSE 3
  END
  LIMIT 1;

  IF owner_org_id IS NULL THEN
    RAISE EXCEPTION 'Iron Eagle organization not found. Owner lock cannot be enforced.';
  END IF;

  -- Keep owner role/org immutable.
  IF TG_OP = 'UPDATE' AND lower(COALESCE(OLD.email, '')) = owner_email THEN
    IF lower(COALESCE(NEW.email, '')) <> owner_email THEN
      RAISE EXCEPTION 'Owner email cannot be changed';
    END IF;

    IF NEW.role IS DISTINCT FROM owner_role
      OR NEW.organization_id IS DISTINCT FROM owner_org_id
      OR NEW.employer_organization_id IS DISTINCT FROM owner_org_id
    THEN
      RAISE EXCEPTION 'Owner role and organization are locked';
    END IF;
  END IF;

  NEW.role := owner_role;
  NEW.organization_id := owner_org_id;
  NEW.employer_organization_id := owner_org_id;
  RETURN NEW;
END;
$$;
