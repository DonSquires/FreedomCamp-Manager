-- Bug/Issue Reporting System
-- Allows users to report bugs, issues, and feature requests directly from the app
-- Captures system context, screenshots, and console errors automatically

-- Create bug_reports table
CREATE TABLE IF NOT EXISTS public.bug_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
  
  -- Issue Classification
  issue_type TEXT NOT NULL CHECK (issue_type IN ('bug', 'feature_request', 'enhancement', 'performance', 'ui_ux', 'data_issue', 'other')),
  severity TEXT NOT NULL DEFAULT 'medium' CHECK (severity IN ('critical', 'high', 'medium', 'low')),
  priority TEXT DEFAULT 'normal' CHECK (priority IN ('urgent', 'high', 'normal', 'low')),
  
  -- Issue Details
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  steps_to_reproduce TEXT,
  expected_behavior TEXT,
  actual_behavior TEXT,
  
  -- System Context (auto-captured)
  app_version TEXT NOT NULL,
  user_role TEXT NOT NULL,
  current_page TEXT,
  browser_info JSONB DEFAULT '{}',
  device_info JSONB DEFAULT '{}',
  console_errors JSONB DEFAULT '[]',
  network_status TEXT,
  
  -- Attachments
  screenshots TEXT[] DEFAULT ARRAY[]::TEXT[],
  screenshot_metadata JSONB DEFAULT '[]',
  
  -- Status Tracking
  status TEXT DEFAULT 'submitted' CHECK (status IN ('submitted', 'acknowledged', 'investigating', 'in_progress', 'resolved', 'closed', 'wont_fix', 'duplicate')),
  resolution_notes TEXT,
  resolved_by UUID REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  resolved_at TIMESTAMPTZ,
  
  -- AI Processing
  ai_analyzed BOOLEAN DEFAULT false,
  ai_analysis JSONB,
  ai_suggested_fix TEXT,
  requires_human_review BOOLEAN DEFAULT true,
  
  -- Metadata
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  
  -- Communication
  user_notified BOOLEAN DEFAULT false,
  admin_notified BOOLEAN DEFAULT false,
  notification_sent_at TIMESTAMPTZ
);

-- Indexes
CREATE INDEX idx_bug_reports_user ON public.bug_reports(user_id);
CREATE INDEX idx_bug_reports_org ON public.bug_reports(organization_id);
CREATE INDEX idx_bug_reports_status ON public.bug_reports(status);
CREATE INDEX idx_bug_reports_severity ON public.bug_reports(severity);
CREATE INDEX idx_bug_reports_type ON public.bug_reports(issue_type);
CREATE INDEX idx_bug_reports_created ON public.bug_reports(created_at DESC);
CREATE INDEX idx_bug_reports_ai_review ON public.bug_reports(requires_human_review) WHERE requires_human_review = true;

-- Auto-update timestamp
CREATE TRIGGER update_bug_reports_updated_at
  BEFORE UPDATE ON public.bug_reports
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- RLS Policies
ALTER TABLE public.bug_reports ENABLE ROW LEVEL SECURITY;

-- All authenticated users can create reports
CREATE POLICY "users_create_bug_reports"
  ON public.bug_reports FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

-- Users can view their own reports
CREATE POLICY "users_view_own_reports"
  ON public.bug_reports FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

-- ONLY Masters can view all reports
CREATE POLICY "masters_view_all_reports"
  ON public.bug_reports FOR SELECT
  TO authenticated
  USING (get_user_role(auth.uid()) = 'master');

-- ONLY Masters can update reports (status, resolution, etc.)
CREATE POLICY "masters_update_reports"
  ON public.bug_reports FOR UPDATE
  TO authenticated
  USING (get_user_role(auth.uid()) = 'master');

-- ONLY Masters can delete reports
CREATE POLICY "masters_delete_reports"
  ON public.bug_reports FOR DELETE
  TO authenticated
  USING (get_user_role(auth.uid()) = 'master');

-- Create notification trigger for new bug reports
CREATE OR REPLACE FUNCTION notify_admins_new_bug_report()
RETURNS TRIGGER AS $$
BEGIN
  -- Mark that admin notification is needed
  NEW.admin_notified := false;
  
  -- If critical or high severity, set urgent priority
  IF NEW.severity IN ('critical', 'high') THEN
    NEW.priority := 'urgent';
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_notify_admins_new_bug
  BEFORE INSERT ON public.bug_reports
  FOR EACH ROW
  EXECUTE FUNCTION notify_admins_new_bug_report();

-- Helper function to get bug report statistics
CREATE OR REPLACE FUNCTION get_bug_report_stats(org_id UUID DEFAULT NULL)
RETURNS JSONB AS $$
DECLARE
  stats JSONB;
BEGIN
  SELECT jsonb_build_object(
    'total', COUNT(*),
    'by_status', jsonb_object_agg(status, count) FILTER (WHERE status IS NOT NULL),
    'by_severity', jsonb_object_agg(severity, count) FILTER (WHERE severity IS NOT NULL),
    'by_type', jsonb_object_agg(issue_type, count) FILTER (WHERE issue_type IS NOT NULL),
    'critical_open', COUNT(*) FILTER (WHERE severity = 'critical' AND status NOT IN ('resolved', 'closed')),
    'avg_resolution_time_hours', EXTRACT(EPOCH FROM AVG(resolved_at - created_at)) / 3600 FILTER (WHERE resolved_at IS NOT NULL)
  ) INTO stats
  FROM (
    SELECT 
      status,
      severity,
      issue_type,
      COUNT(*) as count,
      resolved_at,
      created_at
    FROM public.bug_reports
    WHERE (org_id IS NULL OR organization_id = org_id)
    GROUP BY status, severity, issue_type, resolved_at, created_at
  ) sub;
  
  RETURN COALESCE(stats, '{}'::jsonb);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON TABLE public.bug_reports IS 'User-submitted bug reports, feature requests, and issue tracking with AI analysis capability';
COMMENT ON COLUMN public.bug_reports.ai_analysis IS 'AI-generated analysis of the issue including potential causes and suggested fixes';
COMMENT ON COLUMN public.bug_reports.requires_human_review IS 'Flag indicating if issue needs human review vs automatic AI handling';
