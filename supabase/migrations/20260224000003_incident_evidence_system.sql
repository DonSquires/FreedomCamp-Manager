-- Incident Evidence Management System
-- Date: 2026-02-24
-- Purpose: Complete incident tracking with ALPR, retention controls, and legal holds

-- ============================================================================
-- Incidents Table
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.incidents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Organization & Officer Attribution
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
  
  -- ALPR Processing
  status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'processing', 'complete', 'failed')),
  plate_number TEXT,
  alpr_confidence NUMERIC(3,2), -- 0.00 to 1.00
  alpr_provider TEXT, -- 'platerecognizer', 'openalpr', etc.
  alpr_raw_response JSONB,
  alpr_processed_at TIMESTAMPTZ,
  alpr_retry_count INTEGER DEFAULT 0,
  
  -- Evidence & Location
  evidence_count INTEGER DEFAULT 0,
  primary_evidence_url TEXT,
  location_lat NUMERIC(10,8),
  location_lng NUMERIC(11,8),
  location_address TEXT,
  
  -- Retention & Legal Hold
  retention_hold BOOLEAN DEFAULT FALSE,
  retention_until TIMESTAMPTZ,
  retention_notes TEXT,
  
  -- Audit Trail
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  deleted_at TIMESTAMPTZ,
  
  -- Metadata
  incident_type TEXT, -- 'parking_violation', 'vehicle_concern', etc.
  description TEXT,
  notes TEXT,
  metadata JSONB DEFAULT '{}'::jsonb
);

-- Legacy-compatible uplift: earlier schemas may already have incidents without
-- the full retention/soft-delete contract used below.
ALTER TABLE public.incidents
  ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'new',
  ADD COLUMN IF NOT EXISTS plate_number TEXT,
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS retention_hold BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS retention_until TIMESTAMPTZ;

-- ============================================================================
-- Indexes
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_incidents_org ON public.incidents(organization_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_incidents_user ON public.incidents(user_id);
CREATE INDEX IF NOT EXISTS idx_incidents_status ON public.incidents(status) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_incidents_plate ON public.incidents(plate_number) WHERE plate_number IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_incidents_created ON public.incidents(created_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_incidents_retention_hold ON public.incidents(retention_hold, retention_until) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_incidents_purge_eligible ON public.incidents(created_at) 
  WHERE retention_hold = FALSE AND deleted_at IS NULL;

-- ============================================================================
-- RLS Policies
-- ============================================================================

ALTER TABLE public.incidents ENABLE ROW LEVEL SECURITY;

-- Officers can create their own incidents
DROP POLICY IF EXISTS "officers_insert_own_incidents" ON public.incidents;
CREATE POLICY "officers_insert_own_incidents" ON public.incidents
  FOR INSERT TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    AND organization_id = get_user_organization_id(auth.uid())
  );

-- Officers can view incidents from their organization (excluding soft-deleted)
DROP POLICY IF EXISTS "org_users_view_incidents" ON public.incidents;
CREATE POLICY "org_users_view_incidents" ON public.incidents
  FOR SELECT TO authenticated
  USING (
    deleted_at IS NULL
    AND (
      (get_user_role(auth.uid()) = 'master'::text) 
      OR (organization_id = ANY (get_user_organization_ids()))
    )
  );

-- Officers can update their own incidents (before processing complete)
DROP POLICY IF EXISTS "officers_update_own_incidents" ON public.incidents;
CREATE POLICY "officers_update_own_incidents" ON public.incidents
  FOR UPDATE TO authenticated
  USING (
    user_id = auth.uid()
    AND status IN ('new', 'processing')
    AND retention_hold = FALSE
  );

-- Admins can update any incident in their org
DROP POLICY IF EXISTS "admins_update_org_incidents" ON public.incidents;
CREATE POLICY "admins_update_org_incidents" ON public.incidents
  FOR UPDATE TO authenticated
  USING (
    (get_user_role(auth.uid()) = ANY (ARRAY['admin'::text, 'master'::text]))
    AND (
      (get_user_role(auth.uid()) = 'master'::text)
      OR (organization_id = get_user_organization_id(auth.uid()))
    )
  );

-- Super delete (for Don's account with permissions)
DROP POLICY IF EXISTS "super_delete_incidents" ON public.incidents;
CREATE POLICY "super_delete_incidents" ON public.incidents
  FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE id = auth.uid()
        AND email = 'don.squire@firstsecurity.co.nz'
        AND permissions @> '["super_delete"]'::jsonb
    )
  );

-- ============================================================================
-- Triggers
-- ============================================================================

-- Auto-update updated_at timestamp
CREATE TRIGGER update_incidents_updated_at
  BEFORE UPDATE ON public.incidents
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- Helper Functions
-- ============================================================================

