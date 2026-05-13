-- ============================================================================
-- Allowances, Assets, Key Management & Site Information System
-- Date: 2026-05-12
--
-- Implements comprehensive workforce management features:
--   1. Allowance Types & Officer Allowances — Higher duties, custom allowances
--   2. Officer Skills Enhancement — Site clearance, inductions, training levels
--   3. Asset Management — Equipment tracking (uniforms, phones, laptops)
--   4. Site Information — SOPs, maps, assignment instructions
--   5. Key Management (Wilsar-style) — Key custody tracking with full audit
--
-- Design Principle: Flexible schema using JSONB for custom fields to allow
-- users to add their own allowance types, asset types, etc. without migrations.
-- ============================================================================

-- ────────────────────────────────────────────────────────────────────────────
-- 1. ALLOWANCE TYPES (Flexible, User-Definable)
-- ────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.allowance_types (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   UUID        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  
  code              TEXT        NOT NULL,  -- Short code: 'HD', 'MEAL', 'UNIFORM', etc.
  name              TEXT        NOT NULL,  -- Display name: 'Higher Duties Allowance'
  description       TEXT,
  
  -- Allowance category
  category          TEXT        NOT NULL DEFAULT 'general'
    CHECK (category IN (
      'higher_duties',     -- Acting in a higher role
      'meal',              -- Meal allowance
      'uniform',           -- Uniform allowance
      'travel',            -- Travel/transport allowance
      'on_call',           -- On-call/availability allowance
      'tool',              -- Tool/equipment allowance
      'first_aid',         -- First aid officer allowance
      'training',          -- Training allowance
      'remote',            -- Remote/isolated location allowance
      'hazard',            -- Hazardous duty allowance
      'shift',             -- Shift loading (night/weekend)
      'general',           -- General/miscellaneous
      'custom'             -- User-defined category
    )),
  
  -- Rate configuration
  rate_type         TEXT        NOT NULL DEFAULT 'flat'
    CHECK (rate_type IN (
      'flat',              -- Fixed amount per occurrence
      'hourly',            -- Per hour worked
      'daily',             -- Per day
      'percentage',        -- Percentage of base pay
      'per_km',            -- Per kilometer traveled
      'per_unit'           -- Per unit (custom)
    )),
  
  default_rate      NUMERIC(10, 4),         -- Default rate for this type
  currency          TEXT        NOT NULL DEFAULT 'NZD',
  
  -- Rules
  is_taxable        BOOLEAN     NOT NULL DEFAULT true,
  requires_approval BOOLEAN     NOT NULL DEFAULT false,
  auto_apply_rules  JSONB       DEFAULT '{}'::JSONB,  -- Conditions for auto-application
  
  -- Eligibility (if specified, only these roles can receive)
  eligible_roles    TEXT[]      DEFAULT ARRAY[]::TEXT[],
  
  -- Customization - users can add their own fields
  custom_fields     JSONB       DEFAULT '{}'::JSONB,
  
  is_active         BOOLEAN     NOT NULL DEFAULT true,
  is_system         BOOLEAN     NOT NULL DEFAULT false,  -- Prevent deletion of system types
  
  created_by        UUID        REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  
  UNIQUE (organization_id, code)
);

CREATE INDEX IF NOT EXISTS idx_allowance_types_org
  ON public.allowance_types(organization_id, is_active);

CREATE INDEX IF NOT EXISTS idx_allowance_types_category
  ON public.allowance_types(organization_id, category);

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION public.update_allowance_types_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

DROP TRIGGER IF EXISTS trg_allowance_types_updated_at ON public.allowance_types;
CREATE TRIGGER trg_allowance_types_updated_at
  BEFORE UPDATE ON public.allowance_types
  FOR EACH ROW EXECUTE FUNCTION public.update_allowance_types_updated_at();

ALTER TABLE public.allowance_types ENABLE ROW LEVEL SECURITY;

-- Admins manage allowance types
DROP POLICY IF EXISTS "admins_manage_allowance_types" ON public.allowance_types;
CREATE POLICY "admins_manage_allowance_types" ON public.allowance_types FOR ALL
  TO authenticated
  USING (
    get_user_role(auth.uid()) IN ('grand_master', 'master', 'admin', 'admin_officer')
  )
  WITH CHECK (
    get_user_role(auth.uid()) IN ('grand_master', 'master', 'admin', 'admin_officer')
  );

-- All authenticated users can read allowance types
DROP POLICY IF EXISTS "auth_read_allowance_types" ON public.allowance_types;
CREATE POLICY "auth_read_allowance_types" ON public.allowance_types FOR SELECT
  TO authenticated
  USING (true);

COMMENT ON TABLE public.allowance_types IS 
  'Configurable allowance types that organizations can define. Supports higher duties, meals, uniforms, and custom allowances.';


