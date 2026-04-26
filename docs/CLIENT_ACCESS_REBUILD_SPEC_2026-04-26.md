# Client Access Rebuild Spec (2026-04-26)

## Objective
Design a first-class client access system that supports distinct client personas while preserving legacy organization scoping behavior and avoiding cross-tenant leakage.

## Problem Statement
Current production behavior overloads a single `client_viewer` role plus legacy fields:
- `organization_id`
- `employer_organization_id`
- `authorized_work_locations`
- `extra_organization_ids`
- optional `portal_access`

This makes it hard to cleanly represent:
- Client read-only users
- Client operational users (client officer/staff)
- Client organization admins

It also forces test harness role-switching to reuse service-provider roles (`admin`, `officer`) to emulate client actions, creating ambiguity.

## Grounded Current State (Repo)
- Frontend auth role union includes `client_viewer` only as explicit client role.
- Route guard in `App.tsx` hard-restricts `client_viewer` to `/client-portal`, `/profile`, `/settings`.
- Permission matrix gives `client_viewer` only view-centric permissions.
- Organization scoping functions rely on primary org + authorized/extra org arrays.

## Target Access Model (Proposed)
Note: Everything below is a proposed future-state design for implementation work. It is not claimed as current production state.

Use two orthogonal dimensions:

1. Tenant membership scope (where):
- Primary org (`organization_id`)
- Delegated org scopes (`authorized_work_locations`, `extra_organization_ids`) for transitional compatibility

2. Capability profile (what):
- `client_viewer`: read-only client portal access
- `client_officer`: can manage client-site operations in client portal only
- `client_admin`: can manage client users/settings in client portal only

Service-provider roles remain unchanged (`officer`, `admin`, `admin_officer`, etc.) and are not reused to model client personas.

## Authorization Rules
- Client personas are never granted service-provider admin modules by default.
- Client personas can only access routes tagged `client_portal` and profile/settings routes.
- Data reads/writes must be constrained to authorized org set.
- Client-admin user-management actions are tenant-scoped to their own org only.

## Data Model Strategy (Proposed)
Phase 1 (compatible, in-scope):
- Keep existing role column and legacy org fields.
- Add support for two new role values: `client_officer`, `client_admin`.
- Preserve `portal_access` enforcement where already implemented.

Phase 2 (optional, out-of-scope for this rollout):
- Revisit whether additional schema normalization is required after Phase 1 evidence.
- Do not introduce new tables in this proposal.

## Frontend Changes (Phase 1)
- Expand role unions and permission matrices to include new client roles.
- Update route guards to recognize all client personas and keep them in client portal boundary.
- Update access management/user management forms to assign new client roles.
- Update tests to assert:
  - `client_viewer` = view
  - `client_officer` = manage operational client workflows
  - `client_admin` = manage client users/settings

## Backend / RLS Direction
- Ensure role claims for `client_officer` and `client_admin` map to explicit policy predicates.
- Keep org filters mandatory on every query path.
- For user-management endpoints, reject actions that target other orgs.

## Migration Safety
- Backfill existing client-like users to `client_viewer` if ambiguous.
- No destructive migration of legacy fields in Phase 1.
- Add reversible migration scripts and audit logs.

## Testing Requirements
- Role-matrix tests for all three client personas.
- Cross-tenant negative tests for each persona.
- Route-guard tests proving client roles cannot open admin/service-provider modules.
- Playwright + API smoke for org leakage.

## Non-Goals (Phase 1)
- Full removal of legacy org arrays.
- Rework of all service-provider permission semantics.

## Success Criteria
- Client access is explicit, least-privilege, and auditable.
- No need to emulate client roles via `admin`/`officer`.
- Existing production users continue functioning during migration.
