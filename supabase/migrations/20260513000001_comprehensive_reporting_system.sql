-- ============================================================================
-- Comprehensive Reporting System
-- Date: 2026-05-13
--
-- Implements a flexible reporting system that allows admins to:
--   1. Build custom reports from any data source
--   2. Save report templates for reuse
--   3. Schedule automatic report generation
--   4. Export to CSV, PDF, and Excel formats
--   5. Track report generation history
--
-- Design Principle: Use JSONB for maximum flexibility so users can create
-- custom reports without needing schema changes.
-- ============================================================================

-- ────────────────────────────────────────────────────────────────────────────
-- 1. REPORT DATA SOURCES
-- Defines available tables/views that can be used in reports
-- ────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.report_data_sources (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  
  code              TEXT        NOT NULL UNIQUE,  -- 'observations', 'vehicles', etc.
  name              TEXT        NOT NULL,         -- Display name
  description       TEXT,
  
  -- Source configuration
  source_table      TEXT        NOT NULL,         -- Actual table/view name
  source_schema     TEXT        NOT NULL DEFAULT 'public',
  
  -- Field definitions (columns available for selection)
  -- Array of { key, label, type, format?, aggregate? }
  available_fields  JSONB       NOT NULL DEFAULT '[]'::JSONB,
  
  -- Default fields for quick start
  default_fields    TEXT[]      DEFAULT ARRAY[]::TEXT[],
  
  -- Filters available for this source
  -- Array of { key, label, type, options? }
  available_filters JSONB       NOT NULL DEFAULT '[]'::JSONB,
  
  -- Joins to other tables
  -- Array of { target_source, join_type, local_key, foreign_key }
  available_joins   JSONB       DEFAULT '[]'::JSONB,
  
  -- Aggregations supported
  supports_grouping BOOLEAN     NOT NULL DEFAULT true,
  supports_charts   BOOLEAN     NOT NULL DEFAULT false,
  
  -- Access control
  required_role     TEXT        DEFAULT 'admin',
  
  -- Organization scope (null = all orgs can use)
  organization_id   UUID        REFERENCES public.organizations(id) ON DELETE CASCADE,
  
  is_active         BOOLEAN     NOT NULL DEFAULT true,
  is_system         BOOLEAN     NOT NULL DEFAULT true,  -- Prevent deletion
  
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_report_data_sources_code
  ON public.report_data_sources(code);

CREATE INDEX IF NOT EXISTS idx_report_data_sources_org
  ON public.report_data_sources(organization_id);

ALTER TABLE public.report_data_sources ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "admins_manage_report_data_sources" ON public.report_data_sources;
DROP POLICY IF EXISTS "admins_manage_report_data_sources" ON public.report_data_sources;
CREATE POLICY "admins_manage_report_data_sources" ON public.report_data_sources FOR ALL
  TO authenticated
  USING (
    get_user_role(auth.uid()) IN ('grand_master', 'master', 'admin')
  )
  WITH CHECK (
    get_user_role(auth.uid()) IN ('grand_master', 'master', 'admin')
  );

DROP POLICY IF EXISTS "auth_read_report_data_sources" ON public.report_data_sources;
DROP POLICY IF EXISTS "auth_read_report_data_sources" ON public.report_data_sources;
CREATE POLICY "auth_read_report_data_sources" ON public.report_data_sources FOR SELECT
  TO authenticated
  USING (is_active = true);

COMMENT ON TABLE public.report_data_sources IS 
  'Defines available data sources for the custom report builder. Each source maps to a database table/view.';


-- ────────────────────────────────────────────────────────────────────────────
-- 2. REPORT TEMPLATES
-- User-created report definitions
-- ────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.report_templates (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   UUID        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  
  -- Template identity
  name              TEXT        NOT NULL,
  description       TEXT,
  category          TEXT        NOT NULL DEFAULT 'general'
    CHECK (category IN (
      'compliance',        -- Compliance and breach reports
      'operations',        -- Patrol, shift, roster reports
      'financial',         -- Payroll, allowances, invoicing
      'workforce',         -- Officers, skills, training
      'assets',            -- Equipment, keys, uniforms
      'incidents',         -- Incidents, H&S reports
      'analytics',         -- Charts and analytics
      'custom',            -- User-defined
      'general'
    )),
  
  -- Data source (primary)
  data_source_id    UUID        NOT NULL REFERENCES public.report_data_sources(id) ON DELETE CASCADE,
  
  -- Report configuration (JSONB for flexibility)
  config            JSONB       NOT NULL DEFAULT '{}'::JSONB,
  /*
    config structure:
    {
      "selectedFields": ["plate_number", "zone_name", "recorded_at"],
      "filters": [
        { "field": "is_compliant", "operator": "eq", "value": false },
        { "field": "recorded_at", "operator": "gte", "value": "$date_from" }
      ],
      "groupBy": ["zone_id"],
      "aggregations": [
        { "field": "id", "function": "count", "alias": "total_count" }
      ],
      "sortBy": [
        { "field": "recorded_at", "direction": "desc" }
      ],
      "joins": [
        { "source": "zones", "on": "zone_id" }
      ],
      "displayOptions": {
        "showTotals": true,
        "showCharts": false,
        "chartType": "bar"
      }
    }
  */
  
  -- Output format preferences
  default_format    TEXT        NOT NULL DEFAULT 'csv'
    CHECK (default_format IN ('csv', 'pdf', 'excel', 'html', 'json')),
  
  pdf_settings      JSONB       DEFAULT '{}'::JSONB,  -- Page size, orientation, etc.
  
  -- Sharing settings
  is_public         BOOLEAN     NOT NULL DEFAULT false,  -- Visible to all org users
  shared_with       UUID[]      DEFAULT ARRAY[]::UUID[],  -- Specific users
  
  -- Access control
  created_by        UUID        NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
  
  is_active         BOOLEAN     NOT NULL DEFAULT true,
  is_favorite       BOOLEAN     NOT NULL DEFAULT false,
  
  -- Statistics
  run_count         INTEGER     NOT NULL DEFAULT 0,
  last_run_at       TIMESTAMPTZ,
  
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_report_templates_org
  ON public.report_templates(organization_id, is_active);

CREATE INDEX IF NOT EXISTS idx_report_templates_creator
  ON public.report_templates(created_by);

CREATE INDEX IF NOT EXISTS idx_report_templates_category
  ON public.report_templates(organization_id, category);

CREATE INDEX IF NOT EXISTS idx_report_templates_name
  ON public.report_templates USING gin (to_tsvector('english', name || ' ' || COALESCE(description, '')));

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION public.update_report_templates_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

CREATE TRIGGER trg_report_templates_updated_at
  BEFORE UPDATE ON public.report_templates
  FOR EACH ROW EXECUTE FUNCTION public.update_report_templates_updated_at();

ALTER TABLE public.report_templates ENABLE ROW LEVEL SECURITY;

-- Admins manage all templates in their org
DROP POLICY IF EXISTS "admins_manage_report_templates" ON public.report_templates;
DROP POLICY IF EXISTS "admins_manage_report_templates" ON public.report_templates;
CREATE POLICY "admins_manage_report_templates" ON public.report_templates FOR ALL
  TO authenticated
  USING (
    organization_id IN (
      SELECT organization_id FROM public.user_profiles WHERE id = auth.uid()
    ) AND get_user_role(auth.uid()) IN ('grand_master', 'master', 'admin', 'admin_officer')
  )
  WITH CHECK (
    organization_id IN (
      SELECT organization_id FROM public.user_profiles WHERE id = auth.uid()
    ) AND get_user_role(auth.uid()) IN ('grand_master', 'master', 'admin', 'admin_officer')
  );

-- Users can read public templates or their own
DROP POLICY IF EXISTS "users_read_report_templates" ON public.report_templates;
DROP POLICY IF EXISTS "users_read_report_templates" ON public.report_templates;
CREATE POLICY "users_read_report_templates" ON public.report_templates FOR SELECT
  TO authenticated
  USING (
    is_active = true AND (
      created_by = auth.uid() OR
      is_public = true OR
      auth.uid() = ANY(shared_with) OR
      get_user_role(auth.uid()) IN ('grand_master', 'master', 'admin', 'admin_officer')
    )
  );

COMMENT ON TABLE public.report_templates IS 
  'User-created report templates with configurable fields, filters, and output options.';


-- ────────────────────────────────────────────────────────────────────────────
-- 3. REPORT SCHEDULES
-- Automatic report generation
-- ────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.report_schedules (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   UUID        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  template_id       UUID        NOT NULL REFERENCES public.report_templates(id) ON DELETE CASCADE,
  
  -- Schedule name
  name              TEXT        NOT NULL,
  description       TEXT,
  
  -- Schedule configuration
  frequency         TEXT        NOT NULL
    CHECK (frequency IN ('daily', 'weekly', 'biweekly', 'monthly', 'quarterly', 'yearly')),
  
  -- Timing
  schedule_time     TIME        NOT NULL DEFAULT '06:00',  -- Time of day (NZ timezone)
  schedule_day      INTEGER,    -- Day of week (1-7) or day of month (1-31)
  timezone          TEXT        NOT NULL DEFAULT 'Pacific/Auckland',
  
  -- Date range configuration
  date_range_type   TEXT        NOT NULL DEFAULT 'previous_period'
    CHECK (date_range_type IN (
      'previous_day',
      'previous_week',
      'previous_month',
      'previous_quarter',
      'previous_year',
      'previous_period',  -- Based on frequency
      'custom',
      'rolling_7_days',
      'rolling_30_days',
      'rolling_90_days',
      'year_to_date',
      'quarter_to_date',
      'month_to_date'
    )),
  
  custom_days_back  INTEGER,    -- For custom date range
  
  -- Output settings
  output_format     TEXT        NOT NULL DEFAULT 'pdf'
    CHECK (output_format IN ('csv', 'pdf', 'excel')),
  
  -- Delivery settings
  delivery_method   TEXT        NOT NULL DEFAULT 'email'
    CHECK (delivery_method IN ('email', 'storage', 'both')),
  
  email_recipients  TEXT[]      DEFAULT ARRAY[]::TEXT[],
  email_subject     TEXT,
  email_body        TEXT,
  
  storage_path      TEXT,       -- Path in Supabase Storage
  
  -- Status
  is_active         BOOLEAN     NOT NULL DEFAULT true,
  last_run_at       TIMESTAMPTZ,
  last_run_status   TEXT        CHECK (last_run_status IN ('success', 'failed', 'partial')),
  last_run_error    TEXT,
  next_run_at       TIMESTAMPTZ,
  
  -- Statistics
  total_runs        INTEGER     NOT NULL DEFAULT 0,
  successful_runs   INTEGER     NOT NULL DEFAULT 0,
  failed_runs       INTEGER     NOT NULL DEFAULT 0,
  
  created_by        UUID        NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_report_schedules_org
  ON public.report_schedules(organization_id, is_active);

CREATE INDEX IF NOT EXISTS idx_report_schedules_template
  ON public.report_schedules(template_id);

CREATE INDEX IF NOT EXISTS idx_report_schedules_next_run
  ON public.report_schedules(next_run_at) WHERE is_active = true;

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION public.update_report_schedules_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

CREATE TRIGGER trg_report_schedules_updated_at
  BEFORE UPDATE ON public.report_schedules
  FOR EACH ROW EXECUTE FUNCTION public.update_report_schedules_updated_at();

ALTER TABLE public.report_schedules ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "admins_manage_report_schedules" ON public.report_schedules;
DROP POLICY IF EXISTS "admins_manage_report_schedules" ON public.report_schedules;
CREATE POLICY "admins_manage_report_schedules" ON public.report_schedules FOR ALL
  TO authenticated
  USING (
    organization_id IN (
      SELECT organization_id FROM public.user_profiles WHERE id = auth.uid()
    ) AND get_user_role(auth.uid()) IN ('grand_master', 'master', 'admin', 'admin_officer')
  )
  WITH CHECK (
    organization_id IN (
      SELECT organization_id FROM public.user_profiles WHERE id = auth.uid()
    ) AND get_user_role(auth.uid()) IN ('grand_master', 'master', 'admin', 'admin_officer')
  );

COMMENT ON TABLE public.report_schedules IS 
  'Scheduled automatic report generation with email delivery options.';


-- ────────────────────────────────────────────────────────────────────────────
-- 4. REPORT HISTORY
-- Track all generated reports
-- ────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.report_history (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   UUID        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  
  -- Source (either template or ad-hoc)
  template_id       UUID        REFERENCES public.report_templates(id) ON DELETE SET NULL,
  schedule_id       UUID        REFERENCES public.report_schedules(id) ON DELETE SET NULL,
  
  -- Report details
  name              TEXT        NOT NULL,
  data_source_code  TEXT        NOT NULL,
  
  -- Configuration used (snapshot)
  config_snapshot   JSONB       NOT NULL DEFAULT '{}'::JSONB,
  
  -- Parameters
  date_from         DATE,
  date_to           DATE,
  filters_applied   JSONB       DEFAULT '{}'::JSONB,
  
  -- Output
  output_format     TEXT        NOT NULL,
  row_count         INTEGER,
  file_size_bytes   BIGINT,
  
  -- Storage
  storage_path      TEXT,       -- Path in Supabase Storage
  storage_bucket    TEXT        DEFAULT 'reports',
  download_url      TEXT,       -- Temporary download URL
  url_expires_at    TIMESTAMPTZ,
  
  -- Status
  status            TEXT        NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'generating', 'completed', 'failed', 'expired')),
  error_message     TEXT,
  
  -- Generation timing
  started_at        TIMESTAMPTZ,
  completed_at      TIMESTAMPTZ,
  generation_time_ms INTEGER,
  
  -- Delivery
  delivered_to      TEXT[],     -- Email recipients if sent
  delivery_status   TEXT        CHECK (delivery_status IN ('pending', 'sent', 'failed', 'not_required')),
  
  -- Generated by
  generated_by      UUID        REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  generated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  
  -- Expiry (auto-delete old reports)
  expires_at        TIMESTAMPTZ DEFAULT (now() + INTERVAL '90 days')
);

CREATE INDEX IF NOT EXISTS idx_report_history_org_date
  ON public.report_history(organization_id, generated_at DESC);

CREATE INDEX IF NOT EXISTS idx_report_history_template
  ON public.report_history(template_id, generated_at DESC);

CREATE INDEX IF NOT EXISTS idx_report_history_status
  ON public.report_history(status, generated_at DESC);

CREATE INDEX IF NOT EXISTS idx_report_history_expiry
  ON public.report_history(expires_at) WHERE status = 'completed';

ALTER TABLE public.report_history ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "admins_manage_report_history" ON public.report_history;
DROP POLICY IF EXISTS "admins_manage_report_history" ON public.report_history;
CREATE POLICY "admins_manage_report_history" ON public.report_history FOR ALL
  TO authenticated
  USING (
    organization_id IN (
      SELECT organization_id FROM public.user_profiles WHERE id = auth.uid()
    ) AND get_user_role(auth.uid()) IN ('grand_master', 'master', 'admin', 'admin_officer')
  )
  WITH CHECK (
    organization_id IN (
      SELECT organization_id FROM public.user_profiles WHERE id = auth.uid()
    ) AND get_user_role(auth.uid()) IN ('grand_master', 'master', 'admin', 'admin_officer')
  );

-- Users can read reports they generated
DROP POLICY IF EXISTS "users_read_own_report_history" ON public.report_history;
DROP POLICY IF EXISTS "users_read_own_report_history" ON public.report_history;
CREATE POLICY "users_read_own_report_history" ON public.report_history FOR SELECT
  TO authenticated
  USING (generated_by = auth.uid());

COMMENT ON TABLE public.report_history IS 
  'History of all generated reports with storage references and delivery status.';


-- ────────────────────────────────────────────────────────────────────────────
-- 5. HELPER FUNCTIONS
-- ────────────────────────────────────────────────────────────────────────────

-- Function to increment template run count
CREATE OR REPLACE FUNCTION public.increment_report_template_run(p_template_id UUID)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  UPDATE public.report_templates
  SET 
    run_count = run_count + 1,
    last_run_at = now()
  WHERE id = p_template_id;
END;
$$;

-- Function to calculate next run time for schedule
CREATE OR REPLACE FUNCTION public.calculate_next_report_run(
  p_frequency TEXT,
  p_schedule_time TIME,
  p_schedule_day INTEGER DEFAULT NULL,
  p_timezone TEXT DEFAULT 'Pacific/Auckland'
)
RETURNS TIMESTAMPTZ
LANGUAGE plpgsql AS $$
DECLARE
  v_now TIMESTAMPTZ;
  v_next TIMESTAMPTZ;
  v_today_run TIMESTAMPTZ;
  v_current_dow INTEGER;
  v_current_dom INTEGER;
BEGIN
  v_now := now() AT TIME ZONE p_timezone;
  v_today_run := (DATE(v_now) + p_schedule_time) AT TIME ZONE p_timezone;
  v_current_dow := EXTRACT(ISODOW FROM v_now);
  v_current_dom := EXTRACT(DAY FROM v_now);
  
  CASE p_frequency
    WHEN 'daily' THEN
      IF v_now < v_today_run THEN
        v_next := v_today_run;
      ELSE
        v_next := v_today_run + INTERVAL '1 day';
      END IF;
      
    WHEN 'weekly' THEN
      -- p_schedule_day is day of week (1=Monday, 7=Sunday)
      IF p_schedule_day IS NULL THEN p_schedule_day := 1; END IF;
      
      v_next := DATE_TRUNC('week', v_now) + (p_schedule_day - 1) * INTERVAL '1 day' + p_schedule_time;
      v_next := v_next AT TIME ZONE p_timezone;
      
      IF v_next <= v_now THEN
        v_next := v_next + INTERVAL '1 week';
      END IF;
      
    WHEN 'biweekly' THEN
      IF p_schedule_day IS NULL THEN p_schedule_day := 1; END IF;
      
      v_next := DATE_TRUNC('week', v_now) + (p_schedule_day - 1) * INTERVAL '1 day' + p_schedule_time;
      v_next := v_next AT TIME ZONE p_timezone;
      
      IF v_next <= v_now THEN
        v_next := v_next + INTERVAL '2 weeks';
      END IF;
      
    WHEN 'monthly' THEN
      -- p_schedule_day is day of month (1-31)
      IF p_schedule_day IS NULL THEN p_schedule_day := 1; END IF;
      
      v_next := DATE_TRUNC('month', v_now) + (p_schedule_day - 1) * INTERVAL '1 day' + p_schedule_time;
      v_next := v_next AT TIME ZONE p_timezone;
      
      IF v_next <= v_now THEN
        v_next := v_next + INTERVAL '1 month';
      END IF;
      
    WHEN 'quarterly' THEN
      IF p_schedule_day IS NULL THEN p_schedule_day := 1; END IF;
      
      v_next := DATE_TRUNC('quarter', v_now) + (p_schedule_day - 1) * INTERVAL '1 day' + p_schedule_time;
      v_next := v_next AT TIME ZONE p_timezone;
      
      IF v_next <= v_now THEN
        v_next := v_next + INTERVAL '3 months';
      END IF;
      
    WHEN 'yearly' THEN
      IF p_schedule_day IS NULL THEN p_schedule_day := 1; END IF;
      
      v_next := DATE_TRUNC('year', v_now) + (p_schedule_day - 1) * INTERVAL '1 day' + p_schedule_time;
      v_next := v_next AT TIME ZONE p_timezone;
      
      IF v_next <= v_now THEN
        v_next := v_next + INTERVAL '1 year';
      END IF;
      
    ELSE
      v_next := v_now + INTERVAL '1 day';
  END CASE;
  
  RETURN v_next;
END;
$$;

-- Function to update schedule next run time
CREATE OR REPLACE FUNCTION public.update_report_schedule_next_run()
RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' OR (TG_OP = 'UPDATE' AND (
    NEW.frequency <> OLD.frequency OR
    NEW.schedule_time <> OLD.schedule_time OR
    NEW.schedule_day <> OLD.schedule_day OR
    NEW.is_active <> OLD.is_active
  )) THEN
    IF NEW.is_active THEN
      NEW.next_run_at := calculate_next_report_run(
        NEW.frequency, 
        NEW.schedule_time, 
        NEW.schedule_day,
        NEW.timezone
      );
    ELSE
      NEW.next_run_at := NULL;
    END IF;
  END IF;
  
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_update_report_schedule_next_run
  BEFORE INSERT OR UPDATE ON public.report_schedules
  FOR EACH ROW EXECUTE FUNCTION public.update_report_schedule_next_run();


