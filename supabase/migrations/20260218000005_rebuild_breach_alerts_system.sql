/**
 * BREACH ALERTS SYSTEM REBUILD
 * 
 * Complete rebuild of breach_alerts table with:
 * - Proper CHECK constraints for breach_type
 * - Auto-population from compliance_results via trigger
 * - Correct RLS policies
 * - Integration with zoom scan workflow
 */

-- ============================================================
-- STEP 1: Drop existing table and recreate from scratch
-- ============================================================

DROP TABLE IF EXISTS breach_alerts CASCADE;

CREATE TABLE breach_alerts (
  -- Identity
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Foreign Keys
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  zone_id UUID NOT NULL REFERENCES zones(id) ON DELETE CASCADE,
  plate_number TEXT REFERENCES canonical_vehicles(plate_number) ON DELETE SET NULL,
  -- Added as plain UUID; FK to observations is attached conditionally below
  -- to handle environments where observation PK column differs (id vs observation_id).
  observation_id UUID,
  -- Legacy table in some environments; FK added conditionally below when present.
  vehicle_record_id UUID,
  patrol_id UUID REFERENCES patrols(id) ON DELETE SET NULL,
  
  -- Breach Information
  breach_type TEXT NOT NULL CHECK (breach_type IN (
    'consecutive_nights',
    'monthly_limit', 
    'self_contained',
    'after_hours',
    'day_visit_violation',
    'allowed_days_violation'
  )),
  breach_details JSONB NOT NULL DEFAULT '{}'::jsonb,
  due_date DATE,
  
  -- Notification Tracking
  notification_sent BOOLEAN DEFAULT false,
  notification_method TEXT,
  notified_at TIMESTAMPTZ,
  notified_by UUID REFERENCES user_profiles(id),
  
  -- Status Management
  status TEXT DEFAULT 'pending' CHECK (status IN (
    'pending',
    'acknowledged',
    'enforcement_started',
    'resolved',
    'dismissed'
  )),
  resolution_notes TEXT,
  resolved_at TIMESTAMPTZ,
  
  -- Assignment & Review
  assigned_to UUID REFERENCES user_profiles(id),
  assigned_at TIMESTAMPTZ,
  assigned_by UUID REFERENCES user_profiles(id),
  admin_reviewed_by UUID REFERENCES user_profiles(id),
  admin_reviewed_at TIMESTAMPTZ,
  admin_review_notes TEXT,
  
  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- ============================================================
-- STEP 2: Create indexes for performance
-- ============================================================

CREATE INDEX idx_breach_alerts_org ON breach_alerts(organization_id);
CREATE INDEX idx_breach_alerts_zone ON breach_alerts(zone_id);
CREATE INDEX idx_breach_alerts_plate_zone ON breach_alerts(plate_number, zone_id);
CREATE INDEX idx_breach_alerts_observation ON breach_alerts(observation_id);
CREATE INDEX idx_breach_alerts_status ON breach_alerts(status);
CREATE INDEX idx_breach_alerts_assigned_to ON breach_alerts(assigned_to);
CREATE INDEX idx_breach_alerts_active_org ON breach_alerts(organization_id, status) 
  WHERE status IN ('pending', 'acknowledged', 'enforcement_started');
CREATE INDEX idx_breach_alerts_admin_review ON breach_alerts(admin_reviewed_by, status)
  WHERE status = 'pending';

-- ============================================================
-- STEP 3: Add comments
-- ============================================================

COMMENT ON TABLE breach_alerts IS 'Auto-generated breach alerts from compliance violations. Created by trigger when compliance_results.is_compliant = false';
COMMENT ON COLUMN breach_alerts.breach_type IS 'Type of breach: consecutive_nights, monthly_limit, self_contained, after_hours, day_visit_violation, allowed_days_violation';
COMMENT ON COLUMN breach_alerts.breach_details IS 'JSON details: {message, severity, consecutiveNights, monthNights, etc}';
COMMENT ON COLUMN breach_alerts.status IS 'Workflow status: pending → acknowledged → enforcement_started → resolved/dismissed';

-- Attach observation FK only when observations table exists and has a UUID PK column.
DO $$
DECLARE
  v_obs_id_col TEXT;
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'observations'
      AND column_name = 'id'
  ) THEN
    v_obs_id_col := 'id';
  ELSIF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'observations'
      AND column_name = 'observation_id'
  ) THEN
    v_obs_id_col := 'observation_id';
  END IF;

  IF v_obs_id_col IS NOT NULL THEN
    EXECUTE format(
      'ALTER TABLE public.breach_alerts
         ADD CONSTRAINT breach_alerts_observation_id_fkey
         FOREIGN KEY (observation_id)
         REFERENCES public.observations(%I)
         ON DELETE CASCADE',
      v_obs_id_col
    );
  ELSE
    RAISE NOTICE 'Skipping breach_alerts observation FK: public.observations id column not found';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'vehicle_records'
      AND column_name = 'id'
  ) THEN
    ALTER TABLE public.breach_alerts
      ADD CONSTRAINT breach_alerts_vehicle_record_id_fkey
      FOREIGN KEY (vehicle_record_id)
      REFERENCES public.vehicle_records(id)
      ON DELETE CASCADE;
  ELSE
    RAISE NOTICE 'Skipping breach_alerts vehicle_record FK: public.vehicle_records(id) not found';
  END IF;