-- ────────────────────────────────────────────────────────────────────────────
-- 2. OFFICER ALLOWANCES (Assigned Allowances)
-- ────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.officer_allowances (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   UUID        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  officer_id        UUID        NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
  allowance_type_id UUID        NOT NULL REFERENCES public.allowance_types(id) ON DELETE CASCADE,
  
  -- Context (when/where this allowance applies)
  roster_shift_id   UUID        REFERENCES public.roster_shifts(id) ON DELETE SET NULL,
  callout_shift_id  UUID,       -- References callout_shifts if applicable
  client_site_id    UUID        REFERENCES public.client_sites(id) ON DELETE SET NULL,
  
  -- Dates
  effective_date    DATE        NOT NULL DEFAULT CURRENT_DATE,
  end_date          DATE,
  
  -- Amount
  rate              NUMERIC(10, 4) NOT NULL,
  rate_type         TEXT        NOT NULL DEFAULT 'flat'
    CHECK (rate_type IN ('flat', 'hourly', 'daily', 'percentage', 'per_km', 'per_unit')),
  quantity          NUMERIC(10, 2) DEFAULT 1,  -- Hours, km, units, etc.
  total_amount      NUMERIC(10, 2),            -- Calculated total
  
  -- For higher duties
  acting_role       TEXT,                      -- The higher role being performed
  substantive_role  TEXT,                      -- Officer's normal role
  
  -- Approval workflow
  status            TEXT        NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected', 'paid', 'cancelled')),
  approved_by       UUID        REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  approved_at       TIMESTAMPTZ,
  rejection_reason  TEXT,
  
  -- Custom fields for flexibility
  custom_data       JSONB       DEFAULT '{}'::JSONB,
  
  notes             TEXT,
  created_by        UUID        REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_officer_allowances_org_date
  ON public.officer_allowances(organization_id, effective_date DESC);

CREATE INDEX IF NOT EXISTS idx_officer_allowances_officer
  ON public.officer_allowances(officer_id, effective_date DESC);

CREATE INDEX IF NOT EXISTS idx_officer_allowances_type
  ON public.officer_allowances(allowance_type_id, status);

CREATE INDEX IF NOT EXISTS idx_officer_allowances_status
  ON public.officer_allowances(organization_id, status);

-- Auto-calculate total amount
CREATE OR REPLACE FUNCTION public.calculate_officer_allowance_total()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  
  IF NEW.rate IS NOT NULL AND NEW.quantity IS NOT NULL THEN
    IF NEW.rate_type = 'percentage' THEN
      -- Percentage is stored as total percentage value
      NEW.total_amount := NEW.rate;
    ELSE
      NEW.total_amount := NEW.rate * NEW.quantity;
    END IF;
  END IF;
  
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_calculate_officer_allowance ON public.officer_allowances;
CREATE TRIGGER trg_calculate_officer_allowance
  BEFORE INSERT OR UPDATE ON public.officer_allowances
  FOR EACH ROW EXECUTE FUNCTION public.calculate_officer_allowance_total();

ALTER TABLE public.officer_allowances ENABLE ROW LEVEL SECURITY;

-- Admins manage all allowances
DROP POLICY IF EXISTS "admins_manage_officer_allowances" ON public.officer_allowances;
CREATE POLICY "admins_manage_officer_allowances" ON public.officer_allowances FOR ALL
  TO authenticated
  USING (
    get_user_role(auth.uid()) IN ('grand_master', 'master', 'admin', 'admin_officer')
  )
  WITH CHECK (
    get_user_role(auth.uid()) IN ('grand_master', 'master', 'admin', 'admin_officer')
  );

-- Officers can read their own allowances
DROP POLICY IF EXISTS "officers_read_own_allowances" ON public.officer_allowances;
CREATE POLICY "officers_read_own_allowances" ON public.officer_allowances FOR SELECT
  TO authenticated
  USING (officer_id = auth.uid());

COMMENT ON TABLE public.officer_allowances IS 
  'Individual allowance assignments to officers. Tracks higher duties, meal allowances, etc.';


-- ────────────────────────────────────────────────────────────────────────────
-- 3. OFFICER SKILL CATEGORIES (Extend existing officer_skills)
-- Add new skill types: site_clearance, site_induction, training_level
-- ────────────────────────────────────────────────────────────────────────────

-- First, alter the existing officer_skills table to support more categories
DO $$
BEGIN
  -- Check if the constraint exists and drop it
  IF EXISTS (
    SELECT 1 FROM pg_constraint 
    WHERE conname = 'officer_skills_skill_category_check' 
      AND conrelid = 'public.officer_skills'::regclass
  ) THEN
    ALTER TABLE public.officer_skills DROP CONSTRAINT officer_skills_skill_category_check;
  END IF;
  
  -- Add expanded category constraint
  ALTER TABLE public.officer_skills
    ADD CONSTRAINT officer_skills_skill_category_check
    CHECK (skill_category IN (
      'licence',            -- NZ CoA, Warrant, driver licence
      'certification',      -- First aid, fire warden, etc.
      'training',           -- Internal training courses
      'equipment',          -- Dog handler, CCTV, ALPR, etc.
      'language',           -- Bilingual officers
      'general',            -- General skills
      'site_clearance',     -- Site-specific clearance/access
      'site_induction',     -- Completed site induction
      'noise_warrant',      -- Noise control warrant holder
      'driver_licence',     -- Specific driver licence classes
      'first_aid',          -- First aid qualifications
      'security_licence',   -- Security-specific licences
      'training_level'      -- Training/competency levels
    ));
EXCEPTION
  WHEN OTHERS THEN
    RAISE NOTICE 'Could not alter officer_skills constraint: %', SQLERRM;
END $$;

-- Add additional columns to officer_skills for enhanced tracking
DO $$
BEGIN
  -- Add site_id for site-specific skills (clearances, inductions)
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'officer_skills' AND column_name = 'site_id') 
  THEN
    ALTER TABLE public.officer_skills 
      ADD COLUMN site_id UUID REFERENCES public.client_sites(id) ON DELETE SET NULL;
  END IF;
  
  -- Add training level
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'officer_skills' AND column_name = 'skill_level') 
  THEN
    ALTER TABLE public.officer_skills 
      ADD COLUMN skill_level TEXT CHECK (skill_level IN (
        'beginner', 'intermediate', 'advanced', 'expert', 'trainer'
      ));
  END IF;
  
  -- Add endorsements (for driver licences)
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'officer_skills' AND column_name = 'endorsements') 
  THEN
    ALTER TABLE public.officer_skills 
      ADD COLUMN endorsements TEXT[];
  END IF;
  
  -- Add licence class (for driver licences)
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'officer_skills' AND column_name = 'licence_class') 
  THEN
    ALTER TABLE public.officer_skills 
      ADD COLUMN licence_class TEXT;
  END IF;
  
  -- Add reminder_send_date: when to send renewal reminder (e.g., 60 days before expiry)
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'officer_skills' AND column_name = 'reminder_send_date') 
  THEN
    ALTER TABLE public.officer_skills 
      ADD COLUMN reminder_send_date DATE;  -- Date to send renewal reminder notification
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_officer_skills_site
  ON public.officer_skills(site_id) WHERE site_id IS NOT NULL;


