-- =============================================================================
-- Cleanup Migration: Clear Operational Data (keep users + storage buckets)
-- Date: 2026-05-15
-- 
-- Truncates/deletes all operational records (zones, incidents, patrols, etc.)
-- while preserving:
--   - All users, user_profiles, auth data
--   - All storage bucket files and references
--   - All organization definitions (for fresh seeding)
-- =============================================================================

BEGIN;

-- Temporarily disable foreign key constraints to allow clean truncation
SET session_replication_role = 'replica';

-- Delete operational data (defensive: only if tables exist)
DO $$
BEGIN
  DELETE FROM public.observations;
  EXCEPTION WHEN undefined_table THEN NULL;
END $$;

DO $$
BEGIN
  DELETE FROM public.incident_media;
  EXCEPTION WHEN undefined_table THEN NULL;
END $$;

DO $$
BEGIN
  DELETE FROM public.incident_notes;
  EXCEPTION WHEN undefined_table THEN NULL;
END $$;

DELETE FROM public.incidents;
DELETE FROM public.breach_alerts;

DO $$
BEGIN
  DELETE FROM public.patrol_media;
  EXCEPTION WHEN undefined_table THEN NULL;
END $$;

DO $$
BEGIN
  DELETE FROM public.patrol_notes;
  EXCEPTION WHEN undefined_table THEN NULL;
END $$;

DELETE FROM public.patrols;

DO $$
BEGIN
  DELETE FROM public.patrol_checkpoints;
  EXCEPTION WHEN undefined_table THEN NULL;
END $$;

DELETE FROM public.client_sites;
DELETE FROM public.geo_zones;
DELETE FROM public.zones;

-- Optional: Clear org-scoped transactional data if they exist
DO $$
BEGIN
  DELETE FROM public.telemetry_events WHERE event_type IN ('breach_detected', 'zone_entered', 'patrol_started');
  EXCEPTION WHEN undefined_table THEN NULL;
END $$;

DO $$
BEGIN
  DELETE FROM public.audit_logs WHERE resource_type IN ('incident', 'patrol', 'zone', 'geo_zone');
  EXCEPTION WHEN undefined_table THEN NULL;
END $$;

-- Re-enable foreign key constraints
SET session_replication_role = 'origin';

-- Log the cleanup completion
DO $$
BEGIN
  RAISE NOTICE 'Operational data cleanup complete. Users, storage buckets, and organizations preserved.';
END $$;

COMMIT;