-- ────────────────────────────────────────────────────────────────────────────
-- 6. SEED DEFAULT DATA SOURCES
-- ────────────────────────────────────────────────────────────────────────────

INSERT INTO public.report_data_sources (code, name, description, source_table, available_fields, default_fields, available_filters, supports_grouping, supports_charts)
VALUES 
  -- Observations
  ('observations', 'Vehicle Observations', 'All vehicle observation records', 'observations',
   '[
     {"key": "id", "label": "ID", "type": "uuid"},
     {"key": "plate_number", "label": "Plate Number", "type": "text"},
     {"key": "recorded_at", "label": "Recorded At", "type": "timestamp"},
     {"key": "zone_id", "label": "Zone ID", "type": "uuid"},
     {"key": "zone_name", "label": "Zone Name", "type": "text", "join": "zones"},
     {"key": "is_compliant", "label": "Compliant", "type": "boolean"},
     {"key": "compliance_status", "label": "Compliance Status", "type": "text"},
     {"key": "gps_latitude", "label": "Latitude", "type": "number"},
     {"key": "gps_longitude", "label": "Longitude", "type": "number"},
     {"key": "recorded_by", "label": "Recorded By (ID)", "type": "uuid"},
     {"key": "recorded_by_name", "label": "Recorded By", "type": "text", "join": "user_profiles"},
     {"key": "organization_id", "label": "Organization ID", "type": "uuid"},
     {"key": "organization_name", "label": "Organization", "type": "text", "join": "organizations"}
   ]'::JSONB,
   ARRAY['plate_number', 'zone_name', 'recorded_at', 'is_compliant', 'recorded_by_name'],
   '[
     {"key": "recorded_at", "label": "Date Range", "type": "daterange"},
     {"key": "zone_id", "label": "Zone", "type": "select", "source": "zones"},
     {"key": "is_compliant", "label": "Compliant", "type": "boolean"},
     {"key": "organization_id", "label": "Organization", "type": "select", "source": "organizations"}
   ]'::JSONB,
   true, true),
   
  -- Vehicles
  ('vehicles', 'Vehicles', 'Canonical vehicle records', 'canonical_vehicles',
   '[
     {"key": "id", "label": "ID", "type": "uuid"},
     {"key": "plate_number", "label": "Plate Number", "type": "text"},
     {"key": "make", "label": "Make", "type": "text"},
     {"key": "model", "label": "Model", "type": "text"},
     {"key": "year", "label": "Year", "type": "number"},
     {"key": "colour", "label": "Colour", "type": "text"},
     {"key": "self_contained", "label": "Self-Contained", "type": "boolean"},
     {"key": "total_observations", "label": "Total Observations", "type": "number"},
     {"key": "total_breaches", "label": "Total Breaches", "type": "number"},
     {"key": "compliance_rate", "label": "Compliance Rate", "type": "number", "format": "percentage"},
     {"key": "last_seen_at", "label": "Last Seen", "type": "timestamp"},
     {"key": "created_at", "label": "First Recorded", "type": "timestamp"}
   ]'::JSONB,
   ARRAY['plate_number', 'make', 'model', 'self_contained', 'total_observations'],
   '[
     {"key": "self_contained", "label": "Self-Contained", "type": "boolean"},
     {"key": "total_breaches", "label": "Min Breaches", "type": "number"}
   ]'::JSONB,
   true, true),
   
  -- Breaches
  ('breaches', 'Breach Alerts', 'Compliance breach records', 'breach_alerts',
   '[
     {"key": "id", "label": "ID", "type": "uuid"},
     {"key": "plate_number", "label": "Plate Number", "type": "text"},
     {"key": "zone_id", "label": "Zone ID", "type": "uuid"},
     {"key": "zone_name", "label": "Zone Name", "type": "text", "join": "zones"},
     {"key": "breach_type", "label": "Breach Type", "type": "text"},
     {"key": "severity", "label": "Severity", "type": "text"},
     {"key": "status", "label": "Status", "type": "text"},
     {"key": "created_at", "label": "Detected At", "type": "timestamp"},
     {"key": "resolved_at", "label": "Resolved At", "type": "timestamp"},
     {"key": "consecutive_nights", "label": "Consecutive Nights", "type": "number"},
     {"key": "organization_id", "label": "Organization ID", "type": "uuid"}
   ]'::JSONB,
   ARRAY['plate_number', 'zone_name', 'breach_type', 'status', 'created_at'],
   '[
     {"key": "created_at", "label": "Date Range", "type": "daterange"},
     {"key": "zone_id", "label": "Zone", "type": "select", "source": "zones"},
     {"key": "breach_type", "label": "Breach Type", "type": "select", "options": ["overstay", "prohibited_area", "expired_permit", "non_compliant_vehicle"]},
     {"key": "status", "label": "Status", "type": "select", "options": ["new", "acknowledged", "in_progress", "resolved", "dismissed"]}
   ]'::JSONB,
   true, true),
   
  -- Officers
  ('officers', 'Officers', 'Officer profiles and activity', 'user_profiles',
   '[
     {"key": "id", "label": "ID", "type": "uuid"},
     {"key": "email", "label": "Email", "type": "text"},
     {"key": "first_name", "label": "First Name", "type": "text"},
     {"key": "last_name", "label": "Last Name", "type": "text"},
     {"key": "role", "label": "Role", "type": "text"},
     {"key": "phone", "label": "Phone", "type": "text"},
     {"key": "is_active", "label": "Active", "type": "boolean"},
     {"key": "created_at", "label": "Created At", "type": "timestamp"},
     {"key": "organization_id", "label": "Organization ID", "type": "uuid"},
     {"key": "organization_name", "label": "Organization", "type": "text", "join": "organizations"}
   ]'::JSONB,
   ARRAY['first_name', 'last_name', 'email', 'role', 'is_active'],
   '[
     {"key": "role", "label": "Role", "type": "select", "options": ["officer", "admin", "admin_officer", "master"]},
     {"key": "is_active", "label": "Active", "type": "boolean"},
     {"key": "organization_id", "label": "Organization", "type": "select", "source": "organizations"}
   ]'::JSONB,
   true, false),
   
  -- Patrols
  ('patrols', 'Patrols', 'Patrol records', 'patrols',
   '[
     {"key": "id", "label": "ID", "type": "uuid"},
     {"key": "zone_id", "label": "Zone ID", "type": "uuid"},
     {"key": "zone_name", "label": "Zone Name", "type": "text", "join": "zones"},
     {"key": "officer_id", "label": "Officer ID", "type": "uuid"},
     {"key": "officer_name", "label": "Officer", "type": "text", "join": "user_profiles"},
     {"key": "started_at", "label": "Started At", "type": "timestamp"},
     {"key": "ended_at", "label": "Ended At", "type": "timestamp"},
     {"key": "duration_minutes", "label": "Duration (mins)", "type": "number"},
     {"key": "vehicles_checked", "label": "Vehicles Checked", "type": "number"},
     {"key": "breaches_found", "label": "Breaches Found", "type": "number"},
     {"key": "status", "label": "Status", "type": "text"},
     {"key": "organization_id", "label": "Organization ID", "type": "uuid"}
   ]'::JSONB,
   ARRAY['zone_name', 'officer_name', 'started_at', 'vehicles_checked', 'breaches_found'],
   '[
     {"key": "started_at", "label": "Date Range", "type": "daterange"},
     {"key": "zone_id", "label": "Zone", "type": "select", "source": "zones"},
     {"key": "officer_id", "label": "Officer", "type": "select", "source": "user_profiles"},
     {"key": "status", "label": "Status", "type": "select", "options": ["active", "completed", "cancelled"]}
   ]'::JSONB,
   true, true),
   
  -- Enforcement Actions
  ('enforcement', 'Enforcement Actions', 'Enforcement and notice records', 'enforcement_actions',
   '[
     {"key": "id", "label": "ID", "type": "uuid"},
     {"key": "action_type", "label": "Action Type", "type": "text"},
     {"key": "plate_number", "label": "Plate Number", "type": "text"},
     {"key": "zone_id", "label": "Zone ID", "type": "uuid"},
     {"key": "zone_name", "label": "Zone Name", "type": "text", "join": "zones"},
     {"key": "status", "label": "Status", "type": "text"},
     {"key": "created_at", "label": "Created At", "type": "timestamp"},
     {"key": "completed_at", "label": "Completed At", "type": "timestamp"},
     {"key": "assigned_to", "label": "Assigned To (ID)", "type": "uuid"},
     {"key": "assigned_to_name", "label": "Assigned To", "type": "text", "join": "user_profiles"},
     {"key": "notes", "label": "Notes", "type": "text"},
     {"key": "organization_id", "label": "Organization ID", "type": "uuid"}
   ]'::JSONB,
   ARRAY['action_type', 'plate_number', 'zone_name', 'status', 'created_at'],
   '[
     {"key": "created_at", "label": "Date Range", "type": "daterange"},
     {"key": "action_type", "label": "Action Type", "type": "select", "options": ["verbal_warning", "written_warning", "infringement", "tow", "investigation"]},
     {"key": "status", "label": "Status", "type": "select", "options": ["pending", "assigned", "in_progress", "completed", "cancelled"]}
   ]'::JSONB,
   true, true),
   
  -- Assets
  ('assets', 'Officer Assets', 'Equipment assigned to officers', 'officer_assets',
   '[
     {"key": "id", "label": "ID", "type": "uuid"},
     {"key": "officer_id", "label": "Officer ID", "type": "uuid"},
     {"key": "officer_name", "label": "Officer", "type": "text", "join": "user_profiles"},
     {"key": "asset_type_name", "label": "Asset Type", "type": "text", "join": "asset_types"},
     {"key": "serial_number", "label": "Serial Number", "type": "text"},
     {"key": "asset_tag", "label": "Asset Tag", "type": "text"},
     {"key": "condition", "label": "Condition", "type": "text"},
     {"key": "status", "label": "Status", "type": "text"},
     {"key": "issued_date", "label": "Issued Date", "type": "date"},
     {"key": "returned_date", "label": "Returned Date", "type": "date"},
     {"key": "organization_id", "label": "Organization ID", "type": "uuid"}
   ]'::JSONB,
   ARRAY['officer_name', 'asset_type_name', 'serial_number', 'status', 'issued_date'],
   '[
     {"key": "status", "label": "Status", "type": "select", "options": ["issued", "returned", "lost", "damaged"]},
     {"key": "condition", "label": "Condition", "type": "select", "options": ["new", "excellent", "good", "fair", "poor"]}
   ]'::JSONB,
   true, false),
   
  -- Key Custody
  ('keys', 'Key Custody', 'Key checkout/return records', 'key_custody',
   '[
     {"key": "id", "label": "ID", "type": "uuid"},
     {"key": "key_set_name", "label": "Key Set", "type": "text", "join": "key_sets"},
     {"key": "officer_id", "label": "Officer ID", "type": "uuid"},
     {"key": "officer_name", "label": "Officer", "type": "text", "join": "user_profiles"},
     {"key": "checked_out_at", "label": "Checked Out", "type": "timestamp"},
     {"key": "returned_at", "label": "Returned", "type": "timestamp"},
     {"key": "status", "label": "Status", "type": "text"},
     {"key": "checkout_purpose", "label": "Purpose", "type": "text"},
     {"key": "organization_id", "label": "Organization ID", "type": "uuid"}
   ]'::JSONB,
   ARRAY['key_set_name', 'officer_name', 'checked_out_at', 'status'],
   '[
     {"key": "checked_out_at", "label": "Date Range", "type": "daterange"},
     {"key": "status", "label": "Status", "type": "select", "options": ["checked_out", "returned", "overdue", "lost"]}
   ]'::JSONB,
   true, false),
   
  -- Allowances
  ('allowances', 'Officer Allowances', 'Allowance assignments', 'officer_allowances',
   '[
     {"key": "id", "label": "ID", "type": "uuid"},
     {"key": "officer_id", "label": "Officer ID", "type": "uuid"},
     {"key": "officer_name", "label": "Officer", "type": "text", "join": "user_profiles"},
     {"key": "allowance_type_name", "label": "Allowance Type", "type": "text", "join": "allowance_types"},
     {"key": "rate", "label": "Rate", "type": "number", "format": "currency"},
     {"key": "quantity", "label": "Quantity", "type": "number"},
     {"key": "total_amount", "label": "Total Amount", "type": "number", "format": "currency"},
     {"key": "status", "label": "Status", "type": "text"},
     {"key": "effective_date", "label": "Effective Date", "type": "date"},
     {"key": "organization_id", "label": "Organization ID", "type": "uuid"}
   ]'::JSONB,
   ARRAY['officer_name', 'allowance_type_name', 'total_amount', 'status', 'effective_date'],
   '[
     {"key": "effective_date", "label": "Date Range", "type": "daterange"},
     {"key": "status", "label": "Status", "type": "select", "options": ["pending", "approved", "rejected", "paid"]}
   ]'::JSONB,
   true, true),
   
  -- Incidents
  ('incidents', 'Incidents', 'Incident reports', 'incidents',
   '[
     {"key": "id", "label": "ID", "type": "uuid"},
     {"key": "incident_number", "label": "Incident #", "type": "text"},
     {"key": "incident_type", "label": "Type", "type": "text"},
     {"key": "severity", "label": "Severity", "type": "text"},
     {"key": "status", "label": "Status", "type": "text"},
     {"key": "location", "label": "Location", "type": "text"},
     {"key": "reported_at", "label": "Reported At", "type": "timestamp"},
     {"key": "reported_by_name", "label": "Reported By", "type": "text", "join": "user_profiles"},
     {"key": "description", "label": "Description", "type": "text"},
     {"key": "organization_id", "label": "Organization ID", "type": "uuid"}
   ]'::JSONB,
   ARRAY['incident_number', 'incident_type', 'severity', 'status', 'reported_at'],
   '[
     {"key": "reported_at", "label": "Date Range", "type": "daterange"},
     {"key": "incident_type", "label": "Type", "type": "select"},
     {"key": "severity", "label": "Severity", "type": "select", "options": ["low", "medium", "high", "critical"]},
     {"key": "status", "label": "Status", "type": "select", "options": ["open", "investigating", "resolved", "closed"]}
   ]'::JSONB,
   true, true),
   
  -- Roster Shifts
  ('roster_shifts', 'Roster Shifts', 'Scheduled shifts', 'roster_shifts',
   '[
     {"key": "id", "label": "ID", "type": "uuid"},
     {"key": "officer_id", "label": "Officer ID", "type": "uuid"},
     {"key": "officer_name", "label": "Officer", "type": "text", "join": "user_profiles"},
     {"key": "shift_date", "label": "Shift Date", "type": "date"},
     {"key": "start_time", "label": "Start Time", "type": "time"},
     {"key": "end_time", "label": "End Time", "type": "time"},
     {"key": "shift_type", "label": "Shift Type", "type": "text"},
     {"key": "status", "label": "Status", "type": "text"},
     {"key": "site_name", "label": "Site", "type": "text", "join": "client_sites"},
     {"key": "hours_scheduled", "label": "Hours Scheduled", "type": "number"},
     {"key": "organization_id", "label": "Organization ID", "type": "uuid"}
   ]'::JSONB,
   ARRAY['officer_name', 'shift_date', 'start_time', 'end_time', 'status'],
   '[
     {"key": "shift_date", "label": "Date Range", "type": "daterange"},
     {"key": "officer_id", "label": "Officer", "type": "select", "source": "user_profiles"},
     {"key": "status", "label": "Status", "type": "select", "options": ["scheduled", "confirmed", "in_progress", "completed", "cancelled"]}
   ]'::JSONB,
   true, true)
   
