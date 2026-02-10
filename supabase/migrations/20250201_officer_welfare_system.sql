-- Officer Welfare Checking and Auto-Logoff System
-- Configurable timeframes and GPS-based inactivity monitoring

-- Officer welfare settings table
CREATE TABLE IF NOT EXISTS public.officer_welfare_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
  
  -- Feature toggles
  auto_logoff_enabled BOOLEAN DEFAULT true,
  welfare_check_enabled BOOLEAN DEFAULT true,
  
  -- Auto-logoff timeframes (minutes)
  inactivity_warning_time INTEGER DEFAULT 10,  -- Warning at 10 minutes
  auto_logoff_time INTEGER DEFAULT 20,          -- Logoff at 20 minutes
  
  -- Welfare check timeframes (minutes)
  gps_inactivity_threshold INTEGER DEFAULT 10,  -- First check at 10 minutes
  admin_escalation_time INTEGER DEFAULT 5,      -- Escalate to high priority after 5 minutes
  critical_escalation_time INTEGER DEFAULT 5,   -- Escalate to critical after another 5 minutes
  
  -- Investigation exception
  investigation_exception_enabled BOOLEAN DEFAULT true,
  
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  
  UNIQUE(user_id)
);

-- Officer activity tracking table
CREATE TABLE IF NOT EXISTS public.officer_activity_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  
  -- Activity types: 'vehicle_scan', 'gps_update', 'investigation_start', 'investigation_end', 'login', 'logout'
  activity_type TEXT NOT NULL,
  
  -- GPS location
  gps_latitude NUMERIC(10, 8),
  gps_longitude NUMERIC(11, 8),
  gps_accuracy NUMERIC(10, 2),
  
  -- Metadata
  metadata JSONB DEFAULT '{}',
  
  recorded_at TIMESTAMPTZ DEFAULT now(),
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Welfare check alerts table
CREATE TABLE IF NOT EXISTS public.officer_welfare_alerts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  officer_id UUID NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  
  -- Alert types: 'inactivity_warning', 'welfare_check', 'admin_escalation', 'critical_escalation'
  alert_type TEXT NOT NULL,
  
  -- Alert status: 'pending', 'acknowledged', 'resolved', 'expired'
  status TEXT DEFAULT 'pending',
  
  -- Officer details at time of alert
  officer_name TEXT NOT NULL,
  officer_phone TEXT,
  
  -- GPS location
  gps_latitude NUMERIC(10, 8),
  gps_longitude NUMERIC(11, 8),
  gps_accuracy NUMERIC(10, 2),
  last_activity_at TIMESTAMPTZ NOT NULL,
  
  -- Alert timing
  alert_sent_at TIMESTAMPTZ DEFAULT now(),
  acknowledged_at TIMESTAMPTZ,
  acknowledged_by UUID REFERENCES public.user_profiles(id),
  resolved_at TIMESTAMPTZ,
  resolved_by UUID REFERENCES public.user_profiles(id),
  
  -- Escalation tracking
  escalation_level INTEGER DEFAULT 1,  -- 1=initial, 2=admin, 3=critical
  escalated_at TIMESTAMPTZ,
  
  -- Notes and resolution
  acknowledgement_notes TEXT,
  resolution_notes TEXT,
  
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Indices for performance
CREATE INDEX IF NOT EXISTS idx_welfare_settings_user ON public.officer_welfare_settings(user_id);
CREATE INDEX IF NOT EXISTS idx_welfare_settings_org ON public.officer_welfare_settings(organization_id);

CREATE INDEX IF NOT EXISTS idx_activity_log_user ON public.officer_activity_log(user_id);
CREATE INDEX IF NOT EXISTS idx_activity_log_type ON public.officer_activity_log(activity_type);
CREATE INDEX IF NOT EXISTS idx_activity_log_recorded ON public.officer_activity_log(recorded_at);

CREATE INDEX IF NOT EXISTS idx_welfare_alerts_officer ON public.officer_welfare_alerts(officer_id);
CREATE INDEX IF NOT EXISTS idx_welfare_alerts_status ON public.officer_welfare_alerts(status);
CREATE INDEX IF NOT EXISTS idx_welfare_alerts_type ON public.officer_welfare_alerts(alert_type);
CREATE INDEX IF NOT EXISTS idx_welfare_alerts_escalation ON public.officer_welfare_alerts(escalation_level);

-- RLS Policies

-- officer_welfare_settings
ALTER TABLE public.officer_welfare_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admins_manage_welfare_settings"
  ON public.officer_welfare_settings FOR ALL
  TO authenticated
  USING (
    (get_user_role(auth.uid()) = ANY (ARRAY['admin'::text, 'master'::text]))
    AND (
      (get_user_role(auth.uid()) = 'master'::text)
      OR (organization_id = get_user_organization_id(auth.uid()))
    )
  )
  WITH CHECK (
    (get_user_role(auth.uid()) = ANY (ARRAY['admin'::text, 'master'::text]))
    AND (
      (get_user_role(auth.uid()) = 'master'::text)
      OR (organization_id = get_user_organization_id(auth.uid()))
    )
  );

