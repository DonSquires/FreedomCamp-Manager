-- Migration: Site Field-Group Permissions
--
-- Implements a flexible RBAC layer for client_sites field visibility and
-- editability.  Fields are grouped into logical "field groups":
--
--   identity    – name, site_code, site_type, zone
--   location    – address, city, GPS
--   operational – access_instructions, hazards, special_instructions
--   contacts    – primary and emergency contacts
--   sla         – response_minutes, priority_override
--   notes       – general notes field (officers can edit this)
--   financial   – pay/charge rates, contract dates, PO numbers
--   accounting  – Microsoft 365 / Business Central linking columns
--
-- Two tables provide the permission layer:
--   site_role_permissions  – default permissions per (role, field_group)
--   site_user_permissions  – per-user overrides (NULL = inherit role default)
--
-- This design intentionally avoids FKing the `role` column to an enum so that
-- new roles can be added by inserting rows without any schema change.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. site_role_permissions ──────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.site_role_permissions (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  role        TEXT        NOT NULL,
  field_group TEXT        NOT NULL,
  can_view    BOOLEAN     NOT NULL DEFAULT false,
  can_edit    BOOLEAN     NOT NULL DEFAULT false,
  updated_by  UUID        REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (role, field_group)
);

COMMENT ON TABLE public.site_role_permissions IS
  'Default field-group visibility and editability per user role for client_sites. '
  'role is free-form text so new roles can be added without schema changes.';

CREATE INDEX IF NOT EXISTS idx_site_role_permissions_role
  ON public.site_role_permissions(role);

-- ── 2. site_user_permissions ──────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.site_user_permissions (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID        NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
  field_group TEXT        NOT NULL,
  -- NULL means "inherit from the user's role default in site_role_permissions"
  can_view    BOOLEAN,
  can_edit    BOOLEAN,
  updated_by  UUID        REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, field_group)
);

COMMENT ON TABLE public.site_user_permissions IS
  'Per-user overrides for field-group permissions on client_sites. '
  'NULL values mean the user inherits the role default from site_role_permissions.';

CREATE INDEX IF NOT EXISTS idx_site_user_permissions_user
  ON public.site_user_permissions(user_id);

-- Auto-update updated_at on both tables
CREATE OR REPLACE FUNCTION public.update_site_permissions_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

CREATE TRIGGER trg_site_role_permissions_updated_at
  BEFORE UPDATE ON public.site_role_permissions
  FOR EACH ROW EXECUTE FUNCTION public.update_site_permissions_updated_at();

CREATE TRIGGER trg_site_user_permissions_updated_at
  BEFORE UPDATE ON public.site_user_permissions
  FOR EACH ROW EXECUTE FUNCTION public.update_site_permissions_updated_at();

-- ── 3. RLS ────────────────────────────────────────────────────────────────────

ALTER TABLE public.site_role_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.site_user_permissions ENABLE ROW LEVEL SECURITY;

-- All authenticated users can read role permissions (needed to evaluate their own access)
CREATE POLICY "authenticated read site_role_permissions"
  ON public.site_role_permissions FOR SELECT
  USING (auth.uid() IS NOT NULL);

-- Admins/masters manage role permissions
CREATE POLICY "admins manage site_role_permissions"
  ON public.site_role_permissions FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.user_profiles up
      WHERE up.id = auth.uid()
        AND up.role IN ('admin', 'master', 'grand_master')
    )
  );

-- Users can read their own overrides; admins/masters can read all
CREATE POLICY "users read own site_user_permissions"
  ON public.site_user_permissions FOR SELECT
  USING (
    user_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.user_profiles up
      WHERE up.id = auth.uid()
        AND up.role IN ('admin', 'master', 'grand_master')
    )
  );

-- Admins/masters manage all user overrides
CREATE POLICY "admins manage site_user_permissions"
  ON public.site_user_permissions FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.user_profiles up
      WHERE up.id = auth.uid()
        AND up.role IN ('admin', 'master', 'grand_master')
    )
  );