ON CONFLICT (code) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  available_fields = EXCLUDED.available_fields,
  default_fields = EXCLUDED.default_fields,
  available_filters = EXCLUDED.available_filters,
  supports_grouping = EXCLUDED.supports_grouping,
  supports_charts = EXCLUDED.supports_charts,
  updated_at = now();


-- ────────────────────────────────────────────────────────────────────────────
-- 7. VIEWS
-- ────────────────────────────────────────────────────────────────────────────

-- View: Recent reports with template info
CREATE OR REPLACE VIEW public.v_recent_reports AS
SELECT 
  rh.id,
  rh.name,
  rh.data_source_code,
  rh.output_format,
  rh.row_count,
  rh.file_size_bytes,
  rh.status,
  rh.generated_at,
  rh.generation_time_ms,
  rt.name AS template_name,
  rt.category AS template_category,
  up.first_name || ' ' || up.last_name AS generated_by_name,
  rh.organization_id
FROM public.report_history rh
LEFT JOIN public.report_templates rt ON rt.id = rh.template_id
LEFT JOIN public.user_profiles up ON up.id = rh.generated_by
ORDER BY rh.generated_at DESC;

-- View: Template usage statistics
CREATE OR REPLACE VIEW public.v_template_usage_stats AS
SELECT 
  rt.id,
  rt.name,
  rt.category,
  rt.run_count,
  rt.last_run_at,
  COUNT(rh.id) AS history_count,
  AVG(rh.generation_time_ms) AS avg_generation_ms,
  SUM(rh.row_count) AS total_rows_generated,
  up.first_name || ' ' || up.last_name AS created_by_name,
  rt.organization_id
