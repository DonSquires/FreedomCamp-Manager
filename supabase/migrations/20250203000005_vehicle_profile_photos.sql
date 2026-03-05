-- Migration: Add profile photo fields to canonical_vehicles
-- Stores AI-selected best vehicle photo for each vehicle

-- Add profile photo columns to canonical_vehicles
ALTER TABLE canonical_vehicles
ADD COLUMN IF NOT EXISTS profile_photo_url TEXT,
ADD COLUMN IF NOT EXISTS profile_photo_score INTEGER,
ADD COLUMN IF NOT EXISTS profile_photo_updated_at TIMESTAMPTZ;

-- Add index for faster profile photo lookups
CREATE INDEX IF NOT EXISTS idx_canonical_vehicles_profile_photo
ON canonical_vehicles(vehicle_id, profile_photo_url)
WHERE profile_photo_url IS NOT NULL;

-- Add comment
COMMENT ON COLUMN canonical_vehicles.profile_photo_url IS 'AI-selected best vehicle photo URL';
COMMENT ON COLUMN canonical_vehicles.profile_photo_score IS 'AI quality score (0-100) for the selected photo';
COMMENT ON COLUMN canonical_vehicles.profile_photo_updated_at IS 'When the profile photo was last updated';
