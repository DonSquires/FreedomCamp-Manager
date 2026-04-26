# Enterprise Rebuild Plan (Bob Independent) - 2026-04-25

## Source

Generated from live RunPod endpoint invocation (`n0bp1ifmq01cx2`) using constrained prompt, then normalized to only include evidence-grounded requirements.

## Bob Output (Evidence-Normalized)

### Stakeholder Requirements

1. Support Freedom Camping Act workflows: warnings, infringements, and notices to vacate.
	- Evidence: `docs/OFFICER_FIELD_GUIDE_ENFORCEMENT.md`, `docs/BUILD_PLAN.md`.
2. Support multiple organisations acting as service providers with distinct client visibility requirements.
	- Evidence: `src/pages/FieldOfficerPortal.tsx`, `src/pages/admin/ServiceProviderAccessSettings.tsx`, `supabase/migrations/20260605000002_service_pricing_and_client_services.sql`.
3. Ensure clients can view their own data without seeing unrelated clients.
	- Evidence: `tests/e2e/org-isolation-proof.spec.ts`, `tests/e2e/org-isolation-api.spec.ts`, `docs/PHASE4_TENANT_ISOLATION_CERTIFICATION_REPORT_2026-04-25.md`.
4. Maintain evidence chain for enforcement actions.
	- Evidence: `docs/BUILD_PLAN.md`, `docs/PHASE2_EVIDENCE_CHAIN_INTEGRITY_MODEL_2026-04-25.md`.
5. Address OIA and Privacy Act compliance expectations.
	- Evidence: `docs/BOB_NZ_COUNCILS_PROCUREMENT_TRAINING.md`, `supabase/migrations/20260514000001_org_smtp_sms_and_critical_fixes.sql`.
6. Follow NZ Digital government guidance for accessibility and digital service quality.
	- Evidence: external anchor `digital.govt.nz/standards-and-guidance`.
7. Meet NZISM-aligned security expectations.
	- Evidence: external anchor `nzism.gcsb.govt.nz` and repo security checklist docs.
8. Remain on the verified current stack.
	- Evidence: `docs/STACK_ACCESS_MAP.md`, `.github/copilot-instructions.md`.

### Council Procurement

1. Ensure platform vendors and service model meet NZ public-sector procurement expectations.
	- Evidence: `docs/BOB_NZ_COUNCILS_PROCUREMENT_TRAINING.md`, external anchor `procurement.govt.nz`.
2. Make support, security, and compliance commitments explicit.
	- Evidence: `docs/REBUILD_CROSSOVER_VERCEL_EXPO_SECURITY_CHECKLIST.md`, `docs/PHASE4_OPS_HANDOVER_AND_RUNBOOKS_2026-04-25.md`.
3. Define SLAs for uptime, response, and maintenance.
	- Evidence: `docs/BOB_NZ_COUNCILS_PROCUREMENT_TRAINING.md`, `docs/BOB_READINESS_SCORECARD.md`.

### Security Compliance

1. Enforce data protection with RLS.
	- Evidence: `docs/BUILD_PLAN.md`, `docs/LIVE_SCHEMA.md`, org isolation tests.
2. Keep provider/client role boundaries explicit in existing access and RLS controls.
	- Evidence: `src/pages/admin/ServiceProviderAccessSettings.tsx`, `supabase/migrations/20260520000001_fix_user_profiles_rls_recursion_v2.sql`.
3. Secure RunPod inference access and logging.
	- Evidence: `inference-service/README.md`, `.github/workflows/ops-bob-human-interaction-smoke.yml`.
4. Keep logging and monitoring across service layers.
	- Evidence: `.github/workflows/synthetic-monitor.yml`, `scripts/monitor-bob.sh`.
5. Keep regular security review and validation cycles.
	- Evidence: `scripts/dr-bob-review.mjs`, `scripts/human-test-engine.mjs`.

### Architecture Changes

1. Keep current stack and deployment boundaries explicit.
	- Evidence: `docs/STACK_ACCESS_MAP.md`.
2. Improve consistency in application state and workflow handling.
	- Evidence: `docs/ACCESS_NAV_FINAL_RECONCILED_PLAN_2026-04-25.md`, `docs/APP_ENTERPRISE_EXECUTION_TRACKER_2026-04-25.md`.
3. Keep schema alignment with existing multi-org and client-visibility evidence already present in repo migrations and tests.
	- Evidence: `supabase/migrations/20260612000001_ptt_channel_acl.sql`, `supabase/migrations/20260612000002_ptt_clips_org_isolation.sql`, org-isolation tests.
4. Strengthen GitHub Actions CI/CD checks.
	- Evidence: existing workflow set under `.github/workflows/`.
5. Optimize frontend production behavior.
	- Evidence: build/lint gates and high-memory build workflow.

### Rollout

1. Use staging before production cutover.
	- Evidence: `docs/DB_MIGRATION_EXECUTION_PLAN.md`, `docs/REBUILD_CROSSOVER_VERCEL_EXPO_SECURITY_CHECKLIST.md`.
2. Conduct UAT with stakeholders and providers.
	- Evidence: `docs/MANUAL_TEST_SCENARIOS.md`, human-test-engine reports.
3. Hold release gates on build/review quality.
	- Evidence: phase gate artifacts and Dr Bob review process.
4. Perform post-implementation review.
	- Evidence: tracker and gate evidence update pattern in `docs/APP_ENTERPRISE_EXECUTION_TRACKER_2026-04-25.md`.

## Bob Build-Review Gate Suggestions

1. Zero lint errors before release.
2. Successful production build.
3. Route chunk strategy for large surfaces.
4. Stable review scoring trend.
5. No unauthorized outbound dependency behavior in protected modes.

## Grounding Notes

1. Bob output was constrained by explicit prompt grounding around NZ council/client/service-provider requirements.
2. Any item without explicit evidence should be treated as not verified.
3. This artifact stays independent and is not authoritative by itself.
