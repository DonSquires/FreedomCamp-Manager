# Enterprise Stakeholder Requirements Matrix (2026-04-25)

## Platform Owner (OnSpace/Iron Eagle)

Needs:

1. A clear NZ council procurement narrative with proof-ready security and governance artifacts.
2. A repeatable pilot-to-scale sales model for councils and multi-service contracts.
3. Packaging that supports both software-only and managed-service go-to-market options.
4. Commercial evidence that the platform reduces operational risk and improves enforcement defensibility.

Grounding:

1. `docs/BOB_NZ_COUNCILS_PROCUREMENT_TRAINING.md`
2. `docs/CAPABILITY_OVERVIEW.md`
3. `docs/REBUILD_CROSSOVER_VERCEL_EXPO_SECURITY_CHECKLIST.md`
4. `docs/NZ_COUNCIL_ENFORCEMENT_ENTERPRISE_RESEARCH_2026-04-25.md`

## Service Providers

Needs:

1. Multi-client operating model with strict org isolation.
2. Shift-time selection of client jurisdiction and service type.
3. Live patrol, welfare, breach, and dispatch visibility across contracts.
4. Billing/reporting visibility per client and service line.
5. Service-tier packaging and SLA-backed performance reporting to help win and renew client contracts.

Grounding:

1. `docs/CAPABILITY_OVERVIEW.md`
2. `src/pages/FieldOfficerPortal.tsx`
3. `src/pages/DispatchWizard.tsx`
4. `supabase/migrations/20260605000002_service_pricing_and_client_services.sql`

## Councils and Client Organisations

Needs:

1. Visibility into their own sites, breaches, and enforcement outcomes.
2. Defensible evidence packs and leadership reporting.
3. Configurable enforcement/legal settings per jurisdiction.
4. Confidence that provider access does not leak unrelated council data.

Grounding:

1. `docs/BUILD_PLAN.md`
2. `docs/OFFICER_FIELD_GUIDE_ENFORCEMENT.md`
3. `src/pages/admin/ServiceProviderAccessSettings.tsx`
4. `supabase/migrations/20260427000004_client_sites.sql`

## Field Officers

Needs:

1. Fast mobile-first scan, breach, patrol, and checkpoint workflows.
2. Offline resilience and later sync.
3. Clear enforcement mode cues (admin-first, hybrid, officer-direct).
4. Safety/welfare assurance during live operations.

Grounding:

1. `docs/BUILD_PLAN.md`
2. `docs/CAPABILITY_OVERVIEW.md`
3. `src/pages/FieldOfficerPortal.tsx`
4. `tests/e2e/offline-queue.spec.ts`

## Administrators and Supervisors

Needs:

1. Live view of patrol, welfare, breaches, and active investigations.
2. Zone/legal configuration and policy enforcement controls.
3. Reporting and leadership packs for councils and executives.
4. User, organisation, and provider-client access controls.

Grounding:

1. `src/pages/AdminPortal.tsx`
2. `docs/BUILD_PLAN.md`
3. `docs/MASTER_REPORT_SCHEDULING_GUIDE.md`
4. `docs/ACCESS_NAV_FINAL_RECONCILED_PLAN_2026-04-25.md`

## Procurement, Security, and Governance Reviewers

Needs:

1. Multi-tenant proof and security evidence.
2. Privacy, records, audit, and export readiness.
3. Operational runbooks and incident response posture.
4. Clear service levels, support model, and portability assurances.

Grounding:

1. `docs/BOB_NZ_COUNCILS_PROCUREMENT_TRAINING.md`
2. `docs/REBUILD_CROSSOVER_VERCEL_EXPO_SECURITY_CHECKLIST.md`
3. `docs/PHASE4_DR_PLAYBOOKS_AND_RESTORE_DRILLS_2026-04-25.md`
4. `docs/PHASE4_TENANT_ISOLATION_CERTIFICATION_REPORT_2026-04-25.md`
