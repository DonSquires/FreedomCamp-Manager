# User System Redesign 2026 (Profiles, Login, Access)

Status: proposed architecture for replacing legacy user/auth model in production-scale FieldOps Manager.

## 1) Problem Statement

The current auth model was built for a small app and now shows scaling pressure:

- Role and area checks are spread across route wrappers and navigation config.
- User profile shape is overloaded for identity, tenant scope, and access decisions.
- Authorization rules are duplicated in UI and database policies, creating drift risk.
- Multi-organization behavior relies on mixed fields (`organization_id`, `extra_organization_ids`, `portal_access`) without one canonical contract.
- Session behavior is operationally stable but lacks explicit trust levels, step-up auth, and policy decision logging.

This redesign introduces a policy-driven identity and access system that is tenant-safe, audit-friendly, and migration-safe for current operations.

## 2) Current-State Observations (Grounded in Repo)

- Frontend auth state is centralized in `useAuthStore` with profile fetch from `user_profiles` and role fields (`admin`, `master`, `officer`, etc.).
- Route control uses `ProtectedRoute`, `RoleRoute`, and `AreaRoute` checks in app routing.
- Navigation visibility is role-filtered by static role arrays in layout definitions.
- Database has evolved with role and portal migrations (`grand_master`, `portal_access`, `extra_organization_ids`) and recurring RLS hardening fixes.
- Training docs enforce strict tenant-isolation proof and org-scoped service boundaries.

## 3) Design Goals

1. Single source of truth for authorization decisions.
2. Hard tenant isolation across UI, API, and database layers.
3. Role-based access plus fine-grained permissions without route-level sprawl.
4. Safe migration from legacy fields with no outage and minimal retraining.
5. First-class auditability of all privileged access and permission changes.
6. Compatibility with Bob workflows and service-role background tasks.

## 4) External Reference Baseline

This proposal aligns with:

- OWASP Authentication Cheat Sheet (credential hardening, lockout/rate-limits, session handling).
- NIST SP 800-63B (authenticator strength and lifecycle guidance).
- Supabase Auth docs (session lifecycle, JWT, MFA, RLS integration patterns).
- Auth0 architecture scenarios (enterprise SSO and centralized policy alternatives).

## 5) Target Architecture

### 5.1 Identity and Access Layers

- Layer A: Identity provider and session issuance
  - Keep Supabase Auth for baseline login/session issuance in Phase 1.
  - Add optional enterprise SSO path (SAML/OIDC) in Phase 3 for councils/partners.
- Layer B: Profile and membership model
  - Decouple identity from tenant membership and permissions.
- Layer C: Policy decision
  - Centralize authorization in policy functions (database + backend policy endpoint).
- Layer D: Enforcement
  - UI gate for experience only; database RLS and backend checks remain authoritative.

### 5.2 Data Model (Canonical)

Introduce normalized IAM entities (new tables; legacy fields retained during migration):

- `iam_users`
  - `id` (uuid, matches auth user id)
  - `email`, `status`, `risk_level`, `last_login_at`, `mfa_enrolled`
- `iam_organizations`
  - mirrors operational org catalog where needed for auth concerns
- `iam_memberships`
  - `user_id`, `org_id`, `membership_status`, `is_default_org`, `effective_from`, `effective_to`
- `iam_roles`
  - canonical role catalog (`officer`, `admin_officer`, `admin`, `master`, `grand_master`, etc.)
- `iam_user_roles`
  - `user_id`, `org_id`, `role_id` (org-scoped role assignments)
- `iam_permissions`
  - atomic permissions (`incident.read`, `zone.write`, `user.invite`, `dispatch.assign`, etc.)
- `iam_role_permissions`
  - role to permission mapping, versioned
- `iam_user_permission_overrides`
  - explicit allow/deny exceptions for edge cases
- `iam_portal_entitlements`
  - portal and area entitlements replacing ad-hoc `portal_access`
- `iam_policy_audit`
  - immutable policy decision and admin-change event ledger

### 5.3 Authorization Contract

Every protected action evaluates a single function signature:

`authorize(user_id, org_id, resource, action, context_json) -> { allowed, reason, policy_version }`

Rules:

- `grand_master` is global but still audited and optionally constrained by break-glass policy.
- `master` is multi-org privileged but only with explicit org context.
- `admin` and `admin_officer` are org-scoped by default.
- `officer` gets least privilege with contextual elevation only via approved workflows.
- `client_viewer` is read-only and constrained to designated client scope.

### 5.4 Session and Trust Model

- Standard session at login.
- Step-up authentication required for high-risk actions:
  - user management changes
  - export of sensitive datasets
  - privacy-curtain bypass or audit-log redaction tasks
- Device/session risk signals (new device, unusual geolocation, abnormal failed attempts) increase friction.

### 5.5 UI Contract

- UI reads `effective_permissions` for rendering controls, but never assumes authorization.
- Active organization selector is mandatory for privileged users.
- Permission labels become capability-based instead of role-name assumptions.
- Portal selection becomes entitlement-driven (from `iam_portal_entitlements`), not role hardcoding.

### 5.6 Bob Integration

- Bob background tasks run under service-role paths only when required.
- All Bob actions carry org context (`x-org-id`) and actor metadata.
- Bob never bypasses policy engine; it requests policy checks before privileged mutations.
- Add AI-safe guardrail: prompt/action classifier marks requests as low/medium/high risk and enforces step-up policy where needed.

