-- Deployment Events Schema
-- Tracks Vercel and other deployment provider webhooks

CREATE TABLE IF NOT EXISTS deployment_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  event_type TEXT NOT NULL CHECK (event_type IN ('deployment.created', 'deployment.succeeded', 'deployment.failed')),
  deployment_id TEXT UNIQUE NOT NULL,
  project_name TEXT NOT NULL,
  url TEXT,
  environment TEXT DEFAULT 'staging' CHECK (environment IN ('development', 'staging', 'production')),
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'success', 'failed')),
  git_commit_sha TEXT,
  git_branch TEXT,
  creator TEXT,
  details JSONB
);

CREATE INDEX idx_deployment_events_deployment_id ON deployment_events(deployment_id);
CREATE INDEX idx_deployment_events_status ON deployment_events(status);
CREATE INDEX idx_deployment_events_created ON deployment_events(created_at DESC);
CREATE INDEX idx_deployment_events_environment ON deployment_events(environment);

-- Enable RLS
ALTER TABLE deployment_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "deployment_events_automation_write"
  ON deployment_events FOR INSERT
  WITH CHECK (TRUE);

CREATE POLICY "deployment_events_admin_read"
  ON deployment_events FOR SELECT
  USING (
    auth.uid() IN (
      SELECT id FROM user_profiles WHERE role IN ('admin', 'master', 'grand_master')
    )
  );