-- ────────────────────────────────────────────────────────────────────────────
-- 4. ASSET TYPES (Equipment Categories)
-- ────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.asset_types (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   UUID        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  
  code              TEXT        NOT NULL,  -- Short code: 'UNIFORM', 'PHONE', 'LAPTOP'
  name              TEXT        NOT NULL,  -- Display name
  description       TEXT,
  
  category          TEXT        NOT NULL DEFAULT 'equipment'
    CHECK (category IN (
      'uniform',           -- Uniform items
      'ppe',               -- Personal protective equipment
      'communication',     -- Phones, radios, etc.
      'computing',         -- Laptops, tablets
      'vehicle',           -- Company vehicles
      'tool',              -- Tools and equipment
      'access',            -- Access cards, keys, etc.
      'other'
    )),
  
  -- Tracking requirements
  requires_serial_number  BOOLEAN NOT NULL DEFAULT false,
  requires_return         BOOLEAN NOT NULL DEFAULT true,
  depreciation_months     INTEGER,         -- For asset value tracking
  replacement_cost        NUMERIC(10, 2),
  
  -- Custom fields for flexibility
  custom_fields     JSONB       DEFAULT '{}'::JSONB,
  
  is_active         BOOLEAN     NOT NULL DEFAULT true,
  created_by        UUID        REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  
  UNIQUE (organization_id, code)
);

CREATE INDEX IF NOT EXISTS idx_asset_types_org
  ON public.asset_types(organization_id, is_active);

ALTER TABLE public.asset_types ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "admins_manage_asset_types" ON public.asset_types;
CREATE POLICY "admins_manage_asset_types" ON public.asset_types FOR ALL
  TO authenticated
  USING (
    get_user_role(auth.uid()) IN ('grand_master', 'master', 'admin', 'admin_officer')
  )
  WITH CHECK (
    get_user_role(auth.uid()) IN ('grand_master', 'master', 'admin', 'admin_officer')
  );

DROP POLICY IF EXISTS "auth_read_asset_types" ON public.asset_types;
CREATE POLICY "auth_read_asset_types" ON public.asset_types FOR SELECT
  TO authenticated
  USING (true);

COMMENT ON TABLE public.asset_types IS 
  'Asset/equipment type definitions that can be assigned to officers.';


