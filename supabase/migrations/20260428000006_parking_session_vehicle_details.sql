-- ── parking_session_vehicle_details ──────────────────────────────────────────
-- Adds vehicle make/model/colour and a separate parking sign photo URL to
-- parking_sessions so that the ALPR photo capture in the officer portal can
-- persist inferred vehicle details alongside the session record.
--
-- These columns are populated when an officer takes a front-left vehicle photo
-- during a chalk pass or recheck pass and the Railway inference service
-- successfully detects the plate / vehicle type.

ALTER TABLE parking_sessions
  ADD COLUMN IF NOT EXISTS vehicle_make   TEXT,
  ADD COLUMN IF NOT EXISTS vehicle_model  TEXT,
  ADD COLUMN IF NOT EXISTS vehicle_colour TEXT,
  ADD COLUMN IF NOT EXISTS sign_photo_url TEXT;   -- parking restriction sign photo