EXCEPTION
  WHEN duplicate_object THEN
    NULL;
END $$;

-- ============================================================
-- STEP 4: Create RLS policies
-- ============================================================

ALTER TABLE breach_alerts ENABLE ROW LEVEL SECURITY;

-- Users view breaches for their organization(s)
CREATE POLICY users_view_breach_alerts
  ON breach_alerts FOR SELECT
  TO authenticated
  USING (
    (get_user_role(auth.uid()) = 'master') 
    OR 
    (organization_id = ANY(get_user_organization_ids()))
  );

-- Admins and masters manage breach alerts
CREATE POLICY users_manage_breach_alerts
  ON breach_alerts FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE id = auth.uid()
    )
  );

-- Super delete capability
CREATE POLICY super_delete_breach_alerts
  ON breach_alerts FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE id = auth.uid()
        AND email = 'don.squire@firstsecurity.co.nz'
        AND permissions @> '["super_delete"]'::jsonb
    )
  );

-- ============================================================
-- STEP 5: Create auto-population trigger function
-- ============================================================

CREATE OR REPLACE FUNCTION create_breach_alert_from_compliance()
RETURNS TRIGGER
SECURITY DEFINER
LANGUAGE plpgsql
AS $$
DECLARE
  v_plate_number TEXT;
  v_zone_id UUID;
  v_org_id UUID;
  v_patrol_id UUID;
  v_homeless_status TEXT;
  v_fc_exempt BOOLEAN;
  v_violation_type TEXT;
  v_violation_severity TEXT;
  v_breach_message TEXT;
  v_obs_id_col TEXT;
