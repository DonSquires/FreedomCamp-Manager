# ⚠️ HISTORICAL DOCUMENT — Enterprise Rebuild Plan - Best Bits Merge (2026-04-26)

> **This plan was created 2026-04-26 as part of the multi-lens rebuild synthesis process. It has been superseded by the active execution authority.**
>
> For current execution status and decisions, see:
> - **Primary Authority**: [docs/ENTERPRISE_PAIR_REVIEW_CANONICAL.md](./ENTERPRISE_PAIR_REVIEW_CANONICAL.md) (baseline: af18b1fb, 2026-05-04)
> - **Active Phase Plan**: [docs/ENTERPRISE_COLLAB_EXECUTION_PLAN_2026-05-02.md](./ENTERPRISE_COLLAB_EXECUTION_PLAN_2026-05-02.md)
> - **Session Resume**: [docs/STAGING.md](./STAGING.md) Section 7
>
> This document is retained for historical reference and has informed the strategic direction preserved in the canonical record.

---

## Review Basis

Inputs reviewed before merge:

1. Copilot independent plan: approved by Dr Bob.
2. Bob independent plan: needs revision; only grounded sections were eligible for merge.
3. Human test engine safe-mode report: completed.

## High-Confidence Strategic Direction

1. Keep current stack and deployment topology unchanged:
   - React + TypeScript + Vite
   - Supabase Postgres + RLS + Edge Functions
   - Railway proxy
   - RunPod inference
   - Vercel web
   - VPS/hPanel for PTT
   - GitHub Actions
2. Prioritize tenancy-safe execution and evidence-defensible enforcement over broad feature expansion.
3. Treat council/client procurement and governance requirements as first-class deliverables, not post-launch documentation.

## Best Bits - Stakeholder Requirements

### Platform Owner (Sales and Expansion)

1. Sell the platform on risk reduction, enforcement defensibility, and audit readiness.
2. Lead with procurement-ready artifacts: security, tenancy, runbooks, and portability.
3. Use pilot-first sales, then expand by additional councils, services, and reporting modules.

### Service Providers

1. Multi-client operations with strict data isolation.
2. Per-shift client jurisdiction and service-type routing.
3. Live patrol, welfare, breach, and dispatch oversight across contracts.
4. Commercially package managed service tiers backed by SLA reporting.

### Councils and Clients

1. View only their own sites, incidents, breaches, and reporting outputs.
2. Receive defensible evidence packs and leadership reporting.
3. Configure legal/enforcement parameters per jurisdiction without cross-client leakage.

### Procurement and Governance

1. Explicit support/SLA posture.
2. Clear portability and low lock-in behavior.
3. Auditable controls for Privacy/OIA/Public Records style obligations.
4. Security evidence aligned to NZISM-style expectations and repo security controls.

## Best Bits - Architecture and Delivery

### Backend and Data

1. Keep migration-first schema evolution and RLS as the authoritative enforcement boundary.
2. Continue org-scoping hardening using existing audit/test gates.
3. Preserve service boundaries:
   - Supabase edge as policy/data gateway
   - Railway as external proxy boundary
   - RunPod as inference boundary
   - VPS for PTT runtime

### Frontend and UX

1. Keep access registry as route/nav entitlement baseline.
2. Consolidate duplicated surfaces and preserve role-safe states.
3. Keep officer/admin/client UX aligned to operational workflows: scan, breach, notice, escalation, reporting.

### Pipelines and Governance

1. Maintain CI gate matrix:
   - lint/build/tests
   - org-scope and isolation checks
   - runtime smoke and wiring audits
2. Keep architecture artifacts under Dr Bob review.
3. Keep phase-close validation through human-test safe mode.

## Best Bits - Commercial Go-To-Market

### Owner Go-To-Market Pack

1. Procurement narrative for NZ councils and public-sector buyers.
2. Security and governance evidence bundle for buyer due diligence.
3. Pilot success template and expansion playbook.

### Service Provider Sales Pack

1. Managed enforcement offering templates by service type.
2. Client reporting templates for weekly/monthly contract review.
3. Demonstration script showing operational transparency and legal evidence chain.

## Ticketized Execution (Best-Bits Backlog)

1. Tenant boundary hardening
   - org-scope audit remediation
   - isolation test expansion for high-risk tables and workflows
2. Route and role contract convergence
   - access-registry parity checks
   - legacy route deprecation mapping
3. Council/client evidence and reporting pack
   - leadership outputs
   - export defensibility and audit trails
4. Procurement/security evidence pack
   - DR/runbooks
   - monitoring/SLA posture
   - portability/exit model
5. Release quality gates
   - keep CI and runtime smokes green
   - enforce review + human-test signoff

## Merge Rule Used

1. Anything approved and grounded was retained.
2. Any Bob content flagged as unverified/future-state was either removed or rewritten as grounded objective language.
3. The resulting plan favors implementation-safe and audit-ready commitments.

## Validation Evidence

1. Dr Bob (Copilot plan, approved):
   - `data/dr-bob-reviews/ENTERPRISE_REBUILD_PLAN_COPILOT_2026-04-25.md.2026-04-26T00-29-03-541Z.json`
2. Dr Bob (Bob plan, needs revision):
   - `data/dr-bob-reviews/ENTERPRISE_REBUILD_PLAN_BOB_2026-04-25.md.2026-04-26T00-29-06-468Z.json`
3. Human test safe mode:
   - `tools/human-test-engine/reports/2026-04-26T00-29-07-264Z/report.json`
