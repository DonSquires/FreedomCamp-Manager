-- ============================================================================
-- Add Weather Conditions to Observations
-- ============================================================================
-- Captures weather conditions at the time of vehicle observation
-- Weather data provided by client via get-weather edge function
-- ============================================================================

-- Add weather_conditions column to observations
ALTER TABLE observations
ADD COLUMN IF NOT EXISTS weather_conditions TEXT;

-- Add index for weather queries
CREATE INDEX IF NOT EXISTS idx_observations_weather 
ON observations(weather_conditions) 
WHERE weather_conditions IS NOT NULL;

-- Add comment
COMMENT ON COLUMN observations.weather_conditions IS 
'Weather conditions at time of observation (e.g., "Sunny", "Rainy", "Cloudy", "Overcast"). Fetched via get-weather edge function.';

-- Update existing NULL values with placeholder (optional - can remove if you want to leave as NULL)
-- UPDATE observations 
-- SET weather_conditions = 'Unknown' 
-- WHERE weather_conditions IS NULL AND recorded_at < NOW();

