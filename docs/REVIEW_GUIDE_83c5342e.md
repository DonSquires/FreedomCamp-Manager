# Review Guide for Commit 83c5342e

This guide breaks the large commit into thematic slices so code review can happen in smaller, lower-risk passes.

Target commit:
- `83c5342ed075f0493fc82e7417786af8c4309c44`

## Suggested Review Order

1. Database and policy gates
2. Backend/support scripts and data seeds
3. Routing and access control wiring
4. Portal/page behavior changes
5. Documentation bundle
6. Lockfile and package metadata

## Slice 1: Database and Policy Gates

Files:
- `supabase/migrations/20260517000002_noise_jobs_dispatch_targets.sql`
- `supabase/migrations/20260517095000_user_radio_preferences.sql`
- `supabase/migrations/20260517170000_service_agreement_obligations_and_client_access.sql`
- `supabase/migrations/20260517183000_client_activation_requires_signed_service_agreement.sql`
- `supabase/migrations/20260709000008_radio_floor_events.sql`
- `supabase/migrations/20260714000001_add_noise_assessment_audio_url.sql`

Review focus:
- Backward compatibility for existing rows and constraints.
- Access control and activation gating correctness.
- Migration idempotency assumptions and rollback implications.

## Slice 2: Backend/Operations Scripts and Seed Profiles

Files:
- `scripts/bootstrap-first-security-orgs.mjs`
- `scripts/import-service-provider-profile.mjs`
- `scripts/validate-entity-onboarding-readiness.mjs`
- `scripts/remediate-onboarding-client-modules.mjs`
- `scripts/remediate-onboarding-signed-agreements.mjs`
- `scripts/build-evidence-branch-queue.mjs`
- `scripts/index-evidence-exif.mjs`
- `scripts/storage-pdf-fetch-extract.sh`
- `scripts/ocr-and-picture-extract.mjs`
- `scripts/bob-monitor-service-agreement-gaps.mjs`
- `scripts/research-dispatch-scorecard.mjs`
- `scripts/research-noise-ablation.mjs`
- `scripts/research-self-heal-safety-scorecard.mjs`
- `scripts/seed-noise-research-baseline.mjs`
- `scripts/seed-smoke-research-baseline.mjs`
- `data/service-provider-profiles/marlborough-district-council.parking-profile.seed.json`
- `data/service-provider-profiles/nelson-city-council.contract-profile.seed.json`

Review focus:
- Safe defaults and environment handling.
- Read/write scope and side effects in live environments.
- Determinism of generated outputs and repeatability.

## Slice 3: Routing and Access Wiring

Files:
- `src/App.tsx`
- `src/navigation/routeManifest.ts`
- `src/hooks/useClientAccessPolicy.ts`

Review focus:
- Role/organization scoping behavior.
- Route visibility and protection expectations.
- Navigation regressions for existing role flows.

## Slice 4: Feature and Page Changes

Files:
- `src/components/features/LivePatrolCamera.tsx`
- `src/components/features/ScanDetailPanel.tsx`
- `src/pages/ClientOrganisationPortal.tsx`
- `src/pages/Disputes.tsx`
- `src/pages/InvoicingPage.tsx`
- `src/pages/ParkingEnforcementPortal.tsx`
- `src/pages/ParkingOfficerPortal.tsx`
- `src/pages/Reports.tsx`
- `src/pages/ServiceAgreements.tsx`

Review focus:
- Behavioral deltas versus current production user flows.
- Assumptions around selected org/client context.
- Data fetch sequencing and error states.

## Slice 5: Documentation Bundle

Files:
- `docs/BOB_FAILURE_SUMMARY.md`
- `docs/INSTRUCTION_MANUAL.md`
- `docs/STAGING.md`
- `docs/FIRST_SECURITY_BRANCH_JURISDICTIONS.md`
- `docs/BUCKET_DOCUMENT_GROUNDED_IMPLEMENTATION_PLAN_2026-05-17.md`
- `docs/RFIP_NCC_IMPLEMENTATION_TODO.md`
- `docs/SERVICE_PROVIDER_ALIGNMENT_TODO_2026-05-17.md`
- `docs/SERVICE_PROVIDER_REQUIREMENTS_MANUAL_FIT_2026-05-17.md`
- `docs/First-Security-Docs/README.md`
- `docs/First-Security-Docs/ENTITY_ONBOARDING_REQUIREMENTS_GATE_2026-05-17.md`
- `docs/First-Security-Docs/MULTI_CLIENT_OPERATIONS_SAMPLE_INGEST_2026-05-17.md`
- `docs/First-Security-Docs/NELSON_FREEDOM_CAMPING_EVIDENCE_METADATA_2026-05-17.md`
- `docs/First-Security-Docs/SERVICE_PROVIDER_ALIGNMENT_TODO_2026-05-17.md`
- `docs/First-Security-Docs/SERVICE_PROVIDER_REQUIREMENTS_MANUAL_FIT_2026-05-17.md`
- `docs/First-Security-Docs/SMALL_CLIENT_ALARM_PATROL_DEPUTY_COVERAGE_AUDIT_2026-05-17.md`
- `docs/First-Security-Docs/SOURCE_REQUIREMENTS_MATRIX_2026-05-17.md`
- `docs/First-Security-Docs/nelson-city-council.contract-profile.seed.json`
- `data/bob-failure-summary.json`

Review focus:
- Source-of-truth alignment with implemented code.
- Avoiding duplicated or conflicting guidance across docs.

## Slice 6: Dependency Metadata

Files:
- `package.json`
- `bun.lock`

Review focus:
- Dependency version intent.
- Lockfile consistency with runtime expectations.

## Helpful Commands

Inspect each slice quickly:

```bash
git show 83c5342e -- supabase/migrations
git show 83c5342e -- scripts data/service-provider-profiles
git show 83c5342e -- src/App.tsx src/navigation/routeManifest.ts src/hooks/useClientAccessPolicy.ts
git show 83c5342e -- src/pages src/components/features/LivePatrolCamera.tsx src/components/features/ScanDetailPanel.tsx
git show 83c5342e -- docs data/bob-failure-summary.json
git show 83c5342e -- package.json bun.lock
```
