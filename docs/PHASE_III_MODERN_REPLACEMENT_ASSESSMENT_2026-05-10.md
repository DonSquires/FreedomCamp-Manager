# Phase III Modern Replacement Assessment (2026-05-10)

Purpose: assess remaining archive functions against modern equivalents using live code, schema touchpoints, and architecture mapping docs.

Scope reviewed:
- Remaining archive functions in supabase/functions/_archive
- Runtime callers in src and supabase/functions (excluding _archive)
- Mapping docs: CLEAN_REBUILD_DESIGN, KEEP_MERGE_REMOVE_MATRIX, TARGET_STATE_BLUEPRINT, STAGING ownership map
- Schema grounding via active function table usage and typed schema docs

## Evidence Sources

1. Function inventory
- supabase/functions/_archive (15 function directories + README)

2. Replacement map docs
- docs/CLEAN_REBUILD_DESIGN.md
- docs/KEEP_MERGE_REMOVE_MATRIX.md
- docs/TARGET_STATE_BLUEPRINT.md
- docs/STAGING.md (Archive Function Ownership Map)

3. Runtime integration evidence
- src/lib/edgeFunctions.ts
- src/modules/registry.ts
- src/pages/CleanupAndRecalculate.tsx
- .github/workflows/deploy-edge-functions.yml

4. Schema grounding (active replacement functions)
- supabase/functions/process-officer-scan/index.ts
- supabase/functions/cleanup-and-recalculate/index.ts
- supabase/functions/create-user/index.ts
- supabase/functions/send-report-email/index.ts
- docs/LIVE_SCHEMA.md
- src/types/database.ts

5. Bob training pathway evidence
- supabase/functions/bob-multimodal-gateway/index.ts
- docs/SECRETS_REGISTRY.md
- scripts/manual-supabase-deploy.sh

## Assessment Matrix

### A) Safe candidates: modern replacement is active and schema-backed

1. alpr-retry
- Modern replacement: process-officer-scan
- Mapping evidence: CLEAN_REBUILD_DESIGN, KEEP_MERGE_REMOVE_MATRIX
- Runtime evidence: src/lib/edgeFunctions.ts uses process-officer-scan
- Recommendation: safe to remove from archive and deployment lists

2. stream-webhook
- Modern replacement: process-officer-scan
- Mapping evidence: TARGET_STATE_BLUEPRINT step confirms stream-webhook path folded into process-officer-scan
- Runtime evidence: process-officer-scan is active scan entrypoint in src/lib/edgeFunctions.ts
- Recommendation: safe to remove from archive and deployment lists

3. check-almost-breaches
- Modern replacement: cleanup-and-recalculate
- Mapping evidence: CLEAN_REBUILD_DESIGN, KEEP_MERGE_REMOVE_MATRIX
- Runtime evidence: cleanup-and-recalculate invoked in src/lib/edgeFunctions.ts and CleanupAndRecalculate page
- Schema evidence: cleanup-and-recalculate touches observations, breach_alerts, zone_compliance_matrix, organizations, compliance_results
- Recommendation: safe to remove from archive and deployment lists

4. check-zone-corrections
- Modern replacement: cleanup-and-recalculate
- Mapping evidence: CLEAN_REBUILD_DESIGN, KEEP_MERGE_REMOVE_MATRIX
- Runtime evidence: cleanup-and-recalculate active; no direct runtime call to check-zone-corrections
- Recommendation: safe to remove from archive and deployment lists

5. correct-zone-assignments
- Modern replacement: cleanup-and-recalculate
- Mapping evidence: CLEAN_REBUILD_DESIGN, KEEP_MERGE_REMOVE_MATRIX
- Runtime evidence: cleanup-and-recalculate active; no direct runtime call to correct-zone-assignments
- Recommendation: safe to remove from archive and deployment lists

6. duplicate-detection
- Modern replacement: cleanup-and-recalculate
- Mapping evidence: CLEAN_REBUILD_DESIGN, KEEP_MERGE_REMOVE_MATRIX
- Runtime evidence: cleanup-and-recalculate active and used
- Recommendation: safe to remove from archive and deployment lists

7. zone-correction
- Modern replacement: cleanup-and-recalculate
- Mapping evidence: CLEAN_REBUILD_DESIGN, KEEP_MERGE_REMOVE_MATRIX
- Runtime evidence: CleanupAndRecalculate page explicitly states standalone zone-correction is separate and not called
- Recommendation: safe to remove from archive and deployment lists after removing stale UI/help copy

