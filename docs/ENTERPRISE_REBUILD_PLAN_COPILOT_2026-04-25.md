# Enterprise Rebuild Plan (Copilot Independent) - 2026-04-25

## 1. Architecture Direction

Keep the existing platform stack and reorganize into explicit domain contracts so each layer is independently testable and tenant-safe.

## 2. Backend Structure

### 2.1 Domainized Edge Function Families

Group edge functions by domain and enforce shared middleware contracts:

1. Identity and access
2. Patrol and operations
3. Compliance and enforcement
4. Evidence and ingestion
5. Reporting and exports
6. AI orchestration and diagnostics

Each family should use standardized wrappers from `supabase/functions/_shared` for:

1. Organization scoping enforcement
2. Role/capability checks
3. Auditable mutation metadata
4. Typed response envelopes and error contracts

### 2.2 Database and RLS Hardening Track

1. Keep migration order immutable and additive.
2. Treat `organization_id` and explicit scope checks as mandatory in privileged write paths.
3. Continue using security-definer helpers to avoid recursion patterns.
4. Add certification cadence for high-risk areas:
   - PTT channel ACL and clip storage path policies
   - organizations payment config routing safety
   - zone legal metadata and seasonal policy behavior

### 2.3 Integration Boundaries

1. Railway remains proxy-only boundary for external service mediation.
2. RunPod remains inference execution boundary.
3. Supabase edge remains policy and tenancy enforcement boundary.
4. PTT runtime stays isolated on VPS/hPanel with token minting through edge policy gates.

## 3. Frontend Structure

### 3.1 Route and Navigation Contract

1. Make `accessRegistry` the only route/nav entitlement source.
2. Separate route composition by operational surfaces:
   - officer operations
   - admin operations
   - master/governance operations
3. Archive or redirect legacy variants with explicit deprecation records.

### 3.2 State and Data Access Contract

1. Standardize hook patterns for all org-scoped modules:
   - required org context
   - cache key includes org ID
   - safe fallback for missing context
2. Move duplicated query predicates into shared helpers in `src/lib`.
3. Tag all privileged mutations with actor metadata for audit correlation.

## 4. UX/UI Enterprise Track

### 4.1 Information Architecture

1. Align navigation to domain responsibilities, not historical page growth.
2. Apply a consistent task hierarchy across patrol, compliance, evidence, reporting.
3. Keep diagnostics and incident controls discoverable for master roles.

### 4.2 Experience Quality Objectives

1. Reduce page-level cognitive load by consolidating duplicate controls.
2. Enforce role-aware empty/error states that never reveal foreign-tenant data.
3. Keep mobile parity for core patrol workflows and PTT status visibility.

## 5. Wiring Harness and Contracts

### 5.1 Contract Layers

1. UI contract: typed form and query interfaces.
2. Edge contract: schema-validated request/response envelopes.
3. DB contract: migration-backed schema plus RLS policies.
4. AI contract: strict output schema and grounding checks.
5. Ops contract: health, smoke, and rollback workflows.

### 5.2 Traceability

1. Add correlation IDs across UI -> edge -> DB -> inference boundaries.
2. Require operation IDs in long-running jobs and replay-safe queue handlers.

## 6. Pipelines and Release Governance

### 6.1 CI Gate Matrix

1. Static quality: lint + build + type checks.
2. Data safety: org-scope audit + isolation API suite.
3. Runtime safety: synthetic monitor + wiring audit + runpod smoke.
4. Architecture safety: Dr Bob review for major design artifacts.
5. Human validation: safe-mode human test engine run per phase close.

### 6.2 Deployment Topology Controls

1. Vercel deploy gates for SPA deep-link and security headers.
2. Supabase function deploy gates with health verification.
3. Railway proxy deploy health checks.
4. PTT deploy post-checks on VPS runtime.

## 7. Ticketized Delivery Plan

1. Ticket A1: edge-function family map and shared middleware baseline.
2. Ticket A2: org-scope helper consolidation across hooks/lib.
3. Ticket A3: route/nav entitlement convergence and deprecated route registry.
4. Ticket A4: tenant-safe UX states and role-surface audit.
5. Ticket A5: correlation ID propagation and operation tracing.
6. Ticket A6: CI gate matrix codification and enforcement dashboard.
7. Ticket A7: release runbook convergence across Vercel/Railway/Supabase/VPS.

## 8. Validation Gates

1. `bun run lint`
2. `bun run build`
3. `bun run test:api`
4. Org-scope and isolation suites green.
5. Dr Bob review decision: approve or approve-with-notes.
6. Human test engine safe-mode completion.
