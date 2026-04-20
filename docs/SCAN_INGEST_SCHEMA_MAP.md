# Scan Ingest Schema Map

This map documents the end-to-end scan pipeline and the exact schema contract required for stable inserts.

## Expected Runtime Flow

1. Officer captures photo in [src/pages/FieldOfficerPortal.tsx](../src/pages/FieldOfficerPortal.tsx).
2. Frontend uploads image to `scans` bucket and resolves zone.
3. Frontend calls `vehicle-ingest` via [src/lib/edgeFunctions.ts](../src/lib/edgeFunctions.ts).
   - Current payload path sends `photo_url` (storage-first) to minimize request size.
   - `vehicle-ingest` downloads bytes server-side for inference when raw image payload is absent.
4. `vehicle-ingest` orchestrates inference path in [supabase/functions/vehicle-ingest/index.ts](../supabase/functions/vehicle-ingest/index.ts):
   - Primary: Bob inference on RunPod (`/infer`)
   - Backup: Plate Recognizer via [supabase/functions/_shared/alpr.ts](../supabase/functions/_shared/alpr.ts)
   - Final fallback: manual-required plate sentinel
5. `vehicle-ingest` ensures canonical vehicle row exists.
6. `vehicle-ingest` inserts into `observations`.
7. DB triggers/functions evaluate compliance and derive breach metadata.
8. API response returns observation + plate/compliance fields to officer UI.

## Frontend Helpers

1. `retryEdgeCall`: network retry wrapper in [src/pages/FieldOfficerPortal.tsx](../src/pages/FieldOfficerPortal.tsx).
2. `isTransientNetworkError`: edge transport-failure detection in [src/pages/FieldOfficerPortal.tsx](../src/pages/FieldOfficerPortal.tsx).
3. `ingestVehicleObservation` wrapper in [src/lib/edgeFunctions.ts](../src/lib/edgeFunctions.ts).
4. Direct insert fallback path in [src/pages/FieldOfficerPortal.tsx](../src/pages/FieldOfficerPortal.tsx).

## Edge Functions And Shared Helpers

1. Primary ingest orchestrator: [supabase/functions/vehicle-ingest/index.ts](../supabase/functions/vehicle-ingest/index.ts)
2. ALPR pipeline function (legacy/update mode): [supabase/functions/alpr-process/index.ts](../supabase/functions/alpr-process/index.ts)
3. Shared ALPR client: [supabase/functions/_shared/alpr.ts](../supabase/functions/_shared/alpr.ts)
4. Shared CORS headers: [supabase/functions/_shared/cors.ts](../supabase/functions/_shared/cors.ts)

## Core Tables Used Ingest Path

1. `observations` (insert target)
2. `canonical_vehicles` (plate FK/reference target)
3. `zones` (zone ownership and organization derivation)
4. `organizations` (authorization and compliance context)
5. `user_profiles` (recording officer identity)

## Schema Contract For Stable Observations Inserts

Required compatibility expectations:

1. `observations.plate_number`: text
2. `observations.recorded_at`: timestamptz
3. `observations.zone_id`: uuid
4. `observations.organization_id`: uuid
5. `observations.recorded_by`: uuid
6. `observations.photo_url`: text
7. `observations.gps_latitude`: numeric/float
8. `observations.gps_longitude`: numeric/float
9. `observations.is_compliant`: boolean-compatible
10. `observations.nights_stayed_this_month`: integer-compatible
11. `observations.consecutive_nights`: integer-compatible
12. `observations.breach_reason`: text
13. `observations.idempotency_key`: nullable text with partial unique index

## Triggers/Functions In Insert Path

Likely active on `observations` inserts and compliance derivation:

1. `trg_auto_evaluate_compliance` via `public.auto_evaluate_compliance()` from [supabase/migrations/20260318_fix_schema_functions.sql](../supabase/migrations/20260318_fix_schema_functions.sql)
2. Legacy trigger risk: `trigger_auto_compliance_check` from [supabase/migrations/20260217000002_fix_compliance_and_breach_detection.sql](../supabase/migrations/20260217000002_fix_compliance_and_breach_detection.sql)

## Known Drift Failure Signature

`COALESCE types integer and text cannot be matched` during insert strongly indicates one or more compliance-read columns (`consecutive_nights`, `nights_stayed_this_month`, `is_compliant`) are text-like in the live DB while trigger logic assumes integer/boolean semantics.

## Alignment Strategy

1. Normalize column types (or cast-safe trigger logic) before insert evaluation.
2. Remove stale triggers that assume old row keys (`observation_id`) or old tables.
3. Keep `vehicle-ingest` as sole orchestrator and keep fallback payload minimal.
4. Maintain `MANUAL_REQUIRED` seed row in `canonical_vehicles` for plate FK safety.