-- ── 4. Seed default permissions ───────────────────────────────────────────────
--
-- Matrix: role × field_group → (can_view, can_edit)
--
-- grand_master: full access to everything
-- master:       full access to everything
-- admin:        full access to everything
-- admin_officer: all operational groups + view financial; no accounting edits
-- officer:       identity/location/operational/contacts/sla = view; notes = edit; financial/accounting = none
-- nzscv_monitor: identity + location view only (for reference during plate checks)
-- client_viewer: identity, location, contacts, sla view only (client portal)

INSERT INTO public.site_role_permissions (role, field_group, can_view, can_edit) VALUES
  -- grand_master (unrestricted)
  ('grand_master', 'identity',    true,  true),
  ('grand_master', 'location',    true,  true),
  ('grand_master', 'operational', true,  true),
  ('grand_master', 'contacts',    true,  true),
  ('grand_master', 'sla',         true,  true),
  ('grand_master', 'notes',       true,  true),
  ('grand_master', 'financial',   true,  true),
  ('grand_master', 'accounting',  true,  true),

  -- master (unrestricted)
  ('master', 'identity',    true,  true),
  ('master', 'location',    true,  true),
  ('master', 'operational', true,  true),
  ('master', 'contacts',    true,  true),
  ('master', 'sla',         true,  true),
  ('master', 'notes',       true,  true),
  ('master', 'financial',   true,  true),
  ('master', 'accounting',  true,  true),

  -- admin (full access)
  ('admin', 'identity',    true,  true),
  ('admin', 'location',    true,  true),
  ('admin', 'operational', true,  true),
  ('admin', 'contacts',    true,  true),
  ('admin', 'sla',         true,  true),
  ('admin', 'notes',       true,  true),
  ('admin', 'financial',   true,  true),
  ('admin', 'accounting',  true,  true),

  -- admin_officer: operations manager — can see/edit everything except financial/accounting edits
  ('admin_officer', 'identity',    true, true),
  ('admin_officer', 'location',    true, true),
  ('admin_officer', 'operational', true, true),
  ('admin_officer', 'contacts',    true, true),
  ('admin_officer', 'sla',         true, true),
  ('admin_officer', 'notes',       true, true),
  ('admin_officer', 'financial',   true, false),   -- can VIEW rates but not change them
  ('admin_officer', 'accounting',  false, false),

  -- officer: field officer — view operational info; can only edit notes
  ('officer', 'identity',    true,  false),
  ('officer', 'location',    true,  false),
  ('officer', 'operational', true,  false),
  ('officer', 'contacts',    true,  false),
  ('officer', 'sla',         false, false),
  ('officer', 'notes',       true,  true),   -- officers can update notes
  ('officer', 'financial',   false, false),
  ('officer', 'accounting',  false, false),

  -- nzscv_monitor: plate-check only, minimal site visibility
  ('nzscv_monitor', 'identity',    true,  false),
  ('nzscv_monitor', 'location',    true,  false),
  ('nzscv_monitor', 'operational', false, false),
  ('nzscv_monitor', 'contacts',    false, false),
  ('nzscv_monitor', 'sla',         false, false),
  ('nzscv_monitor', 'notes',       false, false),
  ('nzscv_monitor', 'financial',   false, false),
  ('nzscv_monitor', 'accounting',  false, false),

  -- client_viewer: external client portal user
  ('client_viewer', 'identity',    true,  false),
  ('client_viewer', 'location',    true,  false),
  ('client_viewer', 'operational', false, false),
  ('client_viewer', 'contacts',    true,  false),
  ('client_viewer', 'sla',         true,  false),
  ('client_viewer', 'notes',       false, false),
  ('client_viewer', 'financial',   false, false),
  ('client_viewer', 'accounting',  false, false)

ON CONFLICT (role, field_group) DO NOTHING;
