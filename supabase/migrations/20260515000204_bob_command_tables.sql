-- Create database structural architecture for client site instances
CREATE TABLE IF NOT EXISTS public.client_sites (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  site_name TEXT NOT NULL,
  region TEXT DEFAULT 'Tasman / Nelson',
  created_by TEXT NOT NULL,
  organization_id UUID,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL
);

-- Create evidence artifact tracking for multimodal ingestion
CREATE TABLE IF NOT EXISTS public.evidence_artifacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  file_path TEXT NOT NULL,
  incident_type TEXT DEFAULT 'GENERAL_EVIDENCE',
  location TEXT,
  uploaded_by TEXT NOT NULL,
  organization_id UUID,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL,
  processed_at TIMESTAMP WITH TIME ZONE,
  processing_status TEXT DEFAULT 'pending' -- pending, completed, failed
);

-- Create rosters table if it doesn't exist (may already exist)
CREATE TABLE IF NOT EXISTS public.rosters (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  officer_id UUID,
  date_string TEXT NOT NULL,
  time_window TEXT NOT NULL,
  zone TEXT NOT NULL,
  confirmed BOOLEAN DEFAULT FALSE,
  organization_id UUID,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL
);

-- Create agent telemetry table for Bob diagnostics
CREATE TABLE IF NOT EXISTS public.agent_telemetry (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_trigger TEXT NOT NULL,
  run_status TEXT DEFAULT 'pending',
  error_mitigated TEXT,
  confidence_score FLOAT DEFAULT 0.0,
  organization_id UUID,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL
);

-- Enable Row Level Security
ALTER TABLE public.client_sites ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.evidence_artifacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rosters ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_telemetry ENABLE ROW LEVEL SECURITY;

-- Create RLS policies for client_sites
CREATE POLICY "Allow authenticated service orchestration on client_sites" 
  ON public.client_sites 
  USING (true) 
  WITH CHECK (true);

-- Create RLS policies for evidence_artifacts
CREATE POLICY "Allow authenticated evidence ingestion" 
  ON public.evidence_artifacts 
  USING (true) 
  WITH CHECK (true);

-- Create RLS policies for rosters
CREATE POLICY "Allow authenticated roster access" 
  ON public.rosters 
  USING (true) 
  WITH CHECK (true);

-- Create RLS policies for agent_telemetry
CREATE POLICY "Allow authenticated telemetry logging" 
  ON public.agent_telemetry 
  USING (true) 
  WITH CHECK (true);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_client_sites_org ON public.client_sites(organization_id);
CREATE INDEX IF NOT EXISTS idx_client_sites_created ON public.client_sites(created_at);
CREATE INDEX IF NOT EXISTS idx_evidence_org ON public.evidence_artifacts(organization_id);
CREATE INDEX IF NOT EXISTS idx_evidence_incident ON public.evidence_artifacts(incident_type);
CREATE INDEX IF NOT EXISTS idx_rosters_officer ON public.rosters(officer_id);
CREATE INDEX IF NOT EXISTS idx_rosters_zone ON public.rosters(zone);
CREATE INDEX IF NOT EXISTS idx_telemetry_event ON public.agent_telemetry(event_trigger);