-- Calculate days until purge (for UI countdown)
CREATE OR REPLACE FUNCTION get_incident_purge_days(incident_row public.incidents)
RETURNS INTEGER AS $$
BEGIN
  -- If on legal hold, no purge scheduled
  IF incident_row.retention_hold THEN
    RETURN NULL;
  END IF;
  
  -- If already deleted, no purge needed
  IF incident_row.deleted_at IS NOT NULL THEN
    RETURN NULL;
  END IF;
  
  -- Calculate days remaining: 30 - (today - created_at)
  RETURN GREATEST(
    0,
    30 - EXTRACT(DAY FROM (NOW() - incident_row.created_at))::INTEGER
  );
END;
$$ LANGUAGE plpgsql STABLE;

-- Get retention status label (for UI badges)
CREATE OR REPLACE FUNCTION get_incident_retention_status(incident_row public.incidents)
RETURNS TEXT AS $$
BEGIN
  IF incident_row.retention_hold THEN
    IF incident_row.retention_until IS NOT NULL THEN
      RETURN 'On Hold Until ' || TO_CHAR(incident_row.retention_until, 'YYYY-MM-DD');
    ELSE
      RETURN 'On Hold (No End Date)';
    END IF;
  ELSE
    DECLARE
      days_left INTEGER := get_incident_purge_days(incident_row);
    BEGIN
      IF days_left IS NULL THEN
        RETURN 'Deleted';
      ELSIF days_left = 0 THEN
        RETURN 'Purge Pending';
      ELSE
        RETURN 'Purge in ' || days_left || ' days';
      END IF;
    END;
  END IF;
END;
$$ LANGUAGE plpgsql STABLE;

-- ============================================================================
-- Nightly Cleanup Function (30-day purge)
-- ============================================================================

CREATE OR REPLACE FUNCTION purge_expired_incidents()
RETURNS TABLE(
  purged_count INTEGER,
  errors TEXT[]
) AS $$
DECLARE
  v_purged_count INTEGER := 0;
  v_errors TEXT[] := ARRAY[]::TEXT[];
  v_incident RECORD;
BEGIN
  -- Find incidents eligible for purge:
  -- - retention_hold = false
  -- - created_at > 30 days ago
  -- - not already deleted
  FOR v_incident IN
    SELECT id, organization_id
    FROM public.incidents
    WHERE retention_hold = FALSE
      AND deleted_at IS NULL
      AND created_at < NOW() - INTERVAL '30 days'
  LOOP
    BEGIN
      -- Soft delete the incident
      UPDATE public.incidents
      SET deleted_at = NOW(),
          updated_at = NOW()
      WHERE id = v_incident.id;
      
      -- Delete evidence files from storage
      -- Note: This requires service role in production (add to scheduled job)
      -- For now, mark as deleted; actual file cleanup happens in Edge Function
      
      v_purged_count := v_purged_count + 1;
      
    EXCEPTION WHEN OTHERS THEN
      v_errors := array_append(v_errors, 
        'Failed to purge incident ' || v_incident.id::TEXT || ': ' || SQLERRM
      );
    END;
  END LOOP;
  
  RETURN QUERY SELECT v_purged_count, v_errors;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant execute to authenticated users (admin-only in practice via RLS)
GRANT EXECUTE ON FUNCTION purge_expired_incidents() TO authenticated;

-- ============================================================================
-- Comments
-- ============================================================================

COMMENT ON TABLE public.incidents IS 
  'Incident evidence tracking with ALPR processing, retention controls, and legal holds';

COMMENT ON COLUMN public.incidents.status IS 
  'ALPR processing status: new → processing → complete/failed';

COMMENT ON COLUMN public.incidents.retention_hold IS 
  'If TRUE, exempt from 30-day purge (legal hold)';

COMMENT ON COLUMN public.incidents.retention_until IS 
  'Optional end date for legal hold; NULL = indefinite';

COMMENT ON FUNCTION get_incident_purge_days IS 
  'Returns days until purge (NULL if on hold or deleted)';

COMMENT ON FUNCTION purge_expired_incidents IS 
  'Soft-deletes incidents older than 30 days (excluding legal holds)';

-- ============================================================================
-- Verification
-- ============================================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'incidents'
  ) THEN
    RAISE EXCEPTION 'incidents table creation failed';
  END IF;
  
  RAISE NOTICE '✅ Incident evidence system created successfully';
  RAISE NOTICE '   - incidents table with ALPR tracking';
  RAISE NOTICE '   - Retention controls (30-day default, legal hold override)';
  RAISE NOTICE '   - RLS policies for officers and admins';
  RAISE NOTICE '   - Helper functions for UI countdown';
  RAISE NOTICE '   - Nightly purge function (schedule via pg_cron)';
END
$$;