## 6) Options Analysis

### Option A: Supabase-native IAM (recommended first)

- Keep Supabase Auth as IdP.
- Build IAM tables + policy functions in Postgres and enforce via RLS + RPC.
- Pros: lowest migration risk, native stack fit, best delivery speed.
- Cons: enterprise SSO depth is limited vs dedicated IdP until extended.

### Option B: External IdP-first (Auth0/WorkOS/Entra style)

- Move identity lifecycle and policy metadata to external IdP.
- Keep app data and RLS in Supabase.
- Pros: strong enterprise SSO/admin lifecycle tooling.
- Cons: integration complexity, duplicate policy surface risk, longer rollout.

### Option C: Hybrid (Supabase now, external IdP later)

- Phase in normalized IAM contract now.
- Keep identity adapter abstraction so IdP swap/augmentation is possible.
- Pros: fastest practical path with future enterprise readiness.
- Cons: requires discipline around adapter boundaries.

Decision: Option C with Option A implementation in Phases 1-2, then optional Option B features in Phase 3.

## 7) Self-Critique (Minimum 3 Flaws)

1. Complexity risk: introducing full IAM schema can overfit if permission granularity explodes too early.
2. Migration risk: dual-running legacy and new access paths can create temporary policy inconsistency.
3. Operational load: policy audit logs and step-up checks can add latency for high-throughput workflows.
4. Change fatigue: admins/officers may perceive new access prompts as friction if rollout/training is weak.

Mitigations:

- Start with top 30-40 critical permissions only, then expand.
- Feature-flag policy enforcement by module.
- Cache policy decisions with short TTL and invalidate on role change.
- Provide role playbooks and fast rollback toggles per module.

## 8) Tenant Isolation Proof

Data boundaries:

- All reads/writes require explicit `org_id` in service-layer calls.
- Query keys include `org_id` and permission version.
- Policy engine resolves permissions using (`user_id`, `org_id`) membership records.

UI boundaries:

- Persistent active-org indicator in all admin/operator contexts.
- Org switch triggers scoped cache reset and refetch.

Permission boundaries:

- Capability checks (`resource.action`) replace role-only checks.
- Role checks become one input into policy function, not sole decision factor.

Error boundaries:

- Forbidden errors return generic denial reason; no foreign-org metadata leakage.

State boundaries:

- On org switch: clear role/permission caches and invalidate stale page data.
- Session state stores current org separately from user identity object.

Negative tests required:

- Org A user cannot read Org B users/memberships.
- Org A invite cannot assign role in Org B.
- Org switch never displays stale prior-org records.
- Unauthorized roles cannot trigger privileged actions.

## 9) Implementation Plan (Phased)

### Phase 0: Discovery and Mapping (2-3 days)

- Inventory every route/module gate to a canonical permission matrix.
- Map legacy role checks to capability keys.
- Define migration toggles and rollback switches.

### Phase 1: IAM Schema + Policy Engine (4-6 days)

- Add IAM tables and seed baseline roles/permissions.
- Implement `authorize(...)` RPC and policy audit ledger.
- Add RLS policies that call stable helper functions (avoid recursion patterns).

### Phase 2: Frontend Contract Refactor (4-6 days)

- Add `useAuthorization` and `useActiveOrganization` hooks.
- Replace static role arrays for high-risk pages with capability checks.
- Refactor portal selection to entitlement-based logic.

### Phase 3: Security Hardening (3-5 days)

- Add MFA enrollment + step-up workflows for sensitive actions.
- Add rate-limit and lockout policy harmonized with OWASP guidance.
- Add suspicious session/risk signals into auth events.

### Phase 4: Bob and Service Integrations (2-4 days)

- Enforce `x-org-id` and actor metadata in Bob-triggered actions.
- Add policy pre-check endpoint in Bob service interaction flows.
- Log Bob privileged actions in policy audit.

### Phase 5: Verification and Cutover (3-4 days)

- Run tenant isolation E2E matrix tests.
- Run parallel policy mode (shadow eval) to compare legacy vs new decisions.
- Cut over module-by-module behind feature flags.

## 10) Ticketized Backlog

1. IAM schema migrations and seed data.
2. Policy RPC and helper functions with test fixtures.
3. Permission dictionary (`resource.action`) and versioning.
4. Frontend auth context split (`identity`, `activeOrg`, `permissions`).
5. Route guard adapter using capabilities.
6. Navigation entitlement service.
7. Admin user-management v2 screens (membership, role assignment, invite lifecycle).
8. Step-up auth modal flow for high-risk operations.
9. Bob policy pre-check integration.
10. E2E tenant isolation and regression suite.
11. Shadow-mode telemetry dashboard for policy diffing.
12. Controlled rollout and rollback scripts.

## 11) Validation Checklist

- Build passes.
- No new lint/type errors.
- Tenant isolation tests green.
- Shadow-mode mismatch rate below agreed threshold (for example, <1% after triage).
- All privileged mutations emit policy audit events.

## 12) Completion Criteria

- Legacy role-only route gating is removed from critical modules.
- All privileged actions use policy function decisions.
- Org-scoped membership is canonical for access control.
- Bob privileged flows are policy-gated and auditable.
