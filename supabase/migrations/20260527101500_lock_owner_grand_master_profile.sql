-- Owner identity guardrail: lock Don Squires profile to grand_master + Iron Eagle org.
-- This migration enforces and protects the owner profile from role/org drift.

DO $$
BEGIN
  UPDATE public.user_profiles
  SET
    role = 'grand_master',
    organization_id = '632a5672-07df-4251-b597-bd9bc76a964f',
    employer_organization_id = '632a5672-07df-4251-b597-bd9bc76a964f'
  WHERE lower(email) = 'squires.don@live.com';
END $$;

CREATE OR REPLACE FUNCTION public.enforce_owner_profile_lock()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  owner_email constant text := 'squires.don@live.com';
  owner_org_id constant uuid := '632a5672-07df-4251-b597-bd9bc76a964f';
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

  -- Keep owner role/org immutable.
  IF TG_OP = 'UPDATE' AND lower(COALESCE(OLD.email, '')) = owner_email THEN
    IF lower(COALESCE(NEW.email, '')) <> owner_email THEN
      RAISE EXCEPTION 'Owner email cannot be changed';
    END IF;

    IF NEW.role IS DISTINCT FROM 'grand_master'
      OR NEW.organization_id IS DISTINCT FROM owner_org_id
      OR NEW.employer_organization_id IS DISTINCT FROM owner_org_id
    THEN
      RAISE EXCEPTION 'Owner role and organization are locked';
    END IF;
  END IF;

  NEW.role := 'grand_master';
  NEW.organization_id := owner_org_id;
  NEW.employer_organization_id := owner_org_id;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_owner_profile_lock ON public.user_profiles;
CREATE TRIGGER trg_enforce_owner_profile_lock
BEFORE INSERT OR UPDATE OR DELETE ON public.user_profiles
FOR EACH ROW
EXECUTE FUNCTION public.enforce_owner_profile_lock();