FROM public.report_templates rt
LEFT JOIN public.report_history rh ON rh.template_id = rt.id
LEFT JOIN public.user_profiles up ON up.id = rt.created_by
GROUP BY rt.id, rt.name, rt.category, rt.run_count, rt.last_run_at, 
         up.first_name, up.last_name, rt.organization_id;


-- ────────────────────────────────────────────────────────────────────────────
-- 8. STORAGE BUCKET FOR REPORTS
-- ────────────────────────────────────────────────────────────────────────────

-- Create reports storage bucket (idempotent)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'reports',
  'reports', 
  false,
  52428800,  -- 50MB limit
  ARRAY['application/pdf', 'text/csv', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/json', 'text/html']
)
ON CONFLICT (id) DO NOTHING;


-- ────────────────────────────────────────────────────────────────────────────
-- 9. MIGRATION COMPLETE
-- ────────────────────────────────────────────────────────────────────────────

DO $$
BEGIN
  RAISE NOTICE '✅ Migration 20260513000001 complete:';
  RAISE NOTICE '   • report_data_sources table created with 11 default sources';
  RAISE NOTICE '   • report_templates table created (custom report definitions)';
  RAISE NOTICE '   • report_schedules table created (automatic generation)';
  RAISE NOTICE '   • report_history table created (generation tracking)';
  RAISE NOTICE '   • Helper functions: calculate_next_report_run(), increment_report_template_run()';
  RAISE NOTICE '   • Views: v_recent_reports, v_template_usage_stats';
  RAISE NOTICE '   • Storage bucket "reports" created';
END $$;
