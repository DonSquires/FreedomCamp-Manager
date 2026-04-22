-- ============================================================================
-- Link officer_assets issuance/return to asset_stock movements
-- Date: 2026-06-11
--
-- Adds a trigger on officer_assets so that:
--   INSERT  (status = 'issued')   → asset_stock_movements: -1 (issue)
--   UPDATE  (status → 'returned') → asset_stock_movements: +1 (return)
--   UPDATE  (status → 'lost'/'damaged'/'disposed') → no stock return (already gone)
--
-- The movement trigger on asset_stock_movements already handles updating
-- asset_stock.quantity_on_hand, so no direct stock update is needed here.
--
-- Precondition: asset_stock row must exist for the (org, asset_type, location)
-- combination. If it does not exist, the trigger creates one (quantity_on_hand=0)
-- before applying the movement, so stock never goes negative on issue.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.sync_officer_asset_to_stock()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  v_stock_id     UUID;
  v_location     TEXT := 'Main Depot';   -- default issue/return location
  v_variant      TEXT;                   -- size/colour/spec from officer_assets.custom_data->>'variant'
  v_qty_before   INTEGER;
  v_quantity     INTEGER;
  v_move_type    TEXT;
BEGIN
  -- ── INSERT: new issue ──────────────────────────────────────────────────────
  IF TG_OP = 'INSERT' AND NEW.status = 'issued' THEN
    v_move_type := 'issue';
    v_quantity  := -1;

  -- ── UPDATE: item returned to stock ────────────────────────────────────────
  ELSIF TG_OP = 'UPDATE'
    AND OLD.status = 'issued'
    AND NEW.status = 'returned' THEN
    v_move_type := 'return';
    v_quantity  := 1;

  ELSE
    -- All other transitions (lost, damaged, disposed, transferred) do not
    -- affect on-hand stock — the item was already off the shelf on issue.
    RETURN NEW;
  END IF;

  -- Resolve or create the stock row for this org + asset_type + location ─────
  -- Read variant from custom_data JSON if present
  v_variant := NEW.custom_data->>'variant';

  SELECT id, quantity_on_hand
    INTO v_stock_id, v_qty_before
    FROM public.asset_stock
   WHERE organization_id = NEW.organization_id
     AND asset_type_id   = NEW.asset_type_id
     AND location        = v_location
     AND (variant = v_variant OR (variant IS NULL AND v_variant IS NULL))
  FOR UPDATE;

  IF v_stock_id IS NULL THEN
    -- Auto-create a stock row at 0 — admin can adjust with a receive movement.
    INSERT INTO public.asset_stock (
      organization_id, asset_type_id, location, variant, quantity_on_hand
    ) VALUES (
      NEW.organization_id, NEW.asset_type_id, v_location, v_variant, 0
    )
    RETURNING id, quantity_on_hand INTO v_stock_id, v_qty_before;
  END IF;

  -- Insert the movement — the existing trg_apply_stock_movement trigger will
  -- update quantity_on_hand automatically.
  INSERT INTO public.asset_stock_movements (
    organization_id,
    asset_stock_id,
    asset_type_id,
    movement_type,
    quantity,
    quantity_before,
    quantity_after,
    officer_asset_id,
    location,
    variant,
    reason,
    performed_by
  ) VALUES (
    NEW.organization_id,
    v_stock_id,
    NEW.asset_type_id,
    v_move_type,
    v_quantity,
    v_qty_before,
    GREATEST(0, v_qty_before + v_quantity),
    NEW.id,
    v_location,
    v_variant,
    CASE v_move_type
      WHEN 'issue'  THEN 'Issued to officer'
      WHEN 'return' THEN 'Returned from officer'
    END,
    COALESCE(NEW.issued_by, auth.uid())
  );

  RETURN NEW;
END;
$$;

-- Drop and recreate so this migration is idempotent
DROP TRIGGER IF EXISTS trg_officer_asset_stock_sync ON public.officer_assets;

CREATE TRIGGER trg_officer_asset_stock_sync
  AFTER INSERT OR UPDATE OF status ON public.officer_assets
  FOR EACH ROW EXECUTE FUNCTION public.sync_officer_asset_to_stock();

COMMENT ON FUNCTION public.sync_officer_asset_to_stock() IS
  'Keeps asset_stock.quantity_on_hand in sync with officer_assets. '
  'Issuing an asset decrements on-hand stock by 1; returning it increments by 1.';
