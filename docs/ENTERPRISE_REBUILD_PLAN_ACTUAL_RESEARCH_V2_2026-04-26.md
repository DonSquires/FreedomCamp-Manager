# Enterprise Rebuild Plan (Actual Research V2) - 2026-04-26

## 1. Executive Direction

Build from existing schema and workflow assets already present in this repository, then close the specific production gaps that block a true enterprise-ready NZ council deployment.

This plan is constrained to verified repo reality:

1. Modular platform schema exists for module subscriptions and usage billing events.
2. CRM contracts and invoices schema exists with sequence-safe numbering and line-item modeling.
3. Invoicing UI currently states read-only and explicitly marks billing as "coming soon".
4. Per-client service assignment and service pricing tables exist.
5. Payment routing model exists via `organizations.payment_config` with BYOG secret-name pattern.
6. Multi-org isolation coverage exists in E2E suites.
7. Module-gating hook includes a permissive fallback that can over-enable features when migrations are missing.

## 2. Evidence Map (Repo-Grounded)

1. Modular module/billing model:
   - `supabase/migrations/20260504000001_modular_platform_infrastructure.sql`
2. CRM contracts/invoices/payments foundation:
   - `supabase/migrations/20260505000001_crm_hub_comprehensive.sql`
3. Per-client service enablement and service pricing:
   - `supabase/migrations/20260605000002_service_pricing_and_client_services.sql`
4. Tenant payment routing design and payment config migration:
   - `docs/PAYMENT_FLOW.md`
   - `supabase/migrations/20260613000001_organizations_payment_config.sql`
5. Current invoicing UI state (read-only):
   - `src/pages/InvoicingPage.tsx`
6. Module access hook behavior (RPC fallback and permissive all-modules fallback):
   - `src/hooks/useEnabledModules.ts`
7. Module registry and route ownership:
   - `src/modules/registry.ts`
8. Multi-org isolation tests:
   - `tests/e2e/multi-org-rls.spec.ts`
   - `tests/e2e/org-isolation-api.spec.ts`
9. NZ procurement and council context pack already in repo:
   - `docs/BOB_NZ_COUNCILS_PROCUREMENT_TRAINING.md`
   - `docs/NZ_COUNCIL_ENFORCEMENT_ENTERPRISE_RESEARCH_2026-04-25.md`

## 3. Critical Gaps to Close

1. Billing execution gap:
   - Data model exists, but user-facing billing workflow remains read-only.
   - Impact: cannot run production-grade quote-to-cash from platform UI.
2. Entitlement safety gap:
   - `useEnabledModules` can return all modules enabled when schema/RPC is absent.
   - Impact: unsafe feature exposure in partial or drifted environments.
3. Pricing-to-invoice automation gap:
   - `service_pricing` and `client_org_services` are present, but invoice line generation from usage/service rules is not yet a hardened pipeline.
   - Impact: manual operations, reconciliation risk, reduced trust for enterprise buyers.
4. Payment completion gap:
   - Payment architecture is documented and `payment_config` exists, but delivery evidence for full pay-to-ledger lifecycle must be packaged as release-gated proof.
   - Impact: procurement friction and delayed council onboarding.
5. Procurement evidence-pack gap:
   - Security, tenancy, DR, and ops artifacts exist but are not fully assembled into a buyer-facing, repeatable package.
   - Impact: slower close cycles with councils and regional authorities.

## 4. Enterprise Implementation Priorities (With Acceptance Criteria)

### Priority 1: Enforce Safe Module Entitlements

Scope:

1. Refactor `useEnabledModules` fallback behavior to fail-safe defaults (core-only) unless subscription source is verified.
2. Add explicit environment guardrails for missing module tables/RPC.
3. Add UI warning telemetry for entitlement fallback paths.

Acceptance criteria:

1. No path returns "all modules enabled" due only to migration absence.
2. Role + module access tests pass for admin/master/officer/admin_officer/grand_master scenarios.
3. CI includes an entitlement regression test that fails on permissive fallback behavior.

### Priority 2: Ship Billing Operations UI (From Read-Only to Operational)

Scope:

1. Convert invoicing surface from view-only into managed invoice lifecycle: draft -> sent -> paid/overdue/cancelled.
2. Support contract line-derived invoice generation for active contracts.
3. Add payment status updates and audit history in UI.

Acceptance criteria:

1. Admin/master can create and send invoice from contract context.
2. Invoice status transitions are persisted and auditable.
3. End-to-end scenario passes: contract -> invoice -> payment recorded -> outstanding reduced.

### Priority 3: Connect Service Pricing and Client Services to Invoice Engine

Scope:

1. Build deterministic rating logic using `service_pricing` and `client_org_services`.
2. Support fixed, hourly, and travel components where configured.
3. Produce line-item provenance (which service/pricing rule generated each line).

Acceptance criteria:

1. Generated invoice lines are reproducible from source pricing rules.
2. Finance reviewer can trace each line to rule + period + units.
3. Test fixtures cover at least three service models: fixed, hourly, travel-enabled.

