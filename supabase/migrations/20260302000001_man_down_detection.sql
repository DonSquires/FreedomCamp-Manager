-- ===========================================
-- MAN-DOWN DETECTION
-- Adds 'man_down' alert type to officer welfare alerts
-- and a critical_gps_stationary_seconds threshold to settings.
-- Compliant with Health & Safety at Work Act 2015, s36-s38 PCBU duties.
-- ===========================================

-- Add man_down to allowed alert types
ALTER TABLE officer_welfare_alerts
  DROP CONSTRAINT IF EXISTS officer_welfare_alerts_alert_type_check;

ALTER TABLE officer_welfare_alerts
  ADD CONSTRAINT officer_welfare_alerts_alert_type_check
  CHECK (alert_type IN ('inactivity', 'gps_lost', 'manual', 'investigation_overdue', 'man_down'));

-- Add man-down-specific threshold to welfare settings
ALTER TABLE officer_welfare_settings
  ADD COLUMN IF NOT EXISTS man_down_enabled BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS man_down_stationary_minutes INT NOT NULL DEFAULT 15,
  ADD COLUMN IF NOT EXISTS man_down_escalation_minutes INT NOT NULL DEFAULT 5;

COMMENT ON COLUMN officer_welfare_settings.man_down_enabled IS 'Enable automatic Man-Down detection (GPS stationary + unacknowledged welfare alert)';
COMMENT ON COLUMN officer_welfare_settings.man_down_stationary_minutes IS 'Minutes GPS must be stationary before triggering Man-Down alert (default 15)';
COMMENT ON COLUMN officer_welfare_settings.man_down_escalation_minutes IS 'Minutes after Man-Down alert before auto-escalation to critical (default 5)';
