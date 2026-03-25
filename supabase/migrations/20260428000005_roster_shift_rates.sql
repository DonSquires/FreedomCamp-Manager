-- ============================================================================
-- Roster Shift Rate Columns & Auto-Populate Trigger
-- Date: 2026-04-28
--
-- When a contractor's guard is rostered to a shift the system automatically
-- populates the guard cost rate (from contractor_profiles) and the client
-- charge rate (from client_sites).  Admin, rostering and sales team users
-- can immediately see the margin (charge − cost) on every shift.
-- ============================================================================

-- ── 1. Add rate columns to roster_shifts ─────────────────────────────────────

ALTER TABLE public.roster_shifts
  ADD COLUMN IF NOT EXISTS guard_cost_rate     NUMERIC(10, 4),   -- what we pay the guard/contractor $/hr
  ADD COLUMN IF NOT EXISTS client_charge_rate  NUMERIC(10, 4),   -- what we bill the client $/hr
  ADD COLUMN IF NOT EXISTS rate_type           TEXT    DEFAULT 'standard'
                              CHECK (rate_type IN (
                                'standard', 'standby', 'short_notice', 'long_term', 'overtime'
                              )),
  ADD COLUMN IF NOT EXISTS contractor_org_id   UUID    REFERENCES public.organizations(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.roster_shifts.guard_cost_rate    IS 'Guard/contractor cost rate ($/hr, ex-GST). Auto-populated from contractor_profiles when officer is assigned.';
COMMENT ON COLUMN public.roster_shifts.client_charge_rate IS 'Client charge rate ($/hr, ex-GST). Auto-populated from client_sites.default_charge_rate when site is assigned.';
COMMENT ON COLUMN public.roster_shifts.rate_type          IS 'Rate band applied: standard | standby | short_notice | long_term | overtime. Controls which contractor rate is used.';
COMMENT ON COLUMN public.roster_shifts.contractor_org_id  IS 'Set when the assigned officer belongs to a contractor org. Used for margin reporting.';

CREATE INDEX IF NOT EXISTS idx_roster_shifts_contractor
  ON public.roster_shifts(contractor_org_id) WHERE contractor_org_id IS NOT NULL;

-- ── 2. Auto-populate trigger function ────────────────────────────────────────
--
-- Fires BEFORE INSERT or UPDATE OF officer_id, rate_type, client_site_id.
-- Only acts when the assigned officer is employed by a contractor organisation.
-- Never overwrites a rate that has already been manually set.

CREATE OR REPLACE FUNCTION public.roster_shift_auto_populate_rates()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  v_contractor_org_id    UUID;
  v_is_contractor        BOOLEAN := false;
  v_guard_rate           NUMERIC(10,4);
  v_standby_rate         NUMERIC(10,4);
  v_short_notice_rate    NUMERIC(10,4);
  v_long_term_rate       NUMERIC(10,4);
  v_site_charge_rate     NUMERIC(10,4);
BEGIN
  -- Nothing to do if no officer assigned
  IF NEW.officer_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Resolve the officer's employer org (contractor takes priority)
  SELECT COALESCE(up.employer_organization_id, up.organization_id)
  INTO   v_contractor_org_id
  FROM   public.user_profiles up
  WHERE  up.id = NEW.officer_id
  LIMIT  1;

  -- Check whether that org is a contractor
  SELECT (organization_type = 'contractor')
  INTO   v_is_contractor
  FROM   public.organizations
  WHERE  id = v_contractor_org_id;

  IF NOT COALESCE(v_is_contractor, false) THEN
    -- Employee of service_provider / other org — no contractor rate logic needed
    RETURN NEW;
  END IF;

  -- Tag the shift with the contractor org
  NEW.contractor_org_id := v_contractor_org_id;

  -- Fetch rate card from contractor_profiles
  SELECT
    cp.guard_rate_per_hour,
    cp.standby_rate_per_hour,
    cp.short_notice_rate_per_hour,
    cp.long_term_rate_per_hour
  INTO
    v_guard_rate,
    v_standby_rate,
    v_short_notice_rate,
    v_long_term_rate
  FROM public.contractor_profiles cp
  WHERE cp.organization_id = v_contractor_org_id
  LIMIT 1;

  -- Only set guard_cost_rate if not already manually specified
  IF NEW.guard_cost_rate IS NULL THEN
    NEW.guard_cost_rate := CASE COALESCE(NEW.rate_type, 'standard')
      WHEN 'standby'      THEN v_standby_rate
      WHEN 'short_notice' THEN v_short_notice_rate
      WHEN 'long_term'    THEN v_long_term_rate
      ELSE                     v_guard_rate   -- standard & overtime use base guard rate
    END;
  END IF;

  -- Inherit client charge rate from site if not already set
  IF NEW.client_charge_rate IS NULL AND NEW.client_site_id IS NOT NULL THEN
    SELECT cs.default_charge_rate
    INTO   v_site_charge_rate
    FROM   public.client_sites cs
    WHERE  cs.id = NEW.client_site_id
    LIMIT  1;

    NEW.client_charge_rate := v_site_charge_rate;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_roster_shift_auto_rates ON public.roster_shifts;
CREATE TRIGGER trg_roster_shift_auto_rates
  BEFORE INSERT OR UPDATE OF officer_id, rate_type, client_site_id
  ON public.roster_shifts
  FOR EACH ROW EXECUTE FUNCTION public.roster_shift_auto_populate_rates();

-- ── 3. Grant read on new columns to existing roster policies ─────────────────
-- The existing RLS policies on roster_shifts already cover SELECT/UPDATE for
-- admins and officers — no new policies are needed.  The new columns are
-- visible under the same policies.

DO $$
BEGIN
  RAISE NOTICE '✅ roster_shifts rate columns added: guard_cost_rate, client_charge_rate, rate_type, contractor_org_id';
  RAISE NOTICE '✅ Auto-populate trigger trg_roster_shift_auto_rates created';
END $$;