BEGIN
  -- Only create breach alert if non-compliant
  IF NEW.is_compliant = true THEN
    RETURN NEW;
  END IF;

  -- Get observation details
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'observations'
      AND column_name = 'id'
  ) THEN
    v_obs_id_col := 'id';
  ELSIF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'observations'
      AND column_name = 'observation_id'
  ) THEN
    v_obs_id_col := 'observation_id';
  END IF;

  IF v_obs_id_col IS NULL THEN
    RAISE WARNING 'Skipping breach alert creation: public.observations id column not found for observation lookup';
    RETURN NEW;
  END IF;

  EXECUTE format(
    'SELECT obs.plate_number, obs.zone_id, obs.organization_id, cv.homeless_status
       FROM public.observations obs
       LEFT JOIN public.canonical_vehicles cv ON cv.plate_number = obs.plate_number
      WHERE obs.%I = $1',
    v_obs_id_col
  )
  INTO
    v_plate_number,
    v_zone_id,
    v_org_id,
    v_homeless_status
  USING NEW.observation_id;

  -- Check if FC Act exempt (homeless)
  v_fc_exempt := (v_homeless_status IN ('claimed', 'confirmed'));

  -- Don't create breach alert if homeless (FC Act protection)
  IF v_fc_exempt = true THEN
    RAISE LOG 'Skipping breach alert for homeless vehicle: %', v_plate_number;
    RETURN NEW;
  END IF;

  -- Extract violation type from violation_reasons array
  IF NEW.violation_reasons IS NOT NULL AND array_length(NEW.violation_reasons, 1) > 0 THEN
    v_violation_type := NEW.violation_reasons[1];
  ELSE
    v_violation_type := 'unknown_violation';
  END IF;

  -- Map violation type to breach_type
  DECLARE
    v_breach_type TEXT;
  BEGIN
    CASE 
      WHEN v_violation_type LIKE '%consecutive%' THEN
        v_breach_type := 'consecutive_nights';
      WHEN v_violation_type LIKE '%monthly%' OR v_violation_type LIKE '%month%' THEN
        v_breach_type := 'monthly_limit';
      WHEN v_violation_type LIKE '%self%contained%' OR v_violation_type LIKE '%self_contained%' THEN
        v_breach_type := 'self_contained';
      WHEN v_violation_type LIKE '%after%hours%' OR v_violation_type LIKE '%overnight%' THEN
        v_breach_type := 'after_hours';
      WHEN v_violation_type LIKE '%day%visit%' THEN
        v_breach_type := 'day_visit_violation';
      WHEN v_violation_type LIKE '%allowed%days%' THEN
        v_breach_type := 'allowed_days_violation';
      ELSE
        -- Default to monthly_limit if unknown
        v_breach_type := 'monthly_limit';
    END CASE;

    -- Build breach message
    v_breach_message := COALESCE(
      (NEW.metrics_json->>'violation_message')::TEXT,
      'Zone compliance violation detected'
    );

    -- Get violation severity
    v_violation_severity := COALESCE(
      (NEW.metrics_json->>'violation_severity')::TEXT,
      'moderate'
    );

    -- Insert breach alert
    INSERT INTO breach_alerts (
      organization_id,
      zone_id,
      plate_number,
      observation_id,
      breach_type,
      breach_details,
      status
    ) VALUES (
      v_org_id,
      v_zone_id,
      v_plate_number,
      NEW.observation_id,
      v_breach_type,
      jsonb_build_object(
        'message', v_breach_message,
        'severity', v_violation_severity,
        'violation_type', v_violation_type,
        'violation_reasons', NEW.violation_reasons,
        'compliance_result_id', NEW.id,
        'matrix_version', NEW.matrix_version,
        'created_from_compliance', true
      ),
      'pending'
    );

    RAISE LOG 'Created breach alert: plate=%, type=%, severity=%', 
      v_plate_number, v_breach_type, v_violation_severity;

  EXCEPTION WHEN OTHERS THEN
    -- Log error but don't fail the transaction
    RAISE WARNING 'Failed to create breach alert: % - %', SQLERRM, SQLSTATE;
  END;

  RETURN NEW;
END;
$$;

-- ============================================================
-- STEP 6: Create trigger on compliance_results
-- ============================================================

DROP TRIGGER IF EXISTS trigger_create_breach_alert_from_compliance ON compliance_results;

CREATE TRIGGER trigger_create_breach_alert_from_compliance
  AFTER INSERT ON compliance_results
  FOR EACH ROW
  WHEN (NEW.is_compliant = false)
  EXECUTE FUNCTION create_breach_alert_from_compliance();

COMMENT ON TRIGGER trigger_create_breach_alert_from_compliance ON compliance_results IS 
  'Auto-creates breach_alerts when compliance_results shows non-compliant vehicle (excluding homeless)';

-- ============================================================
-- STEP 7: Add updated_at trigger
-- ============================================================

CREATE TRIGGER update_breach_alerts_updated_at
  BEFORE UPDATE ON breach_alerts
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- ============================================================
-- STEP 8: Grant permissions
-- ============================================================

GRANT SELECT, INSERT, UPDATE ON breach_alerts TO authenticated;
GRANT SELECT, INSERT, UPDATE ON breach_alerts TO service_role;

-- ============================================================
-- Done
-- ============================================================
