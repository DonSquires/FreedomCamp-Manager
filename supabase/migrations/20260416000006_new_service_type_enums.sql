-- =============================================================================
-- Extend service-type and job-type enums + add radius pricing columns
--
-- Adds 'biosecurity_inspection' and 'smoke_complaint_ooh' to all service_type
-- and job_type CHECK constraints, and adds radius-based distance pricing
-- columns to service_pricing.
-- =============================================================================

-- ── dispatch_jobs.job_type ────────────────────────────────────────────────────
-- Drop old constraint, re-add with new values
ALTER TABLE IF EXISTS public.dispatch_jobs
  DROP CONSTRAINT IF EXISTS dispatch_jobs_job_type_check;
ALTER TABLE IF EXISTS public.dispatch_jobs
  ADD CONSTRAINT dispatch_jobs_job_type_check CHECK (job_type IN (
    'general', 'welfare_check', 'alarm_response', 'patrol',
    'noise_complaint', 'freedom_camping', 'parking',
    'medical', 'fire', 'suspicious_activity', 'escort',
    'lock_unlock', 'property_check', 'vandalism',
    'biosecurity_inspection', 'smoke_complaint_ooh',
    'other'
  ));

-- ── client_org_services.service_type ─────────────────────────────────────────
ALTER TABLE IF EXISTS public.client_org_services
  DROP CONSTRAINT IF EXISTS client_org_services_service_type_check;
ALTER TABLE IF EXISTS public.client_org_services
  ADD CONSTRAINT client_org_services_service_type_check CHECK (service_type IN (
    'freedom_camping', 'guarding', 'parking', 'noise_control', 'patrol',
    'alarm_response', 'ems', 'access_control', 'building_checks',
    'person_of_interest', 'vehicle_of_interest', 'identity_verification',
    'investigation', 'dispatch', 'site_risk_assessment', 'escort',
    'key_holding', 'biosecurity_inspection', 'smoke_complaint_ooh'
  ));

-- ── service_pricing.service_type ─────────────────────────────────────────────
ALTER TABLE IF EXISTS public.service_pricing
  DROP CONSTRAINT IF EXISTS service_pricing_service_type_check;
ALTER TABLE IF EXISTS public.service_pricing
  ADD CONSTRAINT service_pricing_service_type_check CHECK (service_type IN (
    'freedom_camping', 'guarding', 'parking', 'noise_control', 'patrol',
    'alarm_response', 'ems', 'access_control', 'building_checks',
    'person_of_interest', 'vehicle_of_interest', 'identity_verification',
    'investigation', 'dispatch', 'site_risk_assessment', 'escort',
    'key_holding', 'biosecurity_inspection', 'smoke_complaint_ooh'
  ));

-- ── Radius-based distance pricing columns ─────────────────────────────────────
-- radius_pricing_zones: [{label, max_km, flat_fee, per_km_charge}]
-- Tiers are evaluated in ascending max_km order; the first tier whose max_km
-- is >= the actual travel distance applies.
ALTER TABLE IF EXISTS public.service_pricing
  ADD COLUMN IF NOT EXISTS radius_pricing_zones JSONB,
  ADD COLUMN IF NOT EXISTS base_office_lat      NUMERIC(9,6),
  ADD COLUMN IF NOT EXISTS base_office_lng      NUMERIC(9,6);

DO $$
BEGIN
  IF to_regclass('public.service_pricing') IS NOT NULL THEN
    COMMENT ON COLUMN public.service_pricing.radius_pricing_zones IS
      'Radius-based distance pricing tiers. Array of {label, max_km, flat_fee, per_km_charge}. Evaluated ascending by max_km.';
    COMMENT ON COLUMN public.service_pricing.base_office_lat IS
      'Latitude of the service base/office used as the origin for travel distance calculations.';
    COMMENT ON COLUMN public.service_pricing.base_office_lng IS
      'Longitude of the service base/office used as the origin for travel distance calculations.';
  END IF;
END;
$$;

-- ── roster_shifts.service_type (if CHECK constraint exists) ───────────────────
-- Only update if the constraint name is known (safe no-op if not present)
DO $$
BEGIN
  -- roster_shifts
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'roster_shifts_service_type_check'
      AND to_regclass('public.roster_shifts') IS NOT NULL
      AND conrelid = to_regclass('public.roster_shifts')
  ) THEN
    ALTER TABLE public.roster_shifts DROP CONSTRAINT roster_shifts_service_type_check;
    ALTER TABLE public.roster_shifts ADD CONSTRAINT roster_shifts_service_type_check
      CHECK (service_type IN (
        'freedom_camping', 'guarding', 'parking', 'noise', 'patrol',
        'alarm_response', 'ems', 'access_control',
        'biosecurity_inspection', 'smoke_complaint_ooh'
      ));
  END IF;

  -- officer_shifts (if constraint exists)
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'officer_shifts_service_type_check'
      AND to_regclass('public.officer_shifts') IS NOT NULL
      AND conrelid = to_regclass('public.officer_shifts')
  ) THEN
    ALTER TABLE public.officer_shifts DROP CONSTRAINT officer_shifts_service_type_check;
    ALTER TABLE public.officer_shifts ADD CONSTRAINT officer_shifts_service_type_check
      CHECK (service_type IN (
        'freedom_camping', 'guarding', 'parking', 'noise', 'patrol',
        'alarm_response', 'ems', 'access_control',
        'biosecurity_inspection', 'smoke_complaint_ooh'
      ));
  END IF;

  -- officer_activity_rates (if constraint exists)
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'officer_activity_rates_activity_type_check'
      AND to_regclass('public.officer_activity_rates') IS NOT NULL
      AND conrelid = to_regclass('public.officer_activity_rates')
  ) THEN
    ALTER TABLE public.officer_activity_rates DROP CONSTRAINT officer_activity_rates_activity_type_check;
    ALTER TABLE public.officer_activity_rates ADD CONSTRAINT officer_activity_rates_activity_type_check
      CHECK (activity_type IN (
        'freedom_camping', 'guarding', 'parking', 'noise', 'patrol',
        'alarm_response', 'ems', 'access_control',
        'biosecurity_inspection', 'smoke_complaint_ooh'
      ));
  END IF;
END;
$$;
