# Client Access Rebuild Plan (2026-04-26)

Note: This plan is proposed implementation work only. It does not claim these changes already exist in the current repo/system state.

## Phase 0: Safety and Discovery
1. Inventory all role checks across frontend and edge functions.
2. Inventory current user profiles using `client_viewer`, `officer`, `admin` that are acting as client personas.
3. Add feature flag `client_access_v2_enabled` default off.

## Phase 1: Role and Guard Foundations
1. Extend shared role unions/types to include:
   - `client_officer`
   - `client_admin`
2. Update permission matrix with least-privilege client capabilities.
3. Update route guards so all client personas are restricted to client boundary routes.
4. Update portal-selection logic for new client personas.

## Phase 2: Admin UX and Assignment
1. Update `UserManagement` role selectors to include the new client roles.
2. Update `AccessControlPage` role badges/filter options for new client roles.
3. Enforce tenant-scoped assignment UI (no cross-org client role assignment).

## Phase 3: Backend and Policy Hardening
1. Add DB migration allowing new role enum values.
2. Update RLS/policy predicates and edge-function role checks for new client roles.
3. Add explicit deny policies for service-provider modules for client personas.

## Phase 4: Testing and Verification
1. Add/expand unit tests for permission and route guard logic.
2. Expand Playwright role matrix to include:
   - `client_viewer`
   - `client_officer`
   - `client_admin`
3. Add API org-isolation tests for each client persona.
4. Run Dr Bob review on spec + plan before rollout approval.

## Phase 5: Controlled Rollout
1. Enable feature flag for staging users first.
2. Verify production telemetry (auth failures, forbidden routes, policy rejects).
3. Roll out to all client users.

## Ticketized Execution Order
1. Types and permission matrix update.
2. Route guard + portal selection changes.
3. UserManagement and AccessControl UI role updates.
4. DB migration and policy updates.
5. Test harness expansion.
6. Feature-flag rollout and post-deploy review.

## Exit Criteria
- All client personas have explicit least-privilege behavior.
- No cross-tenant leakage in automated tests.
- No reliance on service-provider roles to represent client staff/admin behavior.

## Out Of Scope In This Plan
- Introducing new membership tables or other new schema modules.
- Replacing legacy org-scope arrays during this rollout.
