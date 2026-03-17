-- Notice to Vacate System - Zone-specific legal configurations and notice generation

-- Zone legal configuration table
CREATE TABLE IF NOT EXISTS public.zone_legal_config (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  zone_id UUID NOT NULL REFERENCES public.zones(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  
  -- Organization details for letterhead
  org_office_name TEXT NOT NULL,  -- e.g., "Wellington Office"
  org_building TEXT,  -- e.g., "Radio New Zealand House"
  org_street_address TEXT NOT NULL,
  org_po_box TEXT,
  org_city TEXT NOT NULL,
  org_postcode TEXT NOT NULL,
  org_country TEXT DEFAULT 'New Zealand',
  org_phone TEXT,
  org_fax TEXT,
  org_email TEXT,
  org_website TEXT,
  
  -- Legal land description
  legal_description TEXT NOT NULL,  -- e.g., "Section 1, Parts Section 2..."
  land_act TEXT NOT NULL,  -- e.g., "Land Act 1948", "Trespass Act 1980"
  land_owner TEXT NOT NULL,  -- e.g., "The Commissioner of Crown Lands", "Nelson City Council"
  managing_authority TEXT,  -- e.g., "Toitū Te Whenua Land Information New Zealand"
  
  -- Zone requirements and breach details
  max_stay_nights INTEGER DEFAULT 3,
  max_consecutive_nights INTEGER DEFAULT 3,
  self_contained_required BOOLEAN DEFAULT true,
  breach_template TEXT NOT NULL,  -- Template text for "purpose of this letter" paragraph
  
  -- Enforcement details
  enforcement_type TEXT NOT NULL,  -- 'trespass', 'fine', 'warning', 'removal'
  enforcement_authority TEXT,  -- e.g., "Police", "Council Compliance Officer"
  trespass_duration_years INTEGER DEFAULT 2,
  fine_amount NUMERIC(10,2),
  
  -- Notice timeline
  vacate_hours INTEGER DEFAULT 4,  -- Hours to vacate after receiving notice
  
  -- Authorized signatories (admin users only)
  authorized_signatories JSONB DEFAULT '[]',  -- Array of {user_id, name, title, signature_url}
  
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  
  UNIQUE(zone_id)
);

-- Notice to Vacate records table
CREATE TABLE IF NOT EXISTS public.notices_to_vacate (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reference_number TEXT NOT NULL UNIQUE,
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  zone_id UUID NOT NULL REFERENCES public.zones(id) ON DELETE CASCADE,
  
  -- Vehicle and recipient details
  vehicle_id UUID REFERENCES public.canonical_vehicles(vehicle_id) ON DELETE SET NULL,
  plate_number TEXT NOT NULL,
  recipient_name TEXT,  -- "The Owner / Occupier of the vehicle with registration..."
  
  -- Breach details
  breach_reason TEXT NOT NULL,
  nights_stayed INTEGER,
  breach_date DATE NOT NULL,
  breach_details JSONB DEFAULT '{}',
  
  -- Notice content (generated)
  notice_document_url TEXT,  -- PDF URL in storage
  notice_html TEXT,  -- Generated HTML for preview
  
  -- Delivery details
  delivery_method TEXT,  -- 'printed_onsite', 'email', 'postal', 'hand_delivered'
  delivered_to_email TEXT,
  delivered_to_officer UUID REFERENCES public.user_profiles(id),
  delivered_at TIMESTAMPTZ,
  
  -- Status tracking
  status TEXT DEFAULT 'draft',  -- 'draft', 'issued', 'complied', 'escalated'
  issued_by UUID NOT NULL REFERENCES public.user_profiles(id),
  issued_at TIMESTAMPTZ,
  authorized_by UUID REFERENCES public.user_profiles(id),
  authorized_at TIMESTAMPTZ,
  
  -- Compliance tracking
  vacate_deadline TIMESTAMPTZ,
  complied_at TIMESTAMPTZ,
  compliance_verified_by UUID REFERENCES public.user_profiles(id),
  escalated_at TIMESTAMPTZ,
  escalation_notes TEXT,
  
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Indices
CREATE INDEX IF NOT EXISTS idx_zone_legal_config_zone ON public.zone_legal_config(zone_id);
CREATE INDEX IF NOT EXISTS idx_zone_legal_config_org ON public.zone_legal_config(organization_id);

CREATE INDEX IF NOT EXISTS idx_notices_vacate_zone ON public.notices_to_vacate(zone_id);
CREATE INDEX IF NOT EXISTS idx_notices_vacate_org ON public.notices_to_vacate(organization_id);
CREATE INDEX IF NOT EXISTS idx_notices_vacate_vehicle ON public.notices_to_vacate(vehicle_id);
CREATE INDEX IF NOT EXISTS idx_notices_vacate_status ON public.notices_to_vacate(status);
CREATE INDEX IF NOT EXISTS idx_notices_vacate_issued ON public.notices_to_vacate(issued_at);
CREATE INDEX IF NOT EXISTS idx_notices_vacate_deadline ON public.notices_to_vacate(vacate_deadline);

-- RLS Policies
ALTER TABLE public.zone_legal_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notices_to_vacate ENABLE ROW LEVEL SECURITY;

-- zone_legal_config policies
CREATE POLICY "admins_manage_zone_legal_config"
  ON public.zone_legal_config FOR ALL
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

CREATE POLICY "users_view_zone_legal_config"
  ON public.zone_legal_config FOR SELECT
  TO authenticated
  USING (
    (get_user_role(auth.uid()) = 'master'::text)
    OR (organization_id = get_user_organization_id(auth.uid()))
  );

-- notices_to_vacate policies
CREATE POLICY "admins_manage_notices"
  ON public.notices_to_vacate FOR ALL
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

CREATE POLICY "officers_view_org_notices"
  ON public.notices_to_vacate FOR SELECT
  TO authenticated
  USING (
    (
      -- Master users can see all organization notices
      (get_user_role(auth.uid()) = 'master'::text)
      -- Admins can see notices for their organization
      OR (get_user_role(auth.uid()) = 'admin'::text AND organization_id = get_user_organization_id(auth.uid()))
    )
  );

CREATE POLICY "service_role_manage_notices"
  ON public.notices_to_vacate FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Function to generate reference number (race-condition safe with FOR UPDATE lock)
CREATE OR REPLACE FUNCTION generate_notice_reference()
RETURNS TEXT AS $$
DECLARE
  v_reference TEXT;
  v_year TEXT;
  v_counter INTEGER;
BEGIN
  v_year := TO_CHAR(NOW(), 'YYYY');
  
  -- Lock the latest notice to serialize reference generation and prevent concurrent duplicates
  SELECT COALESCE(MAX(CAST(SUBSTRING(reference_number FROM 'NTV' || v_year || '-([0-9]+)') AS INTEGER)), 0) + 1
  INTO v_counter
  FROM public.notices_to_vacate
  WHERE reference_number LIKE 'NTV' || v_year || '-%'
  FOR UPDATE;  -- Serialize access to prevent concurrent duplicate reference generation
  
  v_reference := 'NTV' || v_year || '-' || LPAD(v_counter::TEXT, 4, '0');
  
  RETURN v_reference;
END;
$$ LANGUAGE plpgsql;

-- Trigger to auto-generate reference number
CREATE OR REPLACE FUNCTION set_notice_reference_number()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.reference_number IS NULL OR NEW.reference_number = '' THEN
    NEW.reference_number := generate_notice_reference();
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER set_notice_reference_trigger
  BEFORE INSERT ON public.notices_to_vacate
  FOR EACH ROW
  EXECUTE FUNCTION set_notice_reference_number();

-- Trigger to update updated_at
CREATE TRIGGER update_zone_legal_config_updated_at
  BEFORE UPDATE ON public.zone_legal_config
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_notices_vacate_updated_at
  BEFORE UPDATE ON public.notices_to_vacate
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

COMMENT ON TABLE public.zone_legal_config IS 'Legal configuration for each zone including organization details, land acts, and authorized signatories';
COMMENT ON TABLE public.notices_to_vacate IS 'Notice to Vacate records with delivery tracking and compliance monitoring';
