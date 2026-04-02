-- ============================================================================
-- On-Call Rostering, Callout Shifts & Travel Allowances
-- Date: 2026-05-11
--
-- Implements comprehensive on-call rostering system with:
--   1. on_call_periods      — Staff rostered on-call with fixed availability rates
--   2. on_call_rates        — Configurable rate structures per org/officer/period type
--   3. callout_shifts       — Ad-hoc shifts triggered from on-call with 3hr minimum
--   4. travel_allowances    — Per-shift travel tracking (time, distance, or both)
--   5. office_locations     — Reference points for travel distance calculation
--
-- Key Features:
--   • On-call periods: 12hr, 24hr, or split (before/after shift)
--   • Fixed on-call rates (doesn't count as hours worked)
--   • Callout minimum: 3 hours paid regardless of actual duration
--   • Travel allowance: time traveled, km traveled, or both
--   • In/out of jurisdiction tracking for travel
--   • Per-officer rate overrides
-- ============================================================================

-- ────────────────────────────────────────────────────────────────────────────
-- 1. OFFICE LOCATIONS
-- Reference points for calculating travel distance/time
-- ────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.office_locations (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   UUID        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  
  name              TEXT        NOT NULL,  -- e.g. 'Auckland HQ', 'Wellington Office'
  address           TEXT,
  
  -- GPS coordinates for distance calculation
  latitude          NUMERIC(10, 7),
  longitude         NUMERIC(10, 7),
  
  -- Jurisdiction boundary (polygon or radius)
  jurisdiction_radius_km  NUMERIC(8, 2),  -- simple radius-based jurisdiction
  jurisdiction_geom       GEOMETRY(POLYGON, 4326),  -- or complex polygon boundary
  
  is_primary        BOOLEAN     NOT NULL DEFAULT false,  -- main office for distance calc
  is_active         BOOLEAN     NOT NULL DEFAULT true,
  
  notes             TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_office_locations_org
  ON public.office_locations(organization_id, is_active);

CREATE INDEX IF NOT EXISTS idx_office_locations_primary
  ON public.office_locations(organization_id) WHERE is_primary = true;

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION public.update_office_locations_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

CREATE TRIGGER trg_office_locations_updated_at
  BEFORE UPDATE ON public.office_locations
  FOR EACH ROW EXECUTE FUNCTION public.update_office_locations_updated_at();

COMMENT ON TABLE public.office_locations IS 
  'Office/base locations used as reference points for travel allowance calculations.';

-- ────────────────────────────────────────────────────────────────────────────
-- 2. ON-CALL RATE CONFIGURATIONS
-- Configurable rate structures for on-call periods
-- ────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.on_call_rates (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   UUID        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  
  name              TEXT        NOT NULL,  -- e.g. 'Standard On-Call', 'Weekend Premium'
  description       TEXT,
  
  -- Period type this rate applies to
  period_type       TEXT        NOT NULL DEFAULT 'standard'
    CHECK (period_type IN (
      'standard',          -- regular on-call period
      'before_shift',      -- on-call before a scheduled shift
      'after_shift',       -- on-call after a scheduled shift
      'overnight',         -- overnight on-call (e.g. 6pm-6am)
      'weekend',           -- weekend on-call
      'public_holiday'     -- public holiday on-call
    )),
  
  -- Fixed rate for being on-call (not per hour worked)
  -- This is paid regardless of whether any callout occurs
  flat_rate_per_period  NUMERIC(10, 2),  -- fixed amount per on-call period
  hourly_rate           NUMERIC(10, 2),  -- or hourly rate for availability
  
  -- Duration ranges this rate applies to (in hours)
  min_duration_hours    NUMERIC(5, 2) DEFAULT 0,
  max_duration_hours    NUMERIC(5, 2) DEFAULT 24,
  
  -- Callout rates (when actually called out)
  callout_minimum_hours      NUMERIC(5, 2) NOT NULL DEFAULT 3,  -- minimum paid hours per callout
  callout_hourly_rate        NUMERIC(10, 2),  -- rate per hour during callout
  callout_after_minimum_rate NUMERIC(10, 2),  -- rate for hours beyond minimum
  
  -- Travel allowance defaults
  travel_time_rate_per_hour  NUMERIC(10, 2),  -- rate for travel time
  travel_distance_rate_per_km NUMERIC(10, 4), -- rate per km traveled
  travel_includes_return     BOOLEAN NOT NULL DEFAULT true,  -- include return journey
  travel_in_jurisdiction_only BOOLEAN NOT NULL DEFAULT false, -- only pay for out-of-jurisdiction
  
  -- Applicability
  is_default         BOOLEAN     NOT NULL DEFAULT false,  -- default rate for this org
  effective_from     DATE        NOT NULL DEFAULT CURRENT_DATE,
  effective_to       DATE,
  
  created_by         UUID        REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  
  CONSTRAINT uq_on_call_rate_org_type_default
    UNIQUE NULLS NOT DISTINCT (organization_id, period_type, is_default, effective_from)
);

CREATE INDEX IF NOT EXISTS idx_on_call_rates_org
  ON public.on_call_rates(organization_id, is_default, effective_from);

CREATE INDEX IF NOT EXISTS idx_on_call_rates_period_type
  ON public.on_call_rates(organization_id, period_type);

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION public.update_on_call_rates_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

CREATE TRIGGER trg_on_call_rates_updated_at
  BEFORE UPDATE ON public.on_call_rates
  FOR EACH ROW EXECUTE FUNCTION public.update_on_call_rates_updated_at();

COMMENT ON TABLE public.on_call_rates IS 
  'Configurable on-call rate structures including flat rates, callout minimums, and travel allowances.';
COMMENT ON COLUMN public.on_call_rates.callout_minimum_hours IS 
  'Minimum billable hours per callout (default 3hrs). Officer paid this minimum even for 30min callout.';

-- ────────────────────────────────────────────────────────────────────────────
-- 3. OFFICER ON-CALL RATE OVERRIDES
-- Per-officer rate overrides (some officers negotiate different rates)
-- ────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.officer_on_call_rates (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  officer_id        UUID        NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
  organization_id   UUID        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  
  -- Override specific rate components (NULL = use org default)
  flat_rate_per_period       NUMERIC(10, 2),
  hourly_rate                NUMERIC(10, 2),
  callout_minimum_hours      NUMERIC(5, 2),
  callout_hourly_rate        NUMERIC(10, 2),
  callout_after_minimum_rate NUMERIC(10, 2),
  travel_time_rate_per_hour  NUMERIC(10, 2),
  travel_distance_rate_per_km NUMERIC(10, 4),
  
  -- Validity
  effective_from     DATE        NOT NULL DEFAULT CURRENT_DATE,
  effective_to       DATE,
  
  notes              TEXT,
  created_by         UUID        REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  
  CONSTRAINT uq_officer_on_call_rate
    UNIQUE (officer_id, effective_from)
);

CREATE INDEX IF NOT EXISTS idx_officer_on_call_rates_officer
  ON public.officer_on_call_rates(officer_id, effective_from);

COMMENT ON TABLE public.officer_on_call_rates IS 
  'Per-officer on-call rate overrides. NULL values inherit from organization defaults.';

-- ────────────────────────────────────────────────────────────────────────────
-- 4. ON-CALL PERIODS
-- Tracks when officers are rostered on-call
-- ────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.on_call_periods (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   UUID        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  officer_id        UUID        NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
  
  -- On-call window
  start_time        TIMESTAMPTZ NOT NULL,
  end_time          TIMESTAMPTZ NOT NULL,
  
  -- Period classification
  period_type       TEXT        NOT NULL DEFAULT 'standard'
    CHECK (period_type IN (
      'standard', 'before_shift', 'after_shift', 
      'overnight', 'weekend', 'public_holiday'
    )),
  
  -- Link to associated roster shift (if split on-call before/after a shift)
  linked_roster_shift_id UUID   REFERENCES public.roster_shifts(id) ON DELETE SET NULL,
  
  -- Rate configuration
  on_call_rate_id   UUID        REFERENCES public.on_call_rates(id) ON DELETE SET NULL,
  
  -- Calculated/override rates for this specific period
  flat_rate_amount       NUMERIC(10, 2),  -- actual flat rate for this period
  hourly_rate_amount     NUMERIC(10, 2),  -- or hourly rate (mutually exclusive with flat)
  
  -- Status
  status            TEXT        NOT NULL DEFAULT 'scheduled'
    CHECK (status IN (
      'scheduled',    -- planned future on-call
      'active',       -- currently on-call
      'completed',    -- on-call period ended (with or without callouts)
      'cancelled'     -- cancelled before starting
    )),
  
  -- Response tracking
  officer_accepted   BOOLEAN,
  officer_accepted_at TIMESTAMPTZ,
  officer_notes      TEXT,
  
  -- Actual on-call summary (populated on completion)
  callout_count      INTEGER     NOT NULL DEFAULT 0,
  total_callout_hours NUMERIC(8, 2) DEFAULT 0,
  
  -- Financial summary (populated by trigger/RPC on completion)
  on_call_pay_amount    NUMERIC(10, 2),  -- pay for being on-call (flat rate)
  callout_pay_amount    NUMERIC(10, 2),  -- pay for actual callouts
  travel_pay_amount     NUMERIC(10, 2),  -- travel allowance total
  total_pay_amount      NUMERIC(10, 2),  -- grand total
  
  notes              TEXT,
  internal_notes     TEXT,
  
  created_by         UUID        REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  
  CONSTRAINT check_end_after_start CHECK (end_time > start_time)
);

CREATE INDEX IF NOT EXISTS idx_on_call_periods_org_date
  ON public.on_call_periods(organization_id, start_time DESC, status);

CREATE INDEX IF NOT EXISTS idx_on_call_periods_officer
  ON public.on_call_periods(officer_id, start_time DESC);

CREATE INDEX IF NOT EXISTS idx_on_call_periods_linked_shift
  ON public.on_call_periods(linked_roster_shift_id) WHERE linked_roster_shift_id IS NOT NULL;

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION public.update_on_call_periods_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

CREATE TRIGGER trg_on_call_periods_updated_at
  BEFORE UPDATE ON public.on_call_periods
  FOR EACH ROW EXECUTE FUNCTION public.update_on_call_periods_updated_at();

COMMENT ON TABLE public.on_call_periods IS 
  'On-call availability windows. Officers receive fixed on-call pay regardless of callouts.';

-- ────────────────────────────────────────────────────────────────────────────
-- 5. CALLOUT SHIFTS
-- Ad-hoc shifts triggered from on-call periods with minimum hour rules
-- ────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.callout_shifts (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   UUID        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  officer_id        UUID        NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
  
  -- Link to on-call period that triggered this callout
  on_call_period_id UUID        NOT NULL REFERENCES public.on_call_periods(id) ON DELETE CASCADE,
  
  -- Callout details
  callout_reason    TEXT,        -- why the callout occurred
  callout_address   TEXT,        -- location of callout
  callout_latitude  NUMERIC(10, 7),
  callout_longitude NUMERIC(10, 7),
  
  -- Client/site reference
  client_site_id    UUID        REFERENCES public.client_sites(id) ON DELETE SET NULL,
  zone_id           UUID        REFERENCES public.zones(id) ON DELETE SET NULL,
  
  -- Timing
  callout_received_at   TIMESTAMPTZ NOT NULL DEFAULT now(),  -- when call received
  departed_at           TIMESTAMPTZ,  -- when officer left for location
  arrived_at            TIMESTAMPTZ,  -- when officer arrived at location
  work_started_at       TIMESTAMPTZ,  -- when actual work began
  work_ended_at         TIMESTAMPTZ,  -- when work completed
  returned_at           TIMESTAMPTZ,  -- when returned to base (if tracked)
  
  -- Actual vs Billable hours (minimum 3 hours rule)
  actual_work_hours     NUMERIC(8, 2),  -- actual time worked
  actual_total_hours    NUMERIC(8, 2),  -- including travel
  minimum_hours         NUMERIC(5, 2) NOT NULL DEFAULT 3,  -- minimum billable
  billable_hours        NUMERIC(8, 2),  -- max(actual, minimum)
  
  -- Rates applied
  callout_hourly_rate        NUMERIC(10, 2),
  callout_after_minimum_rate NUMERIC(10, 2),
  
  -- Pay calculation
  -- If worked 30 min: billable_hours = 3, pay = 3 * callout_hourly_rate
  -- If worked 5 hours: billable_hours = 5, pay = 3 * callout_hourly_rate + 2 * callout_after_minimum_rate
  base_pay_amount       NUMERIC(10, 2),  -- minimum hours * rate
  additional_pay_amount NUMERIC(10, 2),  -- hours above minimum * after_minimum_rate
  total_pay_amount      NUMERIC(10, 2),  -- total callout pay (excl. travel)
  
  -- Status
  status            TEXT        NOT NULL DEFAULT 'in_progress'
    CHECK (status IN (
      'pending',        -- callout received, not yet departed
      'in_progress',    -- officer en route or on-site
      'completed',      -- callout finished
      'cancelled'       -- callout cancelled before completion
    )),
  
  -- Link to actual officer_shift (if clocked in)
  officer_shift_id   UUID       REFERENCES public.officer_shifts(id) ON DELETE SET NULL,
  
  notes              TEXT,
  admin_notes        TEXT,
  
  created_by         UUID        REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_callout_shifts_org_date
  ON public.callout_shifts(organization_id, callout_received_at DESC);

CREATE INDEX IF NOT EXISTS idx_callout_shifts_officer
  ON public.callout_shifts(officer_id, callout_received_at DESC);

CREATE INDEX IF NOT EXISTS idx_callout_shifts_on_call
  ON public.callout_shifts(on_call_period_id);

CREATE INDEX IF NOT EXISTS idx_callout_shifts_status
  ON public.callout_shifts(organization_id, status) WHERE status IN ('pending', 'in_progress');

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION public.update_callout_shifts_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

CREATE TRIGGER trg_callout_shifts_updated_at
  BEFORE UPDATE ON public.callout_shifts
  FOR EACH ROW EXECUTE FUNCTION public.update_callout_shifts_updated_at();

COMMENT ON TABLE public.callout_shifts IS 
  'Ad-hoc shifts from on-call callouts. Minimum 3 hours paid regardless of actual work time.';
COMMENT ON COLUMN public.callout_shifts.billable_hours IS 
  'Maximum of actual_work_hours and minimum_hours (default 3). Controls pay calculation.';

-- ────────────────────────────────────────────────────────────────────────────
-- 6. TRAVEL ALLOWANCES
-- Per-callout travel tracking (time, distance, or both)
-- ────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.travel_allowances (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   UUID        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  officer_id        UUID        NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
  
  -- Link to callout (or standalone travel)
  callout_shift_id  UUID        REFERENCES public.callout_shifts(id) ON DELETE CASCADE,
  roster_shift_id   UUID        REFERENCES public.roster_shifts(id) ON DELETE SET NULL,
  officer_shift_id  UUID        REFERENCES public.officer_shifts(id) ON DELETE SET NULL,
  
  -- Journey details
  travel_date       DATE        NOT NULL DEFAULT CURRENT_DATE,
  journey_type      TEXT        NOT NULL DEFAULT 'round_trip'
    CHECK (journey_type IN (
      'outbound',      -- office to location
      'return',        -- location to office
      'round_trip',    -- combined outbound + return
      'site_to_site'   -- between locations (not from/to office)
    )),
  
  -- Origin/Destination
  origin_office_id  UUID        REFERENCES public.office_locations(id) ON DELETE SET NULL,
  origin_address    TEXT,
  origin_latitude   NUMERIC(10, 7),
  origin_longitude  NUMERIC(10, 7),
  
  destination_address   TEXT,
  destination_latitude  NUMERIC(10, 7),
  destination_longitude NUMERIC(10, 7),
  
  -- Distance tracking
  distance_km           NUMERIC(10, 2),  -- total distance
  distance_in_jurisdiction_km  NUMERIC(10, 2),  -- distance within org jurisdiction
  distance_out_of_jurisdiction_km NUMERIC(10, 2),  -- distance outside jurisdiction
  is_outside_jurisdiction BOOLEAN NOT NULL DEFAULT false,
  
  -- Time tracking
  travel_start_time     TIMESTAMPTZ,
  travel_end_time       TIMESTAMPTZ,
  travel_duration_minutes INTEGER,  -- total travel time in minutes
  
  -- Rates applied
  rate_per_km           NUMERIC(10, 4),
  rate_per_hour         NUMERIC(10, 2),
  
  -- Pay calculation
  distance_pay_amount   NUMERIC(10, 2),  -- distance_km * rate_per_km
  time_pay_amount       NUMERIC(10, 2),  -- travel_hours * rate_per_hour
  total_pay_amount      NUMERIC(10, 2),  -- combined (may be either or both)
  
  -- Status
  status            TEXT        NOT NULL DEFAULT 'pending'
    CHECK (status IN (
      'pending',      -- awaiting approval
      'approved',     -- approved for payment
      'rejected',     -- rejected (e.g. invalid claim)
      'paid'          -- included in payroll
    )),
  approved_by       UUID        REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  approved_at       TIMESTAMPTZ,
  
  notes             TEXT,
  admin_notes       TEXT,
  
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_travel_allowances_org_date
  ON public.travel_allowances(organization_id, travel_date DESC);

CREATE INDEX IF NOT EXISTS idx_travel_allowances_officer
  ON public.travel_allowances(officer_id, travel_date DESC);

CREATE INDEX IF NOT EXISTS idx_travel_allowances_callout
  ON public.travel_allowances(callout_shift_id) WHERE callout_shift_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_travel_allowances_status
  ON public.travel_allowances(organization_id, status);

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION public.update_travel_allowances_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

CREATE TRIGGER trg_travel_allowances_updated_at
  BEFORE UPDATE ON public.travel_allowances
  FOR EACH ROW EXECUTE FUNCTION public.update_travel_allowances_updated_at();

COMMENT ON TABLE public.travel_allowances IS 
  'Travel allowance tracking for callouts and shifts. Can be paid by time, distance, or both.';
COMMENT ON COLUMN public.travel_allowances.is_outside_jurisdiction IS 
  'Set to true if destination is outside organization jurisdiction boundary.';

-- ────────────────────────────────────────────────────────────────────────────
-- 7. HELPER FUNCTIONS
-- ────────────────────────────────────────────────────────────────────────────

-- Calculate distance between two GPS points (Haversine formula)
CREATE OR REPLACE FUNCTION public.calculate_distance_km(
  lat1 NUMERIC,
  lng1 NUMERIC,
  lat2 NUMERIC,
  lng2 NUMERIC
)
RETURNS NUMERIC
LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  R CONSTANT NUMERIC := 6371;  -- Earth radius in km
  phi1 NUMERIC;
  phi2 NUMERIC;
  delta_phi NUMERIC;
  delta_lambda NUMERIC;
  a NUMERIC;
  c NUMERIC;
BEGIN
  IF lat1 IS NULL OR lng1 IS NULL OR lat2 IS NULL OR lng2 IS NULL THEN
    RETURN NULL;
  END IF;
  
  phi1 := lat1 * PI() / 180;
  phi2 := lat2 * PI() / 180;
  delta_phi := (lat2 - lat1) * PI() / 180;
  delta_lambda := (lng2 - lng1) * PI() / 180;
  
  a := SIN(delta_phi / 2) * SIN(delta_phi / 2)
     + COS(phi1) * COS(phi2) * SIN(delta_lambda / 2) * SIN(delta_lambda / 2);
  c := 2 * ATAN2(SQRT(a), SQRT(1 - a));
  
  RETURN ROUND(R * c, 2);
END;
$$;

COMMENT ON FUNCTION public.calculate_distance_km IS 
  'Calculate distance in km between two GPS coordinates using Haversine formula.';

-- Check if location is within office jurisdiction
CREATE OR REPLACE FUNCTION public.is_within_jurisdiction(
  p_office_id UUID,
  p_latitude NUMERIC,
  p_longitude NUMERIC
)
RETURNS BOOLEAN
LANGUAGE plpgsql STABLE AS $$
DECLARE
  v_office public.office_locations%ROWTYPE;
  v_distance_km NUMERIC;
BEGIN
  SELECT * INTO v_office FROM public.office_locations WHERE id = p_office_id;
  
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;
  
  -- Check polygon boundary first (if defined)
  IF v_office.jurisdiction_geom IS NOT NULL THEN
    RETURN ST_Contains(
      v_office.jurisdiction_geom,
      ST_SetSRID(ST_MakePoint(p_longitude, p_latitude), 4326)
    );
  END IF;
  
  -- Fall back to radius check
  IF v_office.jurisdiction_radius_km IS NOT NULL 
     AND v_office.latitude IS NOT NULL 
     AND v_office.longitude IS NOT NULL THEN
    v_distance_km := public.calculate_distance_km(
      v_office.latitude, v_office.longitude,
      p_latitude, p_longitude
    );
    RETURN v_distance_km <= v_office.jurisdiction_radius_km;
  END IF;
  
  -- No jurisdiction defined — treat as within
  RETURN true;
END;
$$;

COMMENT ON FUNCTION public.is_within_jurisdiction IS 
  'Check if a location is within an office''s jurisdiction boundary.';

-- Calculate callout billable hours with minimum rule
CREATE OR REPLACE FUNCTION public.calculate_callout_billable_hours(
  p_actual_hours NUMERIC,
  p_minimum_hours NUMERIC DEFAULT 3
)
RETURNS NUMERIC
LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN
  RETURN GREATEST(COALESCE(p_actual_hours, 0), COALESCE(p_minimum_hours, 3));
END;
$$;

COMMENT ON FUNCTION public.calculate_callout_billable_hours IS 
  'Returns maximum of actual hours and minimum hours (default 3hr minimum).';

-- Calculate callout pay with minimum and after-minimum rates
CREATE OR REPLACE FUNCTION public.calculate_callout_pay(
  p_actual_hours NUMERIC,
  p_minimum_hours NUMERIC,
  p_callout_rate NUMERIC,
  p_after_minimum_rate NUMERIC DEFAULT NULL
)
RETURNS TABLE (
  billable_hours NUMERIC,
  base_pay NUMERIC,
  additional_pay NUMERIC,
  total_pay NUMERIC
)
LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  v_billable NUMERIC;
  v_base NUMERIC;
  v_additional NUMERIC;
  v_after_rate NUMERIC;
BEGIN
  v_billable := public.calculate_callout_billable_hours(p_actual_hours, p_minimum_hours);
  v_after_rate := COALESCE(p_after_minimum_rate, p_callout_rate);
  
  IF v_billable <= p_minimum_hours THEN
    -- Worked less than or equal to minimum — just pay minimum
    v_base := p_minimum_hours * p_callout_rate;
    v_additional := 0;
  ELSE
    -- Worked more than minimum — base rate for minimum, after rate for excess
    v_base := p_minimum_hours * p_callout_rate;
    v_additional := (v_billable - p_minimum_hours) * v_after_rate;
  END IF;
  
  RETURN QUERY SELECT
    v_billable,
    v_base,
    v_additional,
    v_base + v_additional;
END;
$$;

COMMENT ON FUNCTION public.calculate_callout_pay IS 
  'Calculate callout pay with 3hr minimum rule. Returns billable hours and pay breakdown.';

-- ────────────────────────────────────────────────────────────────────────────
-- 8. AUTO-CALCULATE CALLOUT PAY TRIGGER
-- Automatically calculates billable hours and pay when callout is completed
-- ────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.auto_calculate_callout_pay()
RETURNS TRIGGER
LANGUAGE plpgsql AS $$
DECLARE
  v_actual_hours NUMERIC;
  v_pay_result RECORD;
BEGIN
  -- Only calculate when status changes to 'completed'
  IF NEW.status = 'completed' AND (OLD.status IS DISTINCT FROM 'completed') THEN
    
    -- Calculate actual work hours if times are set
    IF NEW.work_started_at IS NOT NULL AND NEW.work_ended_at IS NOT NULL THEN
      v_actual_hours := EXTRACT(EPOCH FROM (NEW.work_ended_at - NEW.work_started_at)) / 3600;
      NEW.actual_work_hours := ROUND(v_actual_hours, 2);
    END IF;
    
    -- Calculate total hours including travel if tracked
    IF NEW.departed_at IS NOT NULL AND NEW.returned_at IS NOT NULL THEN
      NEW.actual_total_hours := ROUND(
        EXTRACT(EPOCH FROM (NEW.returned_at - NEW.departed_at)) / 3600, 2
      );
    ELSIF NEW.departed_at IS NOT NULL AND NEW.work_ended_at IS NOT NULL THEN
      NEW.actual_total_hours := ROUND(
        EXTRACT(EPOCH FROM (NEW.work_ended_at - NEW.departed_at)) / 3600, 2
      );
    ELSE
      NEW.actual_total_hours := NEW.actual_work_hours;
    END IF;
    
    -- Calculate billable hours and pay
    IF NEW.callout_hourly_rate IS NOT NULL THEN
      SELECT * INTO v_pay_result FROM public.calculate_callout_pay(
        NEW.actual_work_hours,
        NEW.minimum_hours,
        NEW.callout_hourly_rate,
        NEW.callout_after_minimum_rate
      );
      
      NEW.billable_hours := v_pay_result.billable_hours;
      NEW.base_pay_amount := v_pay_result.base_pay;
      NEW.additional_pay_amount := v_pay_result.additional_pay;
      NEW.total_pay_amount := v_pay_result.total_pay;
    END IF;
  END IF;
  
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_auto_calculate_callout_pay
  BEFORE UPDATE ON public.callout_shifts
  FOR EACH ROW EXECUTE FUNCTION public.auto_calculate_callout_pay();

-- ────────────────────────────────────────────────────────────────────────────
-- 9. UPDATE ON-CALL PERIOD SUMMARY TRIGGER
-- Updates on_call_periods totals when callouts are completed
-- ────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.update_on_call_period_summary()
RETURNS TRIGGER
LANGUAGE plpgsql AS $$
DECLARE
  v_callout_count INTEGER;
  v_total_hours NUMERIC;
  v_total_pay NUMERIC;
BEGIN
  -- Get aggregated callout stats for the on-call period
  SELECT 
    COUNT(*),
    COALESCE(SUM(billable_hours), 0),
    COALESCE(SUM(total_pay_amount), 0)
  INTO 
    v_callout_count,
    v_total_hours,
    v_total_pay
  FROM public.callout_shifts
  WHERE on_call_period_id = NEW.on_call_period_id
    AND status = 'completed';
  
  -- Update the on-call period
  UPDATE public.on_call_periods
  SET 
    callout_count = v_callout_count,
    total_callout_hours = v_total_hours,
    callout_pay_amount = v_total_pay,
    total_pay_amount = COALESCE(on_call_pay_amount, 0) 
                     + v_total_pay 
                     + COALESCE(travel_pay_amount, 0)
  WHERE id = NEW.on_call_period_id;
  
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_update_on_call_period_summary
  AFTER INSERT OR UPDATE OF status, billable_hours, total_pay_amount ON public.callout_shifts
  FOR EACH ROW 
  WHEN (NEW.status = 'completed')
  EXECUTE FUNCTION public.update_on_call_period_summary();

-- ────────────────────────────────────────────────────────────────────────────
-- 10. ROW LEVEL SECURITY
-- ────────────────────────────────────────────────────────────────────────────

-- Enable RLS on all tables
ALTER TABLE public.office_locations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.on_call_rates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.officer_on_call_rates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.on_call_periods ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.callout_shifts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.travel_allowances ENABLE ROW LEVEL SECURITY;

-- Office Locations: admins manage, all authenticated read
DROP POLICY IF EXISTS "admins_manage_office_locations" ON public.office_locations;
DROP POLICY IF EXISTS "admins_manage_office_locations" ON public.office_locations;
CREATE POLICY "admins_manage_office_locations" ON public.office_locations FOR ALL
  TO authenticated
  USING (get_user_role(auth.uid()) IN ('grand_master', 'master', 'admin', 'admin_officer'))
  WITH CHECK (get_user_role(auth.uid()) IN ('grand_master', 'master', 'admin', 'admin_officer'));

DROP POLICY IF EXISTS "auth_read_office_locations" ON public.office_locations;
DROP POLICY IF EXISTS "auth_read_office_locations" ON public.office_locations;
CREATE POLICY "auth_read_office_locations" ON public.office_locations FOR SELECT
  TO authenticated
  USING (true);

-- On-Call Rates: admins manage
DROP POLICY IF EXISTS "admins_manage_on_call_rates" ON public.on_call_rates;
DROP POLICY IF EXISTS "admins_manage_on_call_rates" ON public.on_call_rates;
CREATE POLICY "admins_manage_on_call_rates" ON public.on_call_rates FOR ALL
  TO authenticated
  USING (get_user_role(auth.uid()) IN ('grand_master', 'master', 'admin', 'admin_officer'))
  WITH CHECK (get_user_role(auth.uid()) IN ('grand_master', 'master', 'admin', 'admin_officer'));

DROP POLICY IF EXISTS "officers_read_on_call_rates" ON public.on_call_rates;
DROP POLICY IF EXISTS "officers_read_on_call_rates" ON public.on_call_rates;
CREATE POLICY "officers_read_on_call_rates" ON public.on_call_rates FOR SELECT
  TO authenticated
  USING (
    organization_id = (SELECT organization_id FROM public.user_profiles WHERE id = auth.uid())
  );

-- Officer On-Call Rates: admins manage, officers read own
DROP POLICY IF EXISTS "admins_manage_officer_on_call_rates" ON public.officer_on_call_rates;
DROP POLICY IF EXISTS "admins_manage_officer_on_call_rates" ON public.officer_on_call_rates;
CREATE POLICY "admins_manage_officer_on_call_rates" ON public.officer_on_call_rates FOR ALL
  TO authenticated
  USING (get_user_role(auth.uid()) IN ('grand_master', 'master', 'admin', 'admin_officer'))
  WITH CHECK (get_user_role(auth.uid()) IN ('grand_master', 'master', 'admin', 'admin_officer'));

DROP POLICY IF EXISTS "officers_read_own_on_call_rates" ON public.officer_on_call_rates;
DROP POLICY IF EXISTS "officers_read_own_on_call_rates" ON public.officer_on_call_rates;
CREATE POLICY "officers_read_own_on_call_rates" ON public.officer_on_call_rates FOR SELECT
  TO authenticated
  USING (officer_id = auth.uid());

-- On-Call Periods: admins manage, officers read/update own
DROP POLICY IF EXISTS "admins_manage_on_call_periods" ON public.on_call_periods;
DROP POLICY IF EXISTS "admins_manage_on_call_periods" ON public.on_call_periods;
CREATE POLICY "admins_manage_on_call_periods" ON public.on_call_periods FOR ALL
  TO authenticated
  USING (get_user_role(auth.uid()) IN ('grand_master', 'master', 'admin', 'admin_officer'))
  WITH CHECK (get_user_role(auth.uid()) IN ('grand_master', 'master', 'admin', 'admin_officer'));

DROP POLICY IF EXISTS "officers_read_own_on_call_periods" ON public.on_call_periods;
DROP POLICY IF EXISTS "officers_read_own_on_call_periods" ON public.on_call_periods;
CREATE POLICY "officers_read_own_on_call_periods" ON public.on_call_periods FOR SELECT
  TO authenticated
  USING (officer_id = auth.uid());

DROP POLICY IF EXISTS "officers_accept_on_call_periods" ON public.on_call_periods;
DROP POLICY IF EXISTS "officers_accept_on_call_periods" ON public.on_call_periods;
CREATE POLICY "officers_accept_on_call_periods" ON public.on_call_periods FOR UPDATE
  TO authenticated
  USING (officer_id = auth.uid() AND status IN ('scheduled', 'active'))
  WITH CHECK (officer_id = auth.uid());

-- Callout Shifts: admins manage, officers manage own during callout
DROP POLICY IF EXISTS "admins_manage_callout_shifts" ON public.callout_shifts;
DROP POLICY IF EXISTS "admins_manage_callout_shifts" ON public.callout_shifts;
CREATE POLICY "admins_manage_callout_shifts" ON public.callout_shifts FOR ALL
  TO authenticated
  USING (get_user_role(auth.uid()) IN ('grand_master', 'master', 'admin', 'admin_officer'))
  WITH CHECK (get_user_role(auth.uid()) IN ('grand_master', 'master', 'admin', 'admin_officer'));

DROP POLICY IF EXISTS "officers_manage_own_callouts" ON public.callout_shifts;
DROP POLICY IF EXISTS "officers_manage_own_callouts" ON public.callout_shifts;
CREATE POLICY "officers_manage_own_callouts" ON public.callout_shifts FOR ALL
  TO authenticated
  USING (officer_id = auth.uid())
  WITH CHECK (officer_id = auth.uid() AND status IN ('pending', 'in_progress'));

-- Travel Allowances: admins manage, officers manage own pending
DROP POLICY IF EXISTS "admins_manage_travel_allowances" ON public.travel_allowances;
DROP POLICY IF EXISTS "admins_manage_travel_allowances" ON public.travel_allowances;
CREATE POLICY "admins_manage_travel_allowances" ON public.travel_allowances FOR ALL
  TO authenticated
  USING (get_user_role(auth.uid()) IN ('grand_master', 'master', 'admin', 'admin_officer'))
  WITH CHECK (get_user_role(auth.uid()) IN ('grand_master', 'master', 'admin', 'admin_officer'));

DROP POLICY IF EXISTS "officers_manage_own_travel" ON public.travel_allowances;
DROP POLICY IF EXISTS "officers_manage_own_travel" ON public.travel_allowances;
CREATE POLICY "officers_manage_own_travel" ON public.travel_allowances FOR ALL
  TO authenticated
  USING (officer_id = auth.uid())
  WITH CHECK (officer_id = auth.uid() AND status = 'pending');

-- ────────────────────────────────────────────────────────────────────────────
-- 11. SEED DEFAULT ON-CALL RATES
-- ────────────────────────────────────────────────────────────────────────────

-- Note: These are example rates. Actual rates should be configured per org.
DO $$
BEGIN
  RAISE NOTICE '✅ Migration 20260511000001 complete:';
  RAISE NOTICE '   • office_locations table created (travel reference points)';
  RAISE NOTICE '   • on_call_rates table created (configurable rate structures)';
  RAISE NOTICE '   • officer_on_call_rates table created (per-officer overrides)';
  RAISE NOTICE '   • on_call_periods table created (on-call availability windows)';
  RAISE NOTICE '   • callout_shifts table created (ad-hoc shifts with 3hr minimum)';
  RAISE NOTICE '   • travel_allowances table created (time/distance tracking)';
  RAISE NOTICE '   • Helper functions: calculate_distance_km, is_within_jurisdiction, calculate_callout_pay';
  RAISE NOTICE '   • Auto-triggers for callout pay calculation and period summary updates';
  RAISE NOTICE '   • RLS policies applied to all tables';
END $$;
