# Cross-Org Verification Matrix

**Sprint 0 Artifact** | Generated: 2026-05-03 | Grounded from: `tools/route-role-matrix/route-role-matrix.json`, `tests/e2e/module-route-access.spec.ts`

## Purpose

Verify that no route exposes data across organisation boundaries. Each row documents which roles can access a route, the org-scoping risk level, and the verification status.

---

## Role Definitions

| Role | Org Scope | Description |
|---|---|---|
| `grand_master` | All orgs (platform-wide) | Full platform access, no org boundary |
| `master` | Assigned orgs | Multi-org operator admin |
| `admin` | Single org | Organisation administrator |
| `admin_officer` | Single org | Admin + field officer dual role |
| `officer` | Single org | Field patrol officer |
| `client_admin` | Client org only | Client organisation admin |
| `client_officer` | Client org only | Client field officer |
| `client_viewer` | Client org only | Read-only client access |
| `nzscv_monitor` | Vehicle registry only | NZ scanned vehicle view |

---

## Org Boundary Tiers

| Tier | Description | Risk |
|---|---|---|
| **T0 — Platform** | `grand_master` only; crosses all org boundaries | Critical — must be isolated |
| **T1 — Multi-org** | `master` + `grand_master`; sees data across assigned orgs | High — row-level security required |
| **T2 — Org-scoped** | `admin` / `admin_officer`; single org only | Medium — default RLS scope |
| **T3 — Field** | `officer`; single org, own records only | Low — scoped by officer ID |
| **T4 — Client** | `client_*`; client portal data only | Medium — isolated client boundary |
| **T5 — Public** | No auth required | None |

---

## Route Access Matrix

### T0 — Platform-wide (grand_master exclusive)

| Route | Roles | E2E Test | Status |
|---|---|---|---|
| `/platform` | `grand_master` | `master – full platform access` > `master loads /platform` | ✅ Covered |
| `/grandmaster-code-studio` | `grand_master` | `cross-org matrix regression checks` > blocked for admin/master | ✅ Covered (blocked-access) |
| `/compliance-escalations` | `grand_master` | `cross-org matrix regression checks` > blocked for admin/master | ✅ Covered (blocked-access) |

### T1 — Multi-org (master + grand_master)

| Route | Roles | E2E Test | Status |
|---|---|---|---|
| `/organizations` | `master`, `grand_master` | `master loads /organizations` | ✅ Covered |
| `/intel-approvals` | `master`, `grand_master` | `master loads /intel-approvals` | ✅ Covered |
| `/diagnostics` | `master`, `grand_master` | `master loads /diagnostics` (P4-9) | ✅ Covered |
| `/site-permissions` | `admin`, `master`, `grand_master` | `master loads /site-permissions` (P4-9) | ✅ Covered |
| `/tender-workspace` | `admin`, `master`, `grand_master` | `master loads /tender-workspace` (P4-9) | ✅ Covered |
| `/tender-workspace/:id` | `admin`, `master`, `grand_master` | — | ⚠️ No coverage |
| `/tender-reference-library` | `admin`, `master`, `grand_master` | `master loads /tender-reference-library` (P4-9) | ✅ Covered |

### T2 — Org-scoped (admin / admin_officer / master)

Selected high-risk routes:

| Route | Roles | E2E Test | Status |
|---|---|---|---|
| `/users` | `admin`, `admin_officer`, `master` | `master loads /users` | ✅ Covered |
| `/access-control` | `admin`, `admin_officer`, `master`, `grand_master` | `master loads /access-control` | ✅ Covered |
| `/audit-log` | `admin`, `admin_officer`, `master` | `admin loads /audit-log` | ✅ Covered |
| `/organization-profile` | `admin`, `admin_officer`, `master` | `admin loads /organization-profile` | ✅ Covered |
| `/admin/service-provider-access` | `admin`, `master` | `master loads /admin/service-provider-access` | ✅ Covered |
| `/admin/cleanup-recalculate` | `admin`, `master` | — | ⚠️ No coverage |
| `/admin/canonical-records` | `admin`, `admin_officer`, `master` | `admin loads /admin/canonical-records` | ✅ Covered |
| `/import-historical` | `admin`, `master` | — | ⚠️ No coverage |
| `/privacy-curtain` | `admin`, `admin_officer`, `master` | `admin loads /privacy-curtain` | ✅ Covered |
| `/person-records` | `admin`, `admin_officer`, `master` | `admin loads /person-records` | ✅ Covered |
| `/identity-verification` | `admin`, `admin_officer`, `master` | `admin loads /identity-verification` | ✅ Covered |
| `/crm` | `admin`, `admin_officer`, `master`, `grand_master` | `admin loads /crm` | ✅ Covered |
| `/crm/contractor/:orgId` | `admin`, `admin_officer`, `master`, `grand_master` | `org isolation – CRM parameterised routes` | ✅ Covered (spoof test) |
| `/crm/client/:orgId` | `admin`, `admin_officer`, `master`, `grand_master` | `org isolation – CRM parameterised routes` | ✅ Covered (spoof test) |

