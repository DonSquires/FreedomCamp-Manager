# Freedom Camping Refactor Audit (2026-05-10)

## Objective

Find all active Freedom Camping functionality and migrate it toward LOI-first location modeling while preserving operational continuity.

## Inventory Summary

- Total matched references across runtime + functions + tests + docs: 2650
- Highest concentration by area:
  - docs/BOB_BRAIN_DUMP.md (context dump, non-runtime)
  - supabase/functions (runtime backend)
  - src/pages (runtime frontend)
  - src/lib, src/components, src/types

## Runtime Hotspots (Priority)

1. Core scan/compliance pipeline
- supabase/functions/vehicle-ingest/index.ts
- supabase/functions/process-officer-scan/index.ts
- supabase/functions/alpr-process/index.ts
- supabase/functions/cleanup-and-recalculate/index.ts

2. Enforcement output
- supabase/functions/generate-infringement/index.ts
- supabase/functions/render-infringement-notice/index.ts
- src/pages/InfringementNotices.tsx
- src/components/features/ScanDetailPanel.tsx

3. Officer workflow surfaces
- src/pages/FieldOfficerPortal.tsx
- src/pages/ParkingOfficerPortal.tsx
- src/pages/PublicFreedomCampingMap.tsx
- src/pages/ZoneManagement.tsx

4. Reingest + historical import
- src/pages/PhotoReingest.tsx
- src/lib/edgeFunctions.ts
- supabase/functions/photo-maintenance/index.ts
- supabase/functions/import-historical-data/index.ts

## Changes Applied In This Pass

1. LOI-aware reingest candidate mapping
- supabase/functions/photo-maintenance/index.ts
  - Added support for action alias and reingest batch contract.
  - Reingest mode now returns observations with loi_id derived from zones.loi_id.

2. LOI propagation in frontend reingest call
- src/pages/PhotoReingest.tsx
  - Added loi_id to reingest observation model.
  - Passes loi_id to vehicle-ingest fallback.

3. Client typing support
- src/lib/edgeFunctions.ts
  - ingestVehicleObservation now accepts loi_id / loiId.

4. Vehicle ingest compatibility bridge
- supabase/functions/vehicle-ingest/index.ts
  - Accepts loi_id / loiId.
  - Resolves zone from zones.loi_id when zoneId is missing.
  - Passes loi_id to process-officer-scan kickoff.

5. Officer scan LOI fallback
- supabase/functions/process-officer-scan/index.ts
  - Accepts loi_id / loiId from request.
  - Resolves active zone by loi_id when observation zone_id is missing.

6. Observation schema bridge
- supabase/migrations/20260712000003_observations_loi_backfill.sql
  - Adds observations.loi_id FK to locations_of_interest.
  - Backfills observations.loi_id from zones.loi_id.
  - Adds trigger to keep observations.loi_id aligned from zone_id.

## Next Refactor Waves

1. Freedom Camping domain routing
- Replace direct zone-only resolution in high-impact paths with location context resolver:
  - zone_id -> loi_id -> geo_zone_ids

2. Enforcement entity linkage
- Add/verify loi_id bridges for notices and infringement records where zone-only assumptions remain.

3. Import pipeline modernization (Downer/LINZ XLSX)
- Update import-historical-data to emit LOI-first records and only create zone bridges as needed.

4. UI cleanup
- Migrate Freedom Camping pages to consume LOI+GeoZone context and reduce legacy zone field dependencies.

## Data Cleanup Guardrails

- Preserve photo_url and photo_hash on observations.
- Never delete evidence bucket objects in cleanup migrations.
- Archive before destructive operations.
- Run org-scoped dry runs first, then limited production windows.
