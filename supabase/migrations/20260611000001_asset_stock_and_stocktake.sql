-- ============================================================================
-- Asset Stock & Stocktake System
-- Date: 2026-06-11
--
-- Adds on-hand stock management to the Asset Management module:
--   1. asset_stock          — current on-hand quantity per asset type per location
--   2. asset_stock_movements — every adjustment (receive, issue, return, discard, transfer)
--   3. asset_stocktakes     — stocktake sessions (header)
--   4. asset_stocktake_lines — counted quantities per type per stocktake
--
-- Design: asset_stock.quantity_on_hand is the live running total, maintained
-- by insert-only asset_stock_movements rows (append-only audit log).
-- Stocktakes capture a variance snapshot without modifying Officer Assets
-- (those are tracked separately in officer_assets).
-- ============================================================================

-- ────────────────────────────────────────────────────────────────────────────
-- 1. ASSET STOCK (On-Hand Inventory)
-- ────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.asset_stock (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id     UUID        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  asset_type_id       UUID        NOT NULL REFERENCES public.asset_types(id) ON DELETE CASCADE,

  -- Storage location label (e.g. 'Main Depot', 'Vehicle Store', 'Office Shelf A')
  location            TEXT        NOT NULL DEFAULT 'Main Depot',

  -- Variant / specification (e.g. size 'XL', colour 'Navy', spec '32GB')
  -- NULL means the asset type has no variants (e.g. a laptop, a radio)
  variant             TEXT,

  -- Running totals (updated by trigger on asset_stock_movements)
  quantity_on_hand    INTEGER     NOT NULL DEFAULT 0 CHECK (quantity_on_hand >= 0),
  quantity_allocated  INTEGER     NOT NULL DEFAULT 0 CHECK (quantity_allocated >= 0), -- issued to officers
  quantity_reserved   INTEGER     NOT NULL DEFAULT 0 CHECK (quantity_reserved >= 0),  -- reserved/pending

  -- Reorder controls
  reorder_point       INTEGER,          -- trigger restocking when on_hand drops to this
  reorder_quantity    INTEGER,          -- suggested order quantity
  min_stock_level     INTEGER DEFAULT 0,
  max_stock_level     INTEGER,

  -- Last stocktake reference
  last_stocktake_at   TIMESTAMPTZ,
  last_stocktake_by   UUID        REFERENCES public.user_profiles(id) ON DELETE SET NULL,

  notes               TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE (organization_id, asset_type_id, location, variant)
);

CREATE INDEX IF NOT EXISTS idx_asset_stock_org ON public.asset_stock(organization_id);
CREATE INDEX IF NOT EXISTS idx_asset_stock_type ON public.asset_stock(asset_type_id);

CREATE OR REPLACE FUNCTION public.update_asset_stock_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

CREATE TRIGGER trg_asset_stock_updated_at
  BEFORE UPDATE ON public.asset_stock
  FOR EACH ROW EXECUTE FUNCTION public.update_asset_stock_updated_at();

ALTER TABLE public.asset_stock ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "admins_manage_asset_stock" ON public.asset_stock;
CREATE POLICY "admins_manage_asset_stock" ON public.asset_stock FOR ALL
  TO authenticated
  USING  (get_user_role(auth.uid()) IN ('grand_master', 'master', 'admin', 'admin_officer'))
  WITH CHECK (get_user_role(auth.uid()) IN ('grand_master', 'master', 'admin', 'admin_officer'));

DROP POLICY IF EXISTS "auth_read_asset_stock" ON public.asset_stock;
CREATE POLICY "auth_read_asset_stock" ON public.asset_stock FOR SELECT
  TO authenticated USING (true);

COMMENT ON TABLE public.asset_stock IS
  'On-hand stock quantities per asset type per storage location. '
  'Updated via asset_stock_movements.';


