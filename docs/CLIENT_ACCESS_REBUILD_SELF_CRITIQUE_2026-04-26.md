# Self-Critique: Client Access Rebuild Spec (2026-04-26)

## Flaw 1: Role-only expansion may still hide per-feature nuance
Adding `client_officer` and `client_admin` improves clarity, but static role checks may still be too coarse for long-term needs. A capability/permission table may be needed sooner if client contracts differ materially.

## Flaw 2: Legacy array fields can still produce policy complexity
Keeping `authorized_work_locations` and `extra_organization_ids` in Phase 1 reduces migration risk but continues complexity and the chance of inconsistent org-set resolution between frontend and backend.

## Flaw 3: Route-boundary checks alone are insufficient
Even with strict route guards, leakage risk remains if API/RLS checks are incomplete. Backend policy hardening and negative integration tests are mandatory before calling this complete.

## Flaw 4: Client-admin semantics may overlap with service-provider admin screens
Without clear module boundaries and naming, operators may expect `client_admin` to access existing admin modules. UX copy and navigation labeling must explicitly distinguish tenant admin from platform admin.
