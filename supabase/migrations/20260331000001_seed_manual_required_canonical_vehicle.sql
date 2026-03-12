-- Ensure fallback/manual observations can satisfy plate_number FK constraints
-- on schemas where observations.plate_number references canonical_vehicles.

INSERT INTO public.canonical_vehicles (plate_number)
SELECT 'MANUAL_REQUIRED'
WHERE NOT EXISTS (
  SELECT 1
  FROM public.canonical_vehicles
  WHERE plate_number = 'MANUAL_REQUIRED'
);