-- ────────────────────────────────────────────────────────────────────────────
-- 2. ASSET STOCK MOVEMENTS (Append-Only Ledger)
-- ────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.asset_stock_movements (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id     UUID        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  asset_stock_id      UUID        NOT NULL REFERENCES public.asset_stock(id) ON DELETE CASCADE,
  asset_type_id       UUID        NOT NULL REFERENCES public.asset_types(id) ON DELETE CASCADE,

  -- Variant carried from the stock row for denormalised reporting
  variant             TEXT,

  movement_type       TEXT        NOT NULL
    CHECK (movement_type IN (
      'receive',        -- New stock received (purchase, donation)
      'issue',          -- Issued to an officer (links to officer_assets)
      'return',         -- Returned from officer back to stock
      'discard',        -- Written off (broken, expired, lost)
      'transfer_in',    -- Transferred in from another location
      'transfer_out',   -- Transferred out to another location
      'stocktake_adjustment', -- Quantity corrected after a stocktake count
      'initial'         -- Opening stock entry
    )),

  quantity            INTEGER     NOT NULL,  -- positive = increase, negative = decrease
  quantity_before     INTEGER     NOT NULL,  -- snapshot of on_hand before this movement
  quantity_after      INTEGER     NOT NULL,  -- snapshot of on_hand after this movement

  -- Optional references
  officer_asset_id    UUID        REFERENCES public.officer_assets(id) ON DELETE SET NULL,
  stocktake_line_id   UUID,                  -- FK added after stocktake_lines table created
  reference_number    TEXT,                  -- PO number, delivery docket, transfer ID
  supplier            TEXT,
  unit_cost           NUMERIC(10, 2),
  location            TEXT,
  quantity_received   INTEGER,    -- for 'receive' movements: total units in this delivery

  reason              TEXT,
  notes               TEXT,
  performed_by        UUID        REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_asset_movements_stock ON public.asset_stock_movements(asset_stock_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_asset_movements_org   ON public.asset_stock_movements(organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_asset_movements_type  ON public.asset_stock_movements(asset_type_id);

ALTER TABLE public.asset_stock_movements ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "admins_manage_asset_movements" ON public.asset_stock_movements;
CREATE POLICY "admins_manage_asset_movements" ON public.asset_stock_movements FOR ALL
  TO authenticated
  USING  (get_user_role(auth.uid()) IN ('grand_master', 'master', 'admin', 'admin_officer'))
  WITH CHECK (get_user_role(auth.uid()) IN ('grand_master', 'master', 'admin', 'admin_officer'));

DROP POLICY IF EXISTS "auth_read_asset_movements" ON public.asset_stock_movements;
CREATE POLICY "auth_read_asset_movements" ON public.asset_stock_movements FOR SELECT
  TO authenticated USING (true);

COMMENT ON TABLE public.asset_stock_movements IS
  'Append-only ledger of every stock movement. '
  'quantity_before/after provide a full reconcilable audit trail.';


-- ────────────────────────────────────────────────────────────────────────────
-- 3. ASSET STOCKTAKES (Session Header)
-- ────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.asset_stocktakes (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id     UUID        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,

  name                TEXT        NOT NULL,  -- e.g. 'Q2 2026 Uniform Count'
  location            TEXT,                  -- NULL = all locations
  notes               TEXT,

  status              TEXT        NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'in_progress', 'completed', 'cancelled')),

  started_at          TIMESTAMPTZ,
  completed_at        TIMESTAMPTZ,

  created_by          UUID        REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  completed_by        UUID        REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_stocktakes_org ON public.asset_stocktakes(organization_id, status);

CREATE OR REPLACE FUNCTION public.update_asset_stocktakes_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

CREATE TRIGGER trg_asset_stocktakes_updated_at
  BEFORE UPDATE ON public.asset_stocktakes
  FOR EACH ROW EXECUTE FUNCTION public.update_asset_stocktakes_updated_at();

ALTER TABLE public.asset_stocktakes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "admins_manage_stocktakes" ON public.asset_stocktakes;
CREATE POLICY "admins_manage_stocktakes" ON public.asset_stocktakes FOR ALL
  TO authenticated
  USING  (get_user_role(auth.uid()) IN ('grand_master', 'master', 'admin', 'admin_officer'))
  WITH CHECK (get_user_role(auth.uid()) IN ('grand_master', 'master', 'admin', 'admin_officer'));

DROP POLICY IF EXISTS "auth_read_stocktakes" ON public.asset_stocktakes;
CREATE POLICY "auth_read_stocktakes" ON public.asset_stocktakes FOR SELECT
  TO authenticated USING (true);

COMMENT ON TABLE public.asset_stocktakes IS
  'Stocktake session headers. Lines are in asset_stocktake_lines.';


-- ────────────────────────────────────────────────────────────────────────────
-- 4. ASSET STOCKTAKE LINES (Per-Type Counted Quantities)
-- ────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.asset_stocktake_lines (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  stocktake_id        UUID        NOT NULL REFERENCES public.asset_stocktakes(id) ON DELETE CASCADE,
  organization_id     UUID        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  asset_type_id       UUID        NOT NULL REFERENCES public.asset_types(id) ON DELETE CASCADE,
  asset_stock_id      UUID        REFERENCES public.asset_stock(id) ON DELETE SET NULL,
  location            TEXT,
  variant             TEXT,

  -- Counts
  system_quantity     INTEGER     NOT NULL DEFAULT 0,  -- what the system said we had
  counted_quantity    INTEGER,                          -- what was physically counted (null = not yet counted)
  variance            INTEGER GENERATED ALWAYS AS (
    CASE WHEN counted_quantity IS NOT NULL
    THEN counted_quantity - system_quantity
    ELSE NULL END
  ) STORED,

  -- Adjustment applied
  adjustment_applied  BOOLEAN     NOT NULL DEFAULT false,
  adjustment_movement_id UUID     REFERENCES public.asset_stock_movements(id) ON DELETE SET NULL,

  notes               TEXT,
  counted_by          UUID        REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  counted_at          TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE (stocktake_id, asset_type_id, location, variant)
);

CREATE INDEX IF NOT EXISTS idx_stocktake_lines_session ON public.asset_stocktake_lines(stocktake_id);
CREATE INDEX IF NOT EXISTS idx_stocktake_lines_type    ON public.asset_stocktake_lines(asset_type_id);

CREATE OR REPLACE FUNCTION public.update_stocktake_lines_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

CREATE TRIGGER trg_stocktake_lines_updated_at
  BEFORE UPDATE ON public.asset_stocktake_lines
  FOR EACH ROW EXECUTE FUNCTION public.update_stocktake_lines_updated_at();

-- Back-fill the FK from asset_stock_movements to stocktake lines
ALTER TABLE public.asset_stock_movements
  ADD CONSTRAINT fk_asset_movements_stocktake_line
  FOREIGN KEY (stocktake_line_id) REFERENCES public.asset_stocktake_lines(id) ON DELETE SET NULL;

ALTER TABLE public.asset_stocktake_lines ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "admins_manage_stocktake_lines" ON public.asset_stocktake_lines;
CREATE POLICY "admins_manage_stocktake_lines" ON public.asset_stocktake_lines FOR ALL
  TO authenticated
  USING  (get_user_role(auth.uid()) IN ('grand_master', 'master', 'admin', 'admin_officer'))
  WITH CHECK (get_user_role(auth.uid()) IN ('grand_master', 'master', 'admin', 'admin_officer'));

DROP POLICY IF EXISTS "auth_read_stocktake_lines" ON public.asset_stocktake_lines;
CREATE POLICY "auth_read_stocktake_lines" ON public.asset_stocktake_lines FOR SELECT
  TO authenticated USING (true);

COMMENT ON TABLE public.asset_stocktake_lines IS
  'Per-asset-type count lines within a stocktake. '
  'variance = counted_quantity - system_quantity (negative = shortage).';


-- ────────────────────────────────────────────────────────────────────────────
-- 5. TRIGGER: Auto-update asset_stock.quantity_on_hand on movement insert
-- ────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.apply_asset_stock_movement()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  UPDATE public.asset_stock
  SET
    quantity_on_hand = GREATEST(0, quantity_on_hand + NEW.quantity),
    updated_at       = now()
  WHERE id = NEW.asset_stock_id;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_apply_stock_movement ON public.asset_stock_movements;
CREATE TRIGGER trg_apply_stock_movement
  AFTER INSERT ON public.asset_stock_movements
  FOR EACH ROW EXECUTE FUNCTION public.apply_asset_stock_movement();

COMMENT ON FUNCTION public.apply_asset_stock_movement() IS
  'Maintains asset_stock.quantity_on_hand as the sum of all movements.';
