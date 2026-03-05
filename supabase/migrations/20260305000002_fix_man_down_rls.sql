-- ===========================================
-- FIX: OFFICER WELFARE ALERTS RLS FOR MAN-DOWN
-- Officers must be able to INSERT their own man-down alerts (triggered
-- client-side in useManDownDetection hook) and UPDATE them to self-resolve.
-- Health & Safety at Work Act 2015 — lone worker emergency alert flow.
-- ===========================================

-- Officers can insert their own welfare alerts (man-down trigger)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'officer_welfare_alerts'
      AND policyname = 'officers_insert_own_welfare_alert'
  ) THEN
    CREATE POLICY "officers_insert_own_welfare_alert"
      ON public.officer_welfare_alerts FOR INSERT
      TO authenticated
      WITH CHECK (officer_id = auth.uid());
  END IF;
END $$;

-- Officers can update (self-resolve / escalate) their own welfare alerts
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'officer_welfare_alerts'
      AND policyname = 'officers_update_own_welfare_alert'
  ) THEN
    CREATE POLICY "officers_update_own_welfare_alert"
      ON public.officer_welfare_alerts FOR UPDATE
      TO authenticated
      USING (officer_id = auth.uid())
      WITH CHECK (officer_id = auth.uid());
  END IF;
END $$;
