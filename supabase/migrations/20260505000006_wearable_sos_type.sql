-- Migration: add sos_wearable to officer_welfare_alerts alert_type (B-14)
--
-- The wearable-sos edge function creates alerts with alert_type = 'sos_wearable'
-- to distinguish Apple Watch / BLE device SOS from a manually triggered SOS.
-- The constraint is an inline CHECK so we must drop + recreate.

ALTER TABLE public.officer_welfare_alerts
  DROP CONSTRAINT IF EXISTS officer_welfare_alerts_alert_type_check;

ALTER TABLE public.officer_welfare_alerts
  ADD CONSTRAINT officer_welfare_alerts_alert_type_check
  CHECK (alert_type IN (
    'inactivity',
    'gps_lost',
    'manual',
    'investigation_overdue',
    'man_down',
    'sos',
    'sos_wearable'
  ));

COMMENT ON COLUMN public.officer_welfare_alerts.alert_type IS
  'inactivity | gps_lost | manual | investigation_overdue | man_down | sos | sos_wearable';
