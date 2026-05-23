-- Breach Alerts and Notice to Vacate Integration
-- Link breach alerts to notices, track notice count, and record enforcement actions

-- Add notice tracking columns to breach_alerts
ALTER TABLE public.breach_alerts 
  ADD COLUMN IF NOT EXISTS notices_issued INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_notice_issued_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_notice_id UUID REFERENCES public.notices_to_vacate(id) ON DELETE SET NULL;

-- Add breach alert reference to notices_to_vacate
ALTER TABLE public.notices_to_vacate 
  ADD COLUMN IF NOT EXISTS breach_alert_id UUID REFERENCES public.breach_alerts(id) ON DELETE SET NULL;

-- Create index for performance
CREATE INDEX IF NOT EXISTS idx_breach_alerts_notices ON public.breach_alerts(notices_issued, last_notice_issued_at);
CREATE INDEX IF NOT EXISTS idx_notices_breach_alert ON public.notices_to_vacate(breach_alert_id);

-- Function to get breach alert with observation details
CREATE OR REPLACE FUNCTION get_breach_alert_observations(p_breach_alert_id UUID)
RETURNS TABLE (
  observation_id UUID,
  recorded_at TIMESTAMPTZ,
  is_compliant BOOLEAN,
  gps_latitude NUMERIC(10,8),
  gps_longitude NUMERIC(11,8),
  evidence_photos JSONB,
  notes TEXT,
  zone_name TEXT,
  compliance_violation_reasons TEXT[]
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    vo.observation_id,
    vo.recorded_at,
    vo.is_compliant,
    vo.gps_latitude,
    vo.gps_longitude,
    CASE
      WHEN vo.photo IS NULL OR btrim(vo.photo) = '' THEN '[]'::jsonb
      ELSE jsonb_build_array(vo.photo)
    END AS evidence_photos,
    vo.notes,
    z.name AS zone_name,
    cr.violation_reasons AS compliance_violation_reasons
  FROM public.vehicle_observations vo
  LEFT JOIN public.zones z ON z.id = vo.zone_id
  LEFT JOIN public.compliance_results cr ON cr.observation_id = vo.observation_id
  WHERE vo.vehicle_id = (
    SELECT cv.vehicle_id 
    FROM public.breach_alerts ba
    LEFT JOIN public.vehicle_records vr ON vr.id = ba.vehicle_record_id
    LEFT JOIN public.canonical_vehicles cv ON cv.plate_number = vr.plate_number
    WHERE ba.id = p_breach_alert_id
    LIMIT 1
  )
  AND vo.is_compliant = false
  AND vo.zone_id = (SELECT zone_id FROM public.breach_alerts WHERE id = p_breach_alert_id)
  ORDER BY vo.recorded_at DESC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant execute permissions
GRANT EXECUTE ON FUNCTION get_breach_alert_observations TO authenticated, service_role;

-- Trigger to increment notice count when notice is created from breach alert
CREATE OR REPLACE FUNCTION increment_breach_notice_count()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.breach_alert_id IS NOT NULL THEN
    UPDATE public.breach_alerts
    SET 
      notices_issued = notices_issued + 1,
      last_notice_issued_at = NEW.issued_at,
      last_notice_id = NEW.id
    WHERE id = NEW.breach_alert_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_increment_breach_notice_count
  AFTER INSERT ON public.notices_to_vacate
  FOR EACH ROW
  EXECUTE FUNCTION increment_breach_notice_count();

COMMENT ON COLUMN public.breach_alerts.notices_issued IS 'Count of notices to vacate issued for this breach';
COMMENT ON COLUMN public.notices_to_vacate.breach_alert_id IS 'Link to the breach alert that triggered this notice';
COMMENT ON FUNCTION get_breach_alert_observations IS 'Returns all non-compliant observations for a breach alert';
