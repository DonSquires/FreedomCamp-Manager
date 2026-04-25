# Enterprise Rebuild Plan (Final Merged) - 2026-04-25

## 1. Final Strategy

Use current stack and infrastructure as fixed constraints, then execute a file-grounded restructure sequence using existing modules, workflows, migrations, and operational runbooks.

This merged plan combines:

1. Copilot domain architecture and ticketized implementation sequence.
2. Bob emphasis on staged rollout, route chunking, and CI discipline.

This revision also incorporates NZ-specific service-provider, council, client, procurement, and security requirements grounded in:

1. `docs/NZ_COUNCIL_ENFORCEMENT_ENTERPRISE_RESEARCH_2026-04-25.md`
2. `docs/ENTERPRISE_STAKEHOLDER_REQUIREMENTS_MATRIX_2026-04-25.md`

## 1.1 Stakeholder Outcomes

### Service Providers must get

1. Multi-client operations with strict tenant isolation.
2. Jurisdiction-aware shift tooling and service-type routing.
3. Live patrol, breach, welfare, and dispatch oversight.

### Councils and Clients must get

1. Visibility into their own sites, incidents, breaches, and reports only.
2. Evidence-defensible enforcement records and leadership reporting.
3. Configurable legal/enforcement settings within their jurisdiction.

### Procurement and Governance reviewers must get

1. A defensible security and tenancy evidence pack.
2. Clear service model, support/SLA position, and portability assurances.
3. Operational runbooks for incidents, rollback, and restore.

## 2. Verified Structural Blueprint

### 2.1 Backend Structure

1. Supabase edge function surface remains in `supabase/functions` with shared helpers in `supabase/functions/_shared`.
2. Multi-org and tenant boundaries remain enforced by RLS and org-scoped patterns evidenced in:
	- `tests/e2e/org-isolation-proof.spec.ts`
	- `tests/e2e/org-isolation-api.spec.ts`
	- `docs/ORG_ID_SCOPING_AUDIT_2026-04-25.md`
3. Railway remains the proxy boundary (`proxy-server`) with runtime wiring audits in `.github/workflows/ops-railway-wiring-audit.yml`.
4. RunPod remains the inference boundary with smoke coverage in `.github/workflows/ops-runpod-serverless-smoke.yml` and `scripts/invoke-runpod-endpoint.mjs`.
5. PTT remains on VPS/hPanel with operational standard in `docs/PTT_SELF_HOSTED_OPERATIONS_STANDARD.md` and deployment checks in `.github/workflows/deploy-voice-server.yml`.
6. Client/service-provider boundaries remain explicit in client-site, service-pricing, provider-access, and client-viewer models already evidenced in migrations and admin screens.

### 2.2 Frontend Structure

1. Keep `src/App.tsx` route tree and `src/config/accessRegistry.ts` as route/access convergence baseline.
2. Continue hook-level org-scoping standards evidenced by `scripts/audit-org-scoping.mjs` and CI gate `.github/workflows/ci-org-scope-audit.yml`.
3. Keep canonical module surfaces already tracked in `docs/APP_ENTERPRISE_EXECUTION_TRACKER_2026-04-25.md` and related phase artifacts.
4. Keep generated types and query contract alignment through `src/types/database.ts` plus migration-backed updates.

### 2.3 UX/UI Structure

1. Use existing route/access parity artifacts to keep role-visible navigation consistent:
	- `docs/ACCESS_NAV_FINAL_RECONCILED_PLAN_2026-04-25.md`
	- `src/components/features/AppLayout.tsx`
	- `src/components/features/AdminNavigationMenu.tsx`
2. Preserve tenant-safe behavior through proven org-isolation tests and RLS-backed data access.
3. Maintain mobile/web operational parity through existing mobile/PTT docs and workflows already in repo.
4. Keep NZ enforcement workflow visibility explicit: warning, infringement, notice-to-vacate, escalation, and client-safe reporting.

## 3. Wiring Harness and Contract Model