CREATE POLICY "officers_view_own_settings"
  ON public.officer_welfare_settings FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

-- officer_activity_log
ALTER TABLE public.officer_activity_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "officers_create_activity_log"
  ON public.officer_activity_log FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "admins_view_activity_log"
  ON public.officer_activity_log FOR SELECT
  TO authenticated
  USING (
    (get_user_role(auth.uid()) = ANY (ARRAY['admin'::text, 'master'::text]))
    AND (
      (get_user_role(auth.uid()) = 'master'::text)
      OR (organization_id = get_user_organization_id(auth.uid()))
    )
  );

CREATE POLICY "officers_view_own_activity"
  ON public.officer_activity_log FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "service_role_insert_activity"
  ON public.officer_activity_log FOR INSERT
  TO service_role
  WITH CHECK (true);

-- officer_welfare_alerts
ALTER TABLE public.officer_welfare_alerts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admins_manage_welfare_alerts"
  ON public.officer_welfare_alerts FOR ALL
  TO authenticated
  USING (
    (get_user_role(auth.uid()) = ANY (ARRAY['admin'::text, 'master'::text]))
    AND (
      (get_user_role(auth.uid()) = 'master'::text)
      OR (organization_id = get_user_organization_id(auth.uid()))
    )
  )
  WITH CHECK (
    (get_user_role(auth.uid()) = ANY (ARRAY['admin'::text, 'master'::text]))
    AND (
      (get_user_role(auth.uid()) = 'master'::text)
      OR (organization_id = get_user_organization_id(auth.uid()))
    )
  );

CREATE POLICY "officers_view_own_alerts"
  ON public.officer_welfare_alerts FOR SELECT
  TO authenticated
  USING (officer_id = auth.uid());

CREATE POLICY "service_role_manage_alerts"
  ON public.officer_welfare_alerts FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_welfare_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Triggers for updated_at
CREATE TRIGGER update_welfare_settings_updated_at
  BEFORE UPDATE ON public.officer_welfare_settings
  FOR EACH ROW
  EXECUTE FUNCTION update_welfare_updated_at();

CREATE TRIGGER update_welfare_alerts_updated_at
  BEFORE UPDATE ON public.officer_welfare_alerts
  FOR EACH ROW
  EXECUTE FUNCTION update_welfare_updated_at();

-- Function to create default welfare settings for new officers
CREATE OR REPLACE FUNCTION create_default_welfare_settings()
RETURNS TRIGGER AS $$
BEGIN
  -- Only create for officer role
  IF NEW.role = 'officer' AND NEW.organization_id IS NOT NULL THEN
    INSERT INTO public.officer_welfare_settings (
      organization_id,
      user_id,
      auto_logoff_enabled,
      welfare_check_enabled,
      inactivity_warning_time,
      auto_logoff_time,
      gps_inactivity_threshold,
      admin_escalation_time,
      critical_escalation_time,
      investigation_exception_enabled
    ) VALUES (
      NEW.organization_id,
      NEW.id,
      true,
      true,
      10,
      20,
      10,
      5,
      5,
      true
    )
    ON CONFLICT (user_id) DO NOTHING;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER create_default_welfare_settings_trigger
  AFTER INSERT ON public.user_profiles
  FOR EACH ROW
  EXECUTE FUNCTION create_default_welfare_settings();

-- Function to log officer activity
CREATE OR REPLACE FUNCTION log_officer_activity(
  p_user_id UUID,
  p_activity_type TEXT,
  p_gps_latitude NUMERIC DEFAULT NULL,
  p_gps_longitude NUMERIC DEFAULT NULL,
  p_gps_accuracy NUMERIC DEFAULT NULL,
  p_metadata JSONB DEFAULT '{}'
)
RETURNS UUID AS $$
DECLARE
  v_org_id UUID;
  v_activity_id UUID;
BEGIN
  -- Get user's organization
  SELECT organization_id INTO v_org_id
  FROM public.user_profiles
  WHERE id = p_user_id;
  
  -- Insert activity log
  INSERT INTO public.officer_activity_log (
    user_id,
    organization_id,
    activity_type,
    gps_latitude,
    gps_longitude,
    gps_accuracy,
    metadata,
    recorded_at
  ) VALUES (
    p_user_id,
    v_org_id,
    p_activity_type,
    p_gps_latitude,
    p_gps_longitude,
    p_gps_accuracy,
    p_metadata,
    now()
  )
  RETURNING id INTO v_activity_id;
  
  RETURN v_activity_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant execute permissions
GRANT EXECUTE ON FUNCTION log_officer_activity TO authenticated, service_role;

COMMENT ON TABLE public.officer_welfare_settings IS 'Configurable welfare check and auto-logoff settings per officer';
COMMENT ON TABLE public.officer_activity_log IS 'Tracks all officer activity including GPS updates and vehicle scans';
COMMENT ON TABLE public.officer_welfare_alerts IS 'Welfare check alerts with escalation levels and acknowledgement tracking';