### Priority 4: Operationalize Payment Routing per Organization

Scope:

1. Implement/verify payment route selection based on `organizations.payment_config` (`redirect`, `windcave_api`, `stripe_api`, `bank_transfer`).
2. Enforce secret-name lookup discipline for BYOG keys (no plaintext keys in table).
3. Add reconciliation playbooks and status sync checks.

Acceptance criteria:

1. Payment route selection is tenant-correct and tested.
2. BYOG mode validates secret references and fails safely on missing secrets.
3. Reconciliation tests prove status correctness between payment event and infringement/invoice state.

### Priority 5: Enterprise Isolation and Compliance Proof Hardening

Scope:

1. Expand RLS/tenant test coverage around billing, contracts, and payment pathways.
2. Add negative tests for cross-org read/write attempts on billing entities.
3. Align evidence with existing multi-org suites.

Acceptance criteria:

1. Cross-tenant access tests fail closed for all billing/payment entities.
2. E2E suite includes billing-isolation tests in CI.
3. Tenant isolation report is updated with new billing/payment surfaces.

### Priority 6: Build Council Procurement Evidence Pack (Productized)

Scope:

1. Package tenancy, DR, restore drills, ops handover, privacy/security controls, and support posture into a reusable buyer dossier.
2. Produce a standard council-facing architecture and controls summary.
3. Map controls to NZ procurement/security/public-sector expectations already tracked in repo training docs.

Acceptance criteria:

1. Single exportable evidence pack exists and is versioned per release.
2. Pack includes architecture diagram, incident/runbook summary, and data portability statement.
3. Procurement FAQ template exists for council review teams.

### Priority 7: Commercial-Operational Readiness for Owner and Service Providers

Scope:

1. Define owner package tiers (platform-only, managed-service, hybrid).
2. Define provider package tiers (patrol + breach handling + reporting + SLA add-ons).
3. Add measurable performance reporting templates for contract governance.

Acceptance criteria:

1. Three standard commercial bundles exist with clear inclusions/exclusions.
2. Client reporting pack is generated monthly from platform data.
3. Sales/demo narrative maps features to council outcomes (evidence defensibility, visibility, response SLA).

## 5. 90-Day Delivery Structure

### Wave 1 (Days 1-30): Control and Safety

1. Entitlement hardening (`useEnabledModules` fail-safe).
2. Billing domain test coverage expansion for org isolation.
3. Draft procurement evidence-pack template.

Gate:

1. Entitlement regression tests green.
2. No permissive module fallback paths remain.
3. Billing entity isolation tests merged.

### Wave 2 (Days 31-60): Monetization Core

1. Billing UI uplift (create/send/update invoices).
2. Contract line to invoice workflow implementation.
3. Pricing rule linkage and line-item provenance.

Gate:

1. Contract -> invoice -> payment flow demonstrated in test/staging.
2. Finance traceability checks pass.
3. No unresolved lint/build regressions.

### Wave 3 (Days 61-90): Buyer Readiness and Scale

1. Payment routing operational checks per org mode.
2. Procurement/security evidence pack finalization.
3. Owner/provider commercialization assets and council demo playbooks.

Gate:

1. Multi-mode payment routing verified.
2. Council procurement dossier signed off internally.
3. Enterprise go-live checklist complete for pilot council onboarding.

## 6. Commercialization Moves (Owner + Service Provider)

1. Owner move: sell "evidence-defensible enforcement operations" package (not just scanning software).
2. Owner move: introduce pilot-to-multi-council expansion offers with explicit data portability language.
3. Provider move: sell managed enforcement outcomes (patrol, breach lifecycle, reporting, governance support) as SLA bundles.
4. Provider move: create per-client module/service bundles aligned with `client_org_services` and `service_pricing` configuration.
5. Joint move: run stakeholder-specific demos (executive, operations, finance/procurement) with evidence outputs from live workflow data.

## 7. Procurement and Security Artifact Set (Must-Have)

1. Tenant isolation proof pack including billing/payment entities.
2. DR and restore evidence (runbook + drill summary + rollback evidence).
3. Security controls summary (secrets handling, endpoint controls, monitoring, incident response).
4. Privacy and records handling summary aligned with NZ public-sector expectations.
5. Data portability and exit plan document with export formats and transition commitments.

## 8. Bob and Planning-Agent Status for This Pass

1. Planning subagent path is rate-limited in this environment and unavailable for this run.
2. Bob bridge endpoint returned 404 in this environment and RunPod endpoint vars are not set, so direct Bob response could not be fetched in this run.
3. This artifact is therefore produced from direct repo-grounded analysis and prior Bob-reviewed repository artifacts.

## 9. Implementation Start Order

1. Entitlement and access safety hardening.
2. Billing workflow operationalization.
3. Billing tenant-isolation regression coverage.
4. Procurement/security evidence-pack productionization.