-- ────────────────────────────────────────────────────────────────────────────
-- 5. OFFICER ASSETS (Equipment Assignment)
-- ────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.officer_assets (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   UUID        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  officer_id        UUID        NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
  asset_type_id     UUID        NOT NULL REFERENCES public.asset_types(id) ON DELETE CASCADE,
  
  -- Asset identification
  serial_number     TEXT,
  asset_tag         TEXT,                -- Internal asset tag/barcode
  make              TEXT,
  model             TEXT,
  description       TEXT,
  
  -- Condition tracking
  condition         TEXT        NOT NULL DEFAULT 'good'
    CHECK (condition IN ('new', 'excellent', 'good', 'fair', 'poor', 'damaged', 'retired')),
  condition_notes   TEXT,
  
  -- Assignment dates
  issued_date       DATE        NOT NULL DEFAULT CURRENT_DATE,
  expected_return   DATE,
  returned_date     DATE,
  
  -- Return processing
  return_condition  TEXT        CHECK (return_condition IN ('new', 'excellent', 'good', 'fair', 'poor', 'damaged', 'lost')),
  return_notes      TEXT,
  
  -- Value tracking
  purchase_cost     NUMERIC(10, 2),
  current_value     NUMERIC(10, 2),
  
  -- Status
  status            TEXT        NOT NULL DEFAULT 'issued'
    CHECK (status IN ('issued', 'returned', 'lost', 'damaged', 'disposed', 'transferred')),
  
  -- Acknowledgement
  acknowledged_at   TIMESTAMPTZ,         -- Officer confirmed receipt
  acknowledgement_method TEXT,           -- 'signature', 'electronic', 'email'
  
  -- Custom data
  custom_data       JSONB       DEFAULT '{}'::JSONB,
  
  notes             TEXT,
  issued_by         UUID        REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  returned_to       UUID        REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_officer_assets_org
  ON public.officer_assets(organization_id, status);

CREATE INDEX IF NOT EXISTS idx_officer_assets_officer
  ON public.officer_assets(officer_id, status);

CREATE INDEX IF NOT EXISTS idx_officer_assets_serial
  ON public.officer_assets(serial_number) WHERE serial_number IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_officer_assets_status
  ON public.officer_assets(status, issued_date);

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION public.update_officer_assets_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

DROP TRIGGER IF EXISTS trg_officer_assets_updated_at ON public.officer_assets;
CREATE TRIGGER trg_officer_assets_updated_at
  BEFORE UPDATE ON public.officer_assets
  FOR EACH ROW EXECUTE FUNCTION public.update_officer_assets_updated_at();

ALTER TABLE public.officer_assets ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "admins_manage_officer_assets" ON public.officer_assets;
CREATE POLICY "admins_manage_officer_assets" ON public.officer_assets FOR ALL
  TO authenticated
  USING (
    get_user_role(auth.uid()) IN ('grand_master', 'master', 'admin', 'admin_officer')
  )
  WITH CHECK (
    get_user_role(auth.uid()) IN ('grand_master', 'master', 'admin', 'admin_officer')
  );

DROP POLICY IF EXISTS "officers_read_own_assets" ON public.officer_assets;
CREATE POLICY "officers_read_own_assets" ON public.officer_assets FOR SELECT
  TO authenticated
  USING (officer_id = auth.uid());

COMMENT ON TABLE public.officer_assets IS 
  'Tracks equipment and assets assigned to officers: uniforms, phones, laptops, etc.';


-- ────────────────────────────────────────────────────────────────────────────
-- 6. SITE DOCUMENTS (SOPs, Maps, Instructions)
-- ────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.site_documents (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   UUID        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  client_site_id    UUID        NOT NULL REFERENCES public.client_sites(id) ON DELETE CASCADE,
  
  -- Document info
  document_type     TEXT        NOT NULL
    CHECK (document_type IN (
      'sop',               -- Standard Operating Procedure
      'site_map',          -- Site map/floor plan
      'assignment',        -- Assignment instructions
      'emergency',         -- Emergency procedures
      'contact_list',      -- Contact information
      'hazard_info',       -- Hazard information
      'patrol_route',      -- Patrol route map
      'access_info',       -- Access instructions
      'training',          -- Training material
      'other'
    )),
  
  title             TEXT        NOT NULL,
  description       TEXT,
  
  -- Content (can be URL or inline content)
  document_url      TEXT,                -- Storage bucket URL
  content           TEXT,                -- Inline content (for quick reference)
  
  -- Version control
  version           TEXT        DEFAULT '1.0',
  effective_date    DATE        NOT NULL DEFAULT CURRENT_DATE,
  expiry_date       DATE,
  
  -- Review tracking
  last_reviewed     DATE,
  next_review       DATE,
  reviewed_by       UUID        REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  
  -- Access control
  visibility        TEXT        NOT NULL DEFAULT 'officers'
    CHECK (visibility IN ('public', 'officers', 'supervisors', 'admins')),
  requires_acknowledgement BOOLEAN NOT NULL DEFAULT false,
  
  is_active         BOOLEAN     NOT NULL DEFAULT true,
  
  -- Custom data
  custom_data       JSONB       DEFAULT '{}'::JSONB,
  
  created_by        UUID        REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_site_documents_site
  ON public.site_documents(client_site_id, is_active, document_type);

CREATE INDEX IF NOT EXISTS idx_site_documents_org
  ON public.site_documents(organization_id, document_type);

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION public.update_site_documents_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

DROP TRIGGER IF EXISTS trg_site_documents_updated_at ON public.site_documents;
CREATE TRIGGER trg_site_documents_updated_at
  BEFORE UPDATE ON public.site_documents
  FOR EACH ROW EXECUTE FUNCTION public.update_site_documents_updated_at();

ALTER TABLE public.site_documents ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "admins_manage_site_documents" ON public.site_documents;
CREATE POLICY "admins_manage_site_documents" ON public.site_documents FOR ALL
  TO authenticated
  USING (
    get_user_role(auth.uid()) IN ('grand_master', 'master', 'admin', 'admin_officer')
  )
  WITH CHECK (
    get_user_role(auth.uid()) IN ('grand_master', 'master', 'admin', 'admin_officer')
  );

-- Officers can read documents based on visibility
DROP POLICY IF EXISTS "officers_read_site_documents" ON public.site_documents;
CREATE POLICY "officers_read_site_documents" ON public.site_documents FOR SELECT
  TO authenticated
  USING (
    is_active = true AND (
      visibility = 'public' OR
      visibility = 'officers' OR
      (visibility = 'supervisors' AND get_user_role(auth.uid()) IN ('admin', 'admin_officer', 'master', 'grand_master')) OR
      (visibility = 'admins' AND get_user_role(auth.uid()) IN ('admin', 'master', 'grand_master'))
    )
  );

COMMENT ON TABLE public.site_documents IS 
  'Site-specific documents including SOPs, maps, assignment instructions, and emergency procedures.';


-- ────────────────────────────────────────────────────────────────────────────
-- 7. SITE ACCESS CODES (Keys, Alarms - Encrypted)
-- ────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.site_access_codes (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   UUID        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  client_site_id    UUID        NOT NULL REFERENCES public.client_sites(id) ON DELETE CASCADE,
  
  -- Code type
  code_type         TEXT        NOT NULL
    CHECK (code_type IN (
      'alarm',             -- Alarm code
      'gate',              -- Gate code/PIN
      'door',              -- Door code/PIN
      'safe',              -- Safe combination
      'wifi',              -- WiFi password
      'key_box',           -- Key lock box code
      'elevator',          -- Elevator key/code
      'other'
    )),
  
  name              TEXT        NOT NULL,  -- e.g. 'Main Gate Code', 'Alarm Panel'
  location          TEXT,                  -- Where this code is used
  
  -- The actual code value. Supabase encrypts data at rest by default.
  -- For additional security, consider using Supabase Vault for highly sensitive codes.
  -- Access to this field is logged via log_site_access_code_access() function.
  code_value        TEXT        NOT NULL,
  
  -- Additional info
  instructions      TEXT,                  -- How to use
  valid_from        DATE,
  valid_until       DATE,
  
  -- Access control (who can view this code)
  visibility        TEXT        NOT NULL DEFAULT 'officers'
    CHECK (visibility IN ('officers', 'supervisors', 'admins')),
  
  -- Audit
  last_accessed_at  TIMESTAMPTZ,
  last_accessed_by  UUID        REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  access_count      INTEGER     NOT NULL DEFAULT 0,
  
  is_active         BOOLEAN     NOT NULL DEFAULT true,
  
  created_by        UUID        REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_site_access_codes_site
  ON public.site_access_codes(client_site_id, is_active, code_type);

-- Function to log access to codes
CREATE OR REPLACE FUNCTION public.log_site_access_code_access(p_code_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  UPDATE public.site_access_codes
  SET 
    last_accessed_at = now(),
    last_accessed_by = auth.uid(),
    access_count = access_count + 1
  WHERE id = p_code_id;
  
  RETURN true;
END;
$$;

ALTER TABLE public.site_access_codes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "admins_manage_site_access_codes" ON public.site_access_codes;
CREATE POLICY "admins_manage_site_access_codes" ON public.site_access_codes FOR ALL
  TO authenticated
  USING (
    get_user_role(auth.uid()) IN ('grand_master', 'master', 'admin', 'admin_officer')
  )
  WITH CHECK (
    get_user_role(auth.uid()) IN ('grand_master', 'master', 'admin', 'admin_officer')
  );

-- Officers can read codes based on visibility
DROP POLICY IF EXISTS "officers_read_site_access_codes" ON public.site_access_codes;
CREATE POLICY "officers_read_site_access_codes" ON public.site_access_codes FOR SELECT
  TO authenticated
  USING (
    is_active = true AND (
      visibility = 'officers' OR
      (visibility = 'supervisors' AND get_user_role(auth.uid()) IN ('admin', 'admin_officer', 'master', 'grand_master')) OR
      (visibility = 'admins' AND get_user_role(auth.uid()) IN ('admin', 'master', 'grand_master'))
    )
  );

COMMENT ON TABLE public.site_access_codes IS 
  'Sensitive access codes for sites: alarm codes, gate codes, etc. Access is logged.';


-- ────────────────────────────────────────────────────────────────────────────
-- 8. KEY MANAGEMENT SYSTEM (Wilsar-Style)
-- ────────────────────────────────────────────────────────────────────────────

-- 8.1 Key Sets (Groups of Keys)
CREATE TABLE IF NOT EXISTS public.key_sets (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   UUID        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  client_site_id    UUID        REFERENCES public.client_sites(id) ON DELETE SET NULL,
  
  name              TEXT        NOT NULL,  -- e.g. 'Main Building Keys', 'Patrol Vehicle Keys'
  description       TEXT,
  
  -- Location where keys are stored
  storage_location  TEXT,
  
  -- Key cabinet/safe info
  cabinet_number    TEXT,
  hook_number       TEXT,
  
  -- Status tracking
  status            TEXT        NOT NULL DEFAULT 'available'
    CHECK (status IN ('available', 'checked_out', 'missing', 'retired')),
  
  current_holder_id UUID        REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  checked_out_at    TIMESTAMPTZ,
  expected_return   TIMESTAMPTZ,
  
  -- Custom fields
  custom_data       JSONB       DEFAULT '{}'::JSONB,
  
  is_active         BOOLEAN     NOT NULL DEFAULT true,
  created_by        UUID        REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_key_sets_org
  ON public.key_sets(organization_id, status);

CREATE INDEX IF NOT EXISTS idx_key_sets_site
  ON public.key_sets(client_site_id) WHERE client_site_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_key_sets_holder
  ON public.key_sets(current_holder_id) WHERE current_holder_id IS NOT NULL;

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION public.update_key_sets_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

DROP TRIGGER IF EXISTS trg_key_sets_updated_at ON public.key_sets;
CREATE TRIGGER trg_key_sets_updated_at
  BEFORE UPDATE ON public.key_sets
  FOR EACH ROW EXECUTE FUNCTION public.update_key_sets_updated_at();

ALTER TABLE public.key_sets ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "admins_manage_key_sets" ON public.key_sets;
CREATE POLICY "admins_manage_key_sets" ON public.key_sets FOR ALL
  TO authenticated
  USING (
    get_user_role(auth.uid()) IN ('grand_master', 'master', 'admin', 'admin_officer')
  )
  WITH CHECK (
    get_user_role(auth.uid()) IN ('grand_master', 'master', 'admin', 'admin_officer')
  );

DROP POLICY IF EXISTS "officers_read_key_sets" ON public.key_sets;
CREATE POLICY "officers_read_key_sets" ON public.key_sets FOR SELECT
  TO authenticated
  USING (true);

-- Officers can update their own checked-out keys
DROP POLICY IF EXISTS "officers_update_own_key_sets" ON public.key_sets;
CREATE POLICY "officers_update_own_key_sets" ON public.key_sets FOR UPDATE
  TO authenticated
  USING (current_holder_id = auth.uid())
  WITH CHECK (current_holder_id = auth.uid());

COMMENT ON TABLE public.key_sets IS 
  'Key sets/bunches that can be checked out to officers. Links to client_sites.';


-- 8.2 Individual Keys (Members of Key Sets)
CREATE TABLE IF NOT EXISTS public.keys (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  key_set_id        UUID        NOT NULL REFERENCES public.key_sets(id) ON DELETE CASCADE,
  organization_id   UUID        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  
  key_number        TEXT        NOT NULL,  -- Key identifier: '1', 'A', 'M1'
  name              TEXT        NOT NULL,  -- 'Front Door', 'Server Room'
  description       TEXT,
  
  -- Physical attributes
  key_type          TEXT        DEFAULT 'standard'
    CHECK (key_type IN ('standard', 'master', 'sub_master', 'fob', 'card', 'combination', 'biometric')),
  manufacturer      TEXT,
  key_code          TEXT,                  -- Blank/cut code for replacement
  
  -- What this key opens
  opens_description TEXT,                  -- What doors/locks this key opens
  
  is_active         BOOLEAN     NOT NULL DEFAULT true,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  
  UNIQUE (key_set_id, key_number)
);

CREATE INDEX IF NOT EXISTS idx_keys_key_set
  ON public.keys(key_set_id);

ALTER TABLE public.keys ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "admins_manage_keys" ON public.keys;
CREATE POLICY "admins_manage_keys" ON public.keys FOR ALL
  TO authenticated
  USING (
    get_user_role(auth.uid()) IN ('grand_master', 'master', 'admin', 'admin_officer')
  )
  WITH CHECK (
    get_user_role(auth.uid()) IN ('grand_master', 'master', 'admin', 'admin_officer')
  );

DROP POLICY IF EXISTS "officers_read_keys" ON public.keys;
CREATE POLICY "officers_read_keys" ON public.keys FOR SELECT
  TO authenticated
  USING (true);

COMMENT ON TABLE public.keys IS 
  'Individual keys within a key set. Each key has a description of what it opens.';


-- 8.3 Key Custody (Check-out/Return Records)
CREATE TABLE IF NOT EXISTS public.key_custody (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  key_set_id        UUID        NOT NULL REFERENCES public.key_sets(id) ON DELETE CASCADE,
  organization_id   UUID        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  
  -- Custody details
  officer_id        UUID        NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
  
  -- Check-out
  checked_out_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  checked_out_by    UUID        REFERENCES public.user_profiles(id) ON DELETE SET NULL,  -- Admin who issued
  checkout_purpose  TEXT,                  -- Why keys were taken
  checkout_location TEXT,                  -- Where officer is going
  expected_return   TIMESTAMPTZ,
  
  -- Return
  returned_at       TIMESTAMPTZ,
  returned_to       UUID        REFERENCES public.user_profiles(id) ON DELETE SET NULL,  -- Admin who received
  -- Return condition: 'incomplete' means some keys from the set are missing
  return_condition  TEXT        CHECK (return_condition IN ('good', 'damaged', 'incomplete', 'partial')),
  return_notes      TEXT,
  
  -- Status
  status            TEXT        NOT NULL DEFAULT 'checked_out'
    CHECK (status IN ('checked_out', 'returned', 'overdue', 'lost')),
  
  -- Signatures (for electronic acknowledgement)
  checkout_signature_url TEXT,
  return_signature_url   TEXT,
  
  notes             TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_key_custody_set
  ON public.key_custody(key_set_id, status);

CREATE INDEX IF NOT EXISTS idx_key_custody_officer
  ON public.key_custody(officer_id, status);

CREATE INDEX IF NOT EXISTS idx_key_custody_status
  ON public.key_custody(organization_id, status, checked_out_at DESC);

-- Function to check out keys
CREATE OR REPLACE FUNCTION public.checkout_key_set(
  p_key_set_id UUID,
  p_officer_id UUID,
  p_purpose TEXT DEFAULT NULL,
  p_location TEXT DEFAULT NULL,
  p_expected_return TIMESTAMPTZ DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_custody_id UUID;
  v_org_id UUID;
BEGIN
  -- Get org and verify key set is available
  SELECT organization_id INTO v_org_id
  FROM public.key_sets
  WHERE id = p_key_set_id AND status = 'available' AND is_active = true;
  
  IF v_org_id IS NULL THEN
    RAISE EXCEPTION 'Key set not available or not found';
  END IF;
  
  -- Create custody record
  INSERT INTO public.key_custody (
    key_set_id, organization_id, officer_id,
    checked_out_at, checked_out_by, checkout_purpose, checkout_location, expected_return
  )
  VALUES (
    p_key_set_id, v_org_id, p_officer_id,
    now(), auth.uid(), p_purpose, p_location, p_expected_return
  )
  RETURNING id INTO v_custody_id;
  
  -- Update key set status
  UPDATE public.key_sets
  SET 
    status = 'checked_out',
    current_holder_id = p_officer_id,
    checked_out_at = now(),
    expected_return = p_expected_return
  WHERE id = p_key_set_id;
  
  RETURN v_custody_id;
END;
$$;

-- Function to return keys
CREATE OR REPLACE FUNCTION public.return_key_set(
  p_key_set_id UUID,
  p_condition TEXT DEFAULT 'good',
  p_notes TEXT DEFAULT NULL
)
RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_custody_id UUID;
BEGIN
  -- Find the active custody record
  SELECT id INTO v_custody_id
  FROM public.key_custody
  WHERE key_set_id = p_key_set_id AND status = 'checked_out'
  ORDER BY checked_out_at DESC
  LIMIT 1;
  
  IF v_custody_id IS NULL THEN
    RAISE EXCEPTION 'No active checkout found for this key set';
  END IF;
  
  -- Update custody record
  UPDATE public.key_custody
  SET 
    returned_at = now(),
    returned_to = auth.uid(),
    return_condition = p_condition,
    return_notes = p_notes,
    status = 'returned'
  WHERE id = v_custody_id;
  
  -- Update key set status
  UPDATE public.key_sets
  SET 
    status = CASE WHEN p_condition = 'incomplete' THEN 'missing' ELSE 'available' END,
    current_holder_id = NULL,
    checked_out_at = NULL,
    expected_return = NULL
  WHERE id = p_key_set_id;
  
  RETURN true;
END;
$$;

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION public.update_key_custody_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

DROP TRIGGER IF EXISTS trg_key_custody_updated_at ON public.key_custody;
CREATE TRIGGER trg_key_custody_updated_at
  BEFORE UPDATE ON public.key_custody
  FOR EACH ROW EXECUTE FUNCTION public.update_key_custody_updated_at();

ALTER TABLE public.key_custody ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "admins_manage_key_custody" ON public.key_custody;
CREATE POLICY "admins_manage_key_custody" ON public.key_custody FOR ALL
  TO authenticated
  USING (
    get_user_role(auth.uid()) IN ('grand_master', 'master', 'admin', 'admin_officer')
  )
  WITH CHECK (
    get_user_role(auth.uid()) IN ('grand_master', 'master', 'admin', 'admin_officer')
  );

-- Officers can read all custody records and update their own
DROP POLICY IF EXISTS "officers_read_key_custody" ON public.key_custody;
CREATE POLICY "officers_read_key_custody" ON public.key_custody FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS "officers_update_own_key_custody" ON public.key_custody;
CREATE POLICY "officers_update_own_key_custody" ON public.key_custody FOR UPDATE
  TO authenticated
  USING (officer_id = auth.uid())
  WITH CHECK (officer_id = auth.uid());

COMMENT ON TABLE public.key_custody IS 
  'Key checkout/return tracking. Full audit trail of who had which keys when.';


-- 8.4 Key Audit Log (Full Audit Trail)
CREATE TABLE IF NOT EXISTS public.key_audit_log (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   UUID        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  key_set_id        UUID        REFERENCES public.key_sets(id) ON DELETE SET NULL,
  key_custody_id    UUID        REFERENCES public.key_custody(id) ON DELETE SET NULL,
  
  -- Action details
  action            TEXT        NOT NULL
    CHECK (action IN (
      'created', 'updated', 'deleted',           -- Key set actions
      'checked_out', 'returned',                  -- Custody actions
      'marked_lost', 'marked_found',              -- Status changes
      'transferred', 'inventory_check',           -- Other actions
      'key_added', 'key_removed'                  -- Individual key changes
    )),
  
  details           JSONB       DEFAULT '{}'::JSONB,  -- Action-specific details
  
  -- Actor
  performed_by      UUID        REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  performed_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  
  -- Context
  ip_address        INET,
  user_agent        TEXT
);

CREATE INDEX IF NOT EXISTS idx_key_audit_log_set
  ON public.key_audit_log(key_set_id, performed_at DESC);

CREATE INDEX IF NOT EXISTS idx_key_audit_log_custody
  ON public.key_audit_log(key_custody_id) WHERE key_custody_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_key_audit_log_org
  ON public.key_audit_log(organization_id, performed_at DESC);

-- Trigger to auto-log key custody changes
CREATE OR REPLACE FUNCTION public.log_key_custody_audit()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.key_audit_log (organization_id, key_set_id, key_custody_id, action, performed_by, details)
    VALUES (NEW.organization_id, NEW.key_set_id, NEW.id, 'checked_out', auth.uid(),
      jsonb_build_object('officer_id', NEW.officer_id, 'purpose', NEW.checkout_purpose));
  ELSIF TG_OP = 'UPDATE' AND OLD.status = 'checked_out' AND NEW.status = 'returned' THEN
    INSERT INTO public.key_audit_log (organization_id, key_set_id, key_custody_id, action, performed_by, details)
    VALUES (NEW.organization_id, NEW.key_set_id, NEW.id, 'returned', auth.uid(),
      jsonb_build_object('condition', NEW.return_condition));
  ELSIF TG_OP = 'UPDATE' AND NEW.status = 'lost' THEN
    INSERT INTO public.key_audit_log (organization_id, key_set_id, key_custody_id, action, performed_by, details)
    VALUES (NEW.organization_id, NEW.key_set_id, NEW.id, 'marked_lost', auth.uid(), '{}'::jsonb);
  END IF;
  
  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_key_custody_audit ON public.key_custody;
CREATE TRIGGER trg_key_custody_audit
  AFTER INSERT OR UPDATE ON public.key_custody
  FOR EACH ROW EXECUTE FUNCTION public.log_key_custody_audit();

ALTER TABLE public.key_audit_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "admins_read_key_audit_log" ON public.key_audit_log;
CREATE POLICY "admins_read_key_audit_log" ON public.key_audit_log FOR SELECT
  TO authenticated
  USING (
    get_user_role(auth.uid()) IN ('grand_master', 'master', 'admin', 'admin_officer')
  );

COMMENT ON TABLE public.key_audit_log IS 
  'Complete audit trail for key management actions. Immutable log of all key-related activities.';


-- ────────────────────────────────────────────────────────────────────────────
-- 9. SEED DEFAULT ALLOWANCE TYPES
-- ────────────────────────────────────────────────────────────────────────────

-- Note: These defaults are inserted with organization_id = NULL 
-- meaning they're templates. Organizations should copy these or create their own.

-- We can't insert with NULL org_id due to NOT NULL constraint, 
-- so these become documentation/examples that orgs can reference.


-- ────────────────────────────────────────────────────────────────────────────
-- 10. HELPER VIEWS
-- ────────────────────────────────────────────────────────────────────────────

-- View: Keys currently checked out (overdue highlighted)
CREATE OR REPLACE VIEW public.v_keys_checked_out AS
SELECT 
  ks.id AS key_set_id,
  ks.name AS key_set_name,
  ks.client_site_id,
  cs.name AS site_name,
  kc.officer_id,
  up.first_name || ' ' || up.last_name AS officer_name,
  kc.checked_out_at,
  kc.expected_return,
  kc.checkout_purpose,
  kc.checkout_location,
  CASE 
    WHEN kc.expected_return < now() THEN 'overdue'
    WHEN kc.expected_return < now() + interval '1 hour' THEN 'due_soon'
    ELSE 'on_time'
  END AS return_status,
  ks.organization_id
FROM public.key_sets ks
JOIN public.key_custody kc ON kc.key_set_id = ks.id AND kc.status = 'checked_out'
JOIN public.user_profiles up ON up.id = kc.officer_id
LEFT JOIN public.client_sites cs ON cs.id = ks.client_site_id
WHERE ks.status = 'checked_out';

-- View: Officer assets summary
CREATE OR REPLACE VIEW public.v_officer_assets_summary AS
SELECT 
  oa.officer_id,
  up.first_name || ' ' || up.last_name AS officer_name,
  at.category,
  at.name AS asset_type,
  COUNT(*) FILTER (WHERE oa.status = 'issued') AS issued_count,
  COUNT(*) FILTER (WHERE oa.status = 'returned') AS returned_count,
  oa.organization_id
FROM public.officer_assets oa
JOIN public.asset_types at ON at.id = oa.asset_type_id
JOIN public.user_profiles up ON up.id = oa.officer_id
GROUP BY oa.officer_id, up.first_name, up.last_name, at.category, at.name, oa.organization_id;

-- View: Officer allowances summary
CREATE OR REPLACE VIEW public.v_officer_allowances_summary AS
SELECT 
  oa.officer_id,
  up.first_name || ' ' || up.last_name AS officer_name,
  at.category AS allowance_category,
  at.name AS allowance_type,
  SUM(oa.total_amount) AS total_amount,
  COUNT(*) AS allowance_count,
  MIN(oa.effective_date) AS earliest_date,
  MAX(oa.effective_date) AS latest_date,
  oa.organization_id
FROM public.officer_allowances oa
JOIN public.allowance_types at ON at.id = oa.allowance_type_id
JOIN public.user_profiles up ON up.id = oa.officer_id
WHERE oa.status = 'approved' OR oa.status = 'paid'
GROUP BY oa.officer_id, up.first_name, up.last_name, at.category, at.name, oa.organization_id;


-- ────────────────────────────────────────────────────────────────────────────
-- 11. MIGRATION COMPLETE
-- ────────────────────────────────────────────────────────────────────────────

DO $$
BEGIN
  RAISE NOTICE '✅ Migration 20260512000001 complete:';
  RAISE NOTICE '   • allowance_types table created (flexible, user-definable)';
  RAISE NOTICE '   • officer_allowances table created (assigned allowances)';
  RAISE NOTICE '   • officer_skills enhanced with site clearance, induction, training levels';
  RAISE NOTICE '   • asset_types table created (equipment categories)';
  RAISE NOTICE '   • officer_assets table created (equipment tracking)';
  RAISE NOTICE '   • site_documents table created (SOPs, maps, instructions)';
  RAISE NOTICE '   • site_access_codes table created (alarm codes, etc.)';
  RAISE NOTICE '   • key_sets table created (key management)';
  RAISE NOTICE '   • keys table created (individual keys)';
  RAISE NOTICE '   • key_custody table created (checkout tracking)';
  RAISE NOTICE '   • key_audit_log table created (full audit trail)';
  RAISE NOTICE '   • Helper functions: checkout_key_set(), return_key_set()';
  RAISE NOTICE '   • Views: v_keys_checked_out, v_officer_assets_summary, v_officer_allowances_summary';
END $$;
