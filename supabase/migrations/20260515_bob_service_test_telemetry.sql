-- Bob Service Test Telemetry Schema
-- Tracks performance, coverage, and results of Bob's self-test suite

CREATE TABLE IF NOT EXISTS bob_service_test_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  test_tier TEXT NOT NULL CHECK (test_tier IN ('web', 'mobile', 'voice', 'chaos', 'all')),
  duration_ms INT,
  passed BOOLEAN NOT NULL,
  failed_reason TEXT,
  test_count INT,
  pass_count INT,
  skip_count INT,
  workflow_id TEXT,
  branch TEXT,
  commit_sha TEXT,
  environment TEXT DEFAULT 'staging' CHECK (environment IN ('development', 'staging', 'production'))
);

CREATE TABLE IF NOT EXISTS bob_service_test_cases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  test_run_id UUID REFERENCES bob_service_test_runs(id) ON DELETE CASCADE,
  test_name TEXT NOT NULL,
  test_tier TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('passed', 'failed', 'skipped', 'timeout')),
  duration_ms INT,
  error_message TEXT,
  stack_trace TEXT
);

CREATE TABLE IF NOT EXISTS bob_service_coverage (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  test_run_id UUID REFERENCES bob_service_test_runs(id) ON DELETE CASCADE,
  surface TEXT NOT NULL,
  coverage_percent NUMERIC(5,2),
  lines_tested INT,
  lines_total INT,
  critical_path BOOLEAN
);

CREATE TABLE IF NOT EXISTS bob_inference_health (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  provider TEXT NOT NULL,
  response_time_ms INT,
  token_usage INT,
  model TEXT,
  success BOOLEAN NOT NULL,
  error_type TEXT
);

-- Indexes for query performance
CREATE INDEX idx_bob_service_test_runs_tier ON bob_service_test_runs(test_tier);
CREATE INDEX idx_bob_service_test_runs_created ON bob_service_test_runs(created_at DESC);
CREATE INDEX idx_bob_service_test_cases_run ON bob_service_test_cases(test_run_id);
CREATE INDEX idx_bob_service_test_cases_status ON bob_service_test_cases(status);
CREATE INDEX idx_bob_inference_health_provider ON bob_inference_health(provider);
CREATE INDEX idx_bob_inference_health_created ON bob_inference_health(created_at DESC);

-- Enable RLS for multi-tenancy
ALTER TABLE bob_service_test_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE bob_service_test_cases ENABLE ROW LEVEL SECURITY;
ALTER TABLE bob_service_coverage ENABLE ROW LEVEL SECURITY;
ALTER TABLE bob_inference_health ENABLE ROW LEVEL SECURITY;

-- RLS Policy: Only service/automation writes; admins can read
CREATE POLICY "bob_service_test_runs_automation_write"
  ON bob_service_test_runs FOR INSERT
  WITH CHECK (TRUE);

CREATE POLICY "bob_service_test_runs_admin_read"
  ON bob_service_test_runs FOR SELECT
  USING (
    auth.uid() IN (
      SELECT id FROM user_profiles WHERE role IN ('admin', 'master', 'grand_master')
    )
  );

-- Similar policies for test_cases, coverage, and health
CREATE POLICY "bob_service_test_cases_automation_write"
  ON bob_service_test_cases FOR INSERT
  WITH CHECK (TRUE);

CREATE POLICY "bob_service_test_cases_admin_read"
  ON bob_service_test_cases FOR SELECT
  USING (
    auth.uid() IN (
      SELECT id FROM user_profiles WHERE role IN ('admin', 'master', 'grand_master')
    )
  );

CREATE POLICY "bob_inference_health_automation_write"
  ON bob_inference_health FOR INSERT
  WITH CHECK (TRUE);

CREATE POLICY "bob_inference_health_admin_read"
  ON bob_inference_health FOR SELECT
  USING (
    auth.uid() IN (
      SELECT id FROM user_profiles WHERE role IN ('admin', 'master', 'grand_master')
    )
  );