### T3 — Field (officer + admin)

| Route | Roles | E2E Test | Status |
|---|---|---|---|
| `/officer-home` | `admin_officer`, `officer` | `officer loads /officer-home` | ✅ Covered |
| `/field-officer` | `admin_officer`, `officer` | `officer loads /field-officer` | ✅ Covered |
| `/breach-notices` | `admin`, `admin_officer`, `master`, `officer` | `officer loads /breach-notices` (P4-9) | ✅ Covered |
| `/enforcement-actions` | `admin`, `admin_officer`, `master`, `officer` | `officer loads /enforcement-actions` (P4-9) + org-spoof smoke | ✅ Covered |
| `/face-recognition` | `admin`, `admin_officer`, `master`, `officer` | `officer loads /face-recognition` (P4-9) | ✅ Covered |
| `/job-map` | `admin`, `admin_officer`, `master`, `officer` | `officer loads /job-map` (P4-9) | ✅ Covered |

### T4 — Client portal

| Route | Roles | E2E Test | Status |
|---|---|---|---|
| `/client-portal` | `client_viewer`, `client_officer`, `client_admin`, `admin`, `admin_officer`, `master`, `grand_master` | `client_viewer – restricted` | ✅ Covered |

### T5 — Public / unauthenticated

| Route | Roles | E2E Test | Status |
|---|---|---|---|
| `/login` | none (public) | auto | ✅ Covered |
| `/dispute` | none (public) | `/dispute loads without auth` (P4-9 T5 spec) | ✅ Covered |

---

## Cross-Org Bleed Risk Register

> Routes where a higher-privileged role (`master` / `grand_master`) can access data **across org boundaries** — these require confirmed RLS policies in Supabase.

| Route | Bleed Scenario | RLS Policy Required | Verified |
|---|---|---|---|
| `/crm/contractor/:orgId` | master reading contractor data of an org not assigned to them | `orgId` must match `user_organizations` membership | ✅ Verified (RLS + spoof E2E) |
| `/crm/client/:orgId` | master reading client data of unassigned org | `orgId` must match `user_organizations` membership | ✅ Verified (RLS + spoof E2E) |
| `/organizations` | master listing all organisations | Grand_master only, master sees assigned orgs | 🟨 Partially verified (RLS enabled + policy added; dedicated fixture proof pending) |
| `/users` | master listing users of all orgs | Filter by `organization_id` | ✅ Verified (P4-9 `org-isolation-api.spec.ts` — `/users bleed` test) |
| `/audit-log` | master viewing audit entries cross-org | Filter by `organization_id` | ✅ Verified (P4-9 `org-isolation-api.spec.ts` — existing audit_log test) |
| `/crm` | master seeing all CRM contacts | Filter by `organization_id` | ✅ Verified (P4-9 `org-isolation-api.spec.ts` — CRM organizations bleed test) |

---

## Sprint 0 Actions

| # | Action | Owner | Priority |
|---|---|---|---|
| 1 | Add RLS verification tests for `/crm/contractor/:orgId` and `/crm/client/:orgId` — assert `orgId` param cannot be spoofed | Dev | High |
| 2 | Confirm `SELECT` RLS policy on `organizations` table scopes master to `user_organizations` | Dev | High |
| 3 | Add E2E blocked-access tests for T0 routes (`/grandmaster-code-studio`, `/compliance-escalations`) | Dev | Medium |
| 4 | Add coverage for `/audit-log`, `/organization-profile`, `/privacy-curtain`, `/person-records` | Dev | Medium |
| 5 | Add parameterised org-spoof test: admin of org-A tries to access `/crm/client/org-B` → assert redirect | Dev | High |

---

## Evidence Basis

- Route count: 121 (from `tools/route-role-matrix/route-role-matrix.json`, commit `8cc8c4f3`)
- E2E spec roles covered: `master`, `admin` (adminOrg1), `admin_officer` (clientStaff), `officer` (officerOrg1), `client_viewer`
- Source: `tests/e2e/module-route-access.spec.ts` (expanded in Sprint 1: T0 blocked-access + CRM org spoof coverage)
- RLS policy source: `supabase/migrations/20260503000001_organizations_enable_rls.sql` (enabled + scoped policies)
