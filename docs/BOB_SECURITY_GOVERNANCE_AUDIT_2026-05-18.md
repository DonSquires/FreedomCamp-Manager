# Bob Security and Governance Audit (Evidence Snapshot)

Date: 2026-05-18  
Scope: Human authorization boundaries, org isolation, role-route permissions, and fire-control gates.

## Verified Controls

1. Human authorization boundary for enforcement print fire-control:
   - Evidence: `tests/e2e/phase4-notice-print-signature-gate.spec.ts`
   - Result: Print remains disabled until valid digital signature and explicit "Authorize Print" interaction.

2. Bob governed approval contracts preserve org-scoping and decision trails:
   - Evidence: `tests/e2e/phase-d1-bob-approval-contracts.spec.ts`
   - Result: Proposal approval/rejection/execution paths are contract-driven; org-isolation test confirms proposals for Org A are not returned under Org B scope.

3. Multi-org RLS isolation is exercised at UI and API layers:
   - Evidence: `tests/e2e/multi-org-rls.spec.ts`, `tests/e2e/org-isolation-api.spec.ts`, `tests/e2e/client-portal-isolation.spec.ts`
   - Result: Cross-org reads are blocked or return empty sets under RLS constraints.

4. Bob route permissions are covered for operational access paths:
   - Evidence: `tests/e2e/module-route-access-admin-operations-bob.spec.ts`, `tests/e2e/module-route-access-field-client.spec.ts`
   - Result: Bob assistant and queue routes are asserted under role-specific route-access suites.

5. Governance-state visual indicators now have explicit E2E coverage:
   - Evidence: `tests/e2e/bob-governance-visual-check.spec.ts`
   - Result: Gate status strip badges and execution-review reason/confidence rendering are asserted.

## Database Policy Evidence for Decision/Event Artifacts

1. Bob action proposal event table and policies are migration-backed:
   - Evidence: `supabase/migrations/20260710000004_phase_d1_bob_approval_contracts.sql`
   - Includes: table definition, org index, RLS enablement, org-read policy, service-role policy.

## Remaining Follow-up

1. Bob proposal/log route permissions can be expanded with dedicated route-access tests for proposal log endpoints.