8. create_auth_and_profiles
- Modern replacement: create-user
- Mapping evidence: CLEAN_REBUILD_DESIGN, KEEP_MERGE_REMOVE_MATRIX, TARGET_STATE_BLUEPRINT
- Runtime evidence: src/lib/edgeFunctions.ts uses create-user
- Schema evidence: create-user writes user_profiles with pre-authorization fields
- Recommendation: safe to remove from archive and deployment lists

9. generate-leadership-pack
- Modern replacement: send-report-email
- Mapping evidence: CLEAN_REBUILD_DESIGN report consolidation table
- Runtime evidence: src/lib/edgeFunctions.ts uses send-report-email; no runtime calls to generate-leadership-pack
- Recommendation: safe to remove from archive and deployment lists

10. generate-vehicle-report
- Modern replacement: send-report-email
- Mapping evidence: CLEAN_REBUILD_DESIGN report consolidation table
- Runtime evidence: src/lib/edgeFunctions.ts uses send-report-email; no runtime calls to generate-vehicle-report
- Recommendation: safe to remove from archive and deployment lists

11. suggest-new-zone
- Modern replacement: none required (feature intentionally removed)
- Mapping evidence: CLEAN_REBUILD_DESIGN marks it remove/not used
- Runtime evidence: no app caller found
- Recommendation: safe to remove from archive and deployment lists

12. get-weather
- Modern replacement: none required for critical enforcement flow
- Mapping evidence: CLEAN_REBUILD_DESIGN marks weather non-core and removable
- Runtime evidence: no app caller found; only docs/scripts references
- Recommendation: safe to remove from archive and deployment lists unless product owner wants weather restored

### B) Conditional keep until small refactor completes

13. admin-incident-ops
- Modern replacement intent: direct frontend flow and consolidated incident tooling
- Mapping evidence: CLEAN_REBUILD_DESIGN and REBUILD_TODO indicate archive direction
- Runtime evidence: still listed in src/modules/registry.ts edgeFunctions metadata
- Recommendation: keep temporarily until module registry metadata is updated, then remove from archive/deploy lists

14. generate-incident-pdf
- Modern replacement intent: notice/report consolidation (send-report-email + notice generators)
- Mapping evidence: CLEAN_REBUILD_DESIGN shows consolidation path
- Runtime evidence: still listed in src/modules/registry.ts edgeFunctions metadata
- Recommendation: keep temporarily until incident module metadata/report UX confirms no dependency, then remove

### C) Protected training-sensitive case (do not remove without explicit migration sign-off)

15. bob-learning-feedback-sync
- Modern replacement exists: bob-multimodal-gateway submits feedback to /learn/ingest-feedback
- Replacement evidence: supabase/functions/bob-multimodal-gateway/index.ts calls /learn/ingest-feedback directly
- Training ops evidence: secrets/docs/workflows still reference bob-learning-feedback-sync for feedback sync keying and deploy allowlist
- Recommendation: retain for now, then run explicit migration task:
  - update docs/SECRETS_REGISTRY references
  - update workflow/manual deploy public function lists
  - verify feedback ingestion smoke through bob-multimodal-gateway
  - only then remove archive function directory

## Summary Decision

- Ready for retirement now: 12 functions
- Keep until metadata cleanup: 2 functions (admin-incident-ops, generate-incident-pdf)
- Protected training migration required: 1 function (bob-learning-feedback-sync)

## Execution Update (Applied)

Completed in this session:
1. Removed 12 safe candidates from supabase/functions/_archive:
- alpr-retry
- stream-webhook
- check-almost-breaches
- check-zone-corrections
- correct-zone-assignments
- duplicate-detection
- zone-correction
- create_auth_and_profiles
- generate-leadership-pack
- generate-vehicle-report
- suggest-new-zone
- get-weather

2. Updated deploy allowlists to match removals:
- .github/workflows/deploy-edge-functions.yml (PUBLIC_FUNCTIONS trimmed)
- scripts/manual-supabase-deploy.sh (PUBLIC_FUNCTIONS trimmed)

3. Preserved protected/conditional items (not removed):
- admin-incident-ops
- generate-incident-pdf
- bob-learning-feedback-sync

4. Validation status:
- bun run lint: pass
- bun run build: pass

## Remaining Work

1. Clean module registry metadata for incident module edgeFunctions list.
2. Complete Bob feedback migration checklist, then retire bob-learning-feedback-sync.

This sequence preserves officer advisory behavior and avoids Bob training regression risk.
