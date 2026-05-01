-- Bob User Profiles
-- Stores per-user Bob persona preferences, tone settings, and ACL tier.
-- This table is append-safe: adding new preference keys never requires a migration.

CREATE TABLE IF NOT EXISTS public.bob_user_profiles (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id               uuid        NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
  organization_id       uuid        REFERENCES public.organizations(id) ON DELETE CASCADE,

  -- Bob persona tier (mirrors application role but is independently configurable)
  -- captain   → master (full access, can modify Bob's core behaviour rules)
  -- commander → admin  (full data access, limited system modification)
  -- officer   → admin_officer (operational access, no config changes)
  -- ensign    → officer (query-only, no Computer Use / file access)
  -- guest     → unauthenticated or newly invited user
  bob_tier             text        NOT NULL DEFAULT 'ensign'
                          CHECK (bob_tier IN ('captain','commander','officer','ensign','guest')),

  -- Tone / personality preference
  tone                 text        NOT NULL DEFAULT 'professional'
                          CHECK (tone IN ('professional','technical','casual','brief','verbose','sarcastic')),

  -- Preferred response language (BCP-47, e.g. 'en-NZ', 'mi')
  language             text        NOT NULL DEFAULT 'en-NZ',

  -- ACL flags (JSON object for extensibility)
  -- Keys: computer_use, view_all_org_data, modify_bob_rules, access_financials,
  --       access_officer_welfare, access_compliance_reports, access_alpr
  permissions          jsonb       NOT NULL DEFAULT '{}'::jsonb,

  -- Topic memory seeds – Bob injects these as pre-context for this user
  -- e.g. { "prefers_metric": true, "home_zone": "Queenstown", "vehicle": "Toyota Hilux" }
  memory_seeds         jsonb       NOT NULL DEFAULT '{}'::jsonb,

  -- URI prefix for this user's isolated memory/RAG namespace
  -- Defaults to "org:<org_id>/user:<user_id>" — override here if needed
  memory_namespace     text,

  -- UI theme Bob will recommend/enforce for this user
  -- (frontend reads this; Bob references it in responses)
  ui_theme             text        NOT NULL DEFAULT 'system'
                          CHECK (ui_theme IN ('system','dark','light','lcars')),

  -- Whether Bob uses "Computer Use" (mouse/keyboard automation) for this user
  computer_use_enabled boolean     NOT NULL DEFAULT false,

  -- Custom wake-word entry code (e.g. "Bob, this is Commander Sarah")
  -- Null = no custom entry code required beyond normal auth
  entry_code           text,

  -- Free-text overrides for Bob's system prompt specific to this user
  system_prompt_suffix text,

  -- Whether this profile is active
  is_active            boolean     NOT NULL DEFAULT true,

  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),

  UNIQUE (user_id)
);

-- Updated_at trigger
CREATE OR REPLACE FUNCTION public.set_bob_user_profiles_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_bob_user_profiles_updated_at ON public.bob_user_profiles;
CREATE TRIGGER trg_bob_user_profiles_updated_at
  BEFORE UPDATE ON public.bob_user_profiles
  FOR EACH ROW EXECUTE FUNCTION public.set_bob_user_profiles_updated_at();

-- RLS
ALTER TABLE public.bob_user_profiles ENABLE ROW LEVEL SECURITY;

-- Users can read their own profile
DROP POLICY IF EXISTS "bob_profile_select_own" ON public.bob_user_profiles;
CREATE POLICY "bob_profile_select_own"
  ON public.bob_user_profiles FOR SELECT
  USING (user_id = auth.uid());

-- Users can update their own non-ACL fields (tier + permissions are admin-only)
DROP POLICY IF EXISTS "bob_profile_update_own" ON public.bob_user_profiles;
CREATE POLICY "bob_profile_update_own"
  ON public.bob_user_profiles FOR UPDATE
  USING (user_id = auth.uid())
  WITH CHECK (
    user_id = auth.uid()
    -- Prevent self-escalation: tier and permissions can only be changed by admin/master
    AND bob_tier = (SELECT bob_tier FROM public.bob_user_profiles WHERE user_id = auth.uid())
    AND permissions = (SELECT permissions FROM public.bob_user_profiles WHERE user_id = auth.uid())
  );

-- Admins / masters can read all profiles in their org
DROP POLICY IF EXISTS "bob_profile_select_admin" ON public.bob_user_profiles;
CREATE POLICY "bob_profile_select_admin"
  ON public.bob_user_profiles FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.user_profiles up
      WHERE up.id = auth.uid()
        AND up.organization_id = bob_user_profiles.organization_id
        AND up.role IN ('admin','master','admin_officer')
    )
  );

-- Admins / masters can upsert profiles for their org members
DROP POLICY IF EXISTS "bob_profile_upsert_admin" ON public.bob_user_profiles;
CREATE POLICY "bob_profile_upsert_admin"
  ON public.bob_user_profiles FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.user_profiles up
      WHERE up.id = auth.uid()
        AND up.organization_id = bob_user_profiles.organization_id
        AND up.role IN ('admin','master')
    )
  );

-- Service role has full access (edge functions, Bob inference)
-- (service role bypasses RLS by default — no extra policy needed)

-- Helper function: auto-provision a Bob profile when a user_profile is inserted
CREATE OR REPLACE FUNCTION public.auto_provision_bob_profile()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_tier text;
BEGIN
  -- Map application role → Bob tier
  v_tier := CASE NEW.role
    WHEN 'master'       THEN 'captain'
    WHEN 'admin'        THEN 'commander'
    WHEN 'admin_officer' THEN 'officer'
    WHEN 'officer'      THEN 'ensign'
    ELSE                     'guest'
  END;

  INSERT INTO public.bob_user_profiles (user_id, organization_id, bob_tier)
  VALUES (NEW.id, NEW.organization_id, v_tier)
  ON CONFLICT (user_id) DO UPDATE
    SET bob_tier = EXCLUDED.bob_tier,
        organization_id = EXCLUDED.organization_id;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_auto_provision_bob_profile ON public.user_profiles;
CREATE TRIGGER trg_auto_provision_bob_profile
  AFTER INSERT OR UPDATE OF role, organization_id ON public.user_profiles
  FOR EACH ROW EXECUTE FUNCTION public.auto_provision_bob_profile();

-- Back-fill Bob profiles for all existing users
INSERT INTO public.bob_user_profiles (user_id, organization_id, bob_tier)
SELECT
  up.id,
  up.organization_id,
  CASE up.role
    WHEN 'master'       THEN 'captain'
    WHEN 'admin'        THEN 'commander'
    WHEN 'admin_officer' THEN 'officer'
    WHEN 'officer'      THEN 'ensign'
    ELSE                     'guest'
  END
FROM public.user_profiles up
ON CONFLICT (user_id) DO NOTHING;

-- Index for fast lookups by org
CREATE INDEX IF NOT EXISTS idx_bob_user_profiles_org
  ON public.bob_user_profiles (organization_id);

COMMENT ON TABLE public.bob_user_profiles IS
  'Per-user Bob AI persona, tone, ACL tier, and memory configuration. '
  'One row per user. Auto-provisioned on user_profile insert/update. '
  'Tier hierarchy: captain > commander > officer > ensign > guest.';
