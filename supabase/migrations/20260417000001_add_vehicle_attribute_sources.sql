-- Add vehicle_attribute_sources JSON column to observations
-- Tracks the source (nzscv/canonical/inference/alpr) for each vehicle attribute

ALTER TABLE observations
ADD COLUMN vehicle_attribute_sources JSONB DEFAULT NULL;

-- Structure of vehicle_attribute_sources:
-- {
--   "make_source": "nzscv" | "canonical" | "inference" | "alpr" | null,
--   "model_source": "nzscv" | "canonical" | "inference" | "alpr" | null,
--   "color_source": "nzscv" | "canonical" | "inference" | "alpr" | null,
--   "year_source": "nzscv" | "canonical" | "inference" | "alpr" | null
-- }

-- Add comment explaining the field
COMMENT ON COLUMN observations.vehicle_attribute_sources IS 'JSON object tracking source of vehicle attributes (make/model/color/year). Values: nzscv (registry), canonical (internal db), inference (AI), alpr (plate recognizer), null (not available)';