1. UI contract: typed query/mutation usage from `src/types/database.ts`.
2. Edge contract: CORS + OPTIONS + shared helper pattern in `supabase/functions/_shared`.
3. DB contract: migration chain in `supabase/migrations` plus live reference docs `docs/LIVE_SCHEMA.md` and `docs/LIVE_FUNCTIONS.md`.
4. AI contract: governance artifacts already delivered in:
	- `docs/PHASE3_AI_OUTPUT_SCHEMA_ENFORCEMENT_2026-04-25.md`
	- `docs/PHASE3_GROUNDED_SOURCE_EVIDENCE_CHECKS_2026-04-25.md`
5. Ops contract: runbooks and checks in:
	- `docs/PHASE4_OPS_HANDOVER_AND_RUNBOOKS_2026-04-25.md`
	- `docs/PHASE4_DR_PLAYBOOKS_AND_RESTORE_DRILLS_2026-04-25.md`
	- `.github/workflows/synthetic-monitor.yml`

## 4. NZ Public-Sector Readiness Model

1. Privacy posture must support Privacy Act 2020 obligations already reflected in repo training and privacy-aware schema comments.
2. Audit/export posture must support OIA/Public Records style information requests and stakeholder reporting.
3. Procurement posture should emphasize:
	- pilot-first adoption
	- managed-service clarity
	- support and SLA commitments
	- data portability and low lock-in risk
4. Security posture should reference NZISM-aligned expectations for secure endpoints, secrets, logging, and operational controls.

## 5. Enterprise Pipeline Model

### 4.1 Build and Quality Gates

1. Lint and build must pass on mainline.
2. API suites and org isolation gates must pass.
3. High-memory build gate remains available for constrained environments.

### 4.2 Runtime Reliability Gates

1. Synthetic monitor for web + Supabase + render checks.
2. Railway wiring audit and RunPod smoke checks.
3. PTT post-deploy health checks on VPS runtime.

### 4.3 Governance Gates

1. Dr Bob review for major architecture artifacts.
2. Human test engine safe-mode run for phase closures.
3. Evidence log updates in phase gate artifacts.

## 6. Implementation Tickets (Grounded)

1. Ticket R1: Consolidate and document `supabase/functions/_shared` usage across high-risk edge handlers.
2. Ticket R2: Run and remediate org-scope audit outputs via `scripts/audit-org-scoping.mjs` and CI thresholds.
3. Ticket R3: Complete route/nav parity checks against current access registry artifacts.
4. Ticket R4: Execute workflow validation set tracked in `docs/REBUILD_TODO.md` (scan, breach, notice, welfare, report).
5. Ticket R5: Run legacy-column dependency audit before any drop action, as already noted in `docs/REBUILD_TODO.md`.
6. Ticket R6: Keep CI gate matrix healthy (lint/build/API/org-isolation/smoke workflows).
7. Ticket R7: Keep release runbooks aligned with existing DR, migration, and ops handover docs.
8. Ticket R8: Formalize client/council reporting and evidence export bundles for contract review and OIA-style retrieval.
9. Ticket R9: Verify service-provider/client visibility controls against client-viewer, provider access, and shift-jurisdiction flows.
10. Ticket R10: Assemble council procurement/security evidence pack from tenancy, DR, monitoring, and support artifacts.

## 7. Phased Delivery

1. Phase A (1 week): shared helper + org-scope audit hardening (R1, R2).
2. Phase B (1 week): route/nav parity and rebuild workflow validation (R3, R4).
3. Phase C (1 week): legacy dependency audit and CI gate stabilization (R5, R6).
4. Phase D (1 week): runbook and stakeholder evidence alignment (R7, R8).
5. Phase E (1 week): client/provider visibility certification and procurement pack assembly (R9, R10).

## 8. Success Criteria

1. No unresolved cross-tenant leakage vectors in existing org-isolation proofs and audits.
2. Build/lint/API/org-isolation gates green on mainline.
3. Synthetic monitor and runtime smokes stable over agreed window.
4. Rebuild workflow validation items in `docs/REBUILD_TODO.md` completed.
5. Stakeholder requirements for service providers, councils, and clients are explicitly covered by product and reporting surfaces.
6. Final artifact set reviewed by Dr Bob and validated by human test engine.
