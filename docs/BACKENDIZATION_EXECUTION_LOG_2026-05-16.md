# Backendization Execution Log — 2026-05-16

## Scope Completed

This execution batch backendized direct frontend mutations for the following modules:

- CRM / access control and branching assignment
- Site governance (client sites + role/user site permissions)
- Dispatch lifecycle (create, assign, cancel)
- Tender artifacts and tender workspace collaboration actions
- Parking enforcement admin actions

## New Edge Functions

- `supabase/functions/manage-site-governance/index.ts`
- `supabase/functions/manage-dispatch-operations/index.ts`
- `supabase/functions/manage-tender-artifacts/index.ts`
- `supabase/functions/manage-parking-governance/index.ts`

## Frontend Mutation Paths Rewired to Wrappers

- `src/pages/AccessControlPage.tsx`
- `src/pages/ClientSites.tsx`
- `src/pages/SitePermissionsAdmin.tsx`
- `src/pages/DispatchConsole.tsx`
- `src/hooks/useDispatchConsoleData.ts`
- `src/pages/ClientMasterList.tsx`
- `src/pages/FieldOfficerPortal.tsx`
- `src/pages/TenderReferenceLibrary.tsx`
- `src/pages/TenderWorkspaceDetail.tsx`
- `src/pages/ParkingEnforcementPortal.tsx`
- `src/lib/edgeFunctions.ts`

## Security and Governance Pattern Applied

For each new backend action:

- JWT auth required
- caller role validated against allowed roles
- organization scope validated
- payload sanitized/validated server-side
- mutation performed via service-role client
- audit artifact written to `audit_log` with old/new values where applicable

## Deployments Completed

Deployed to project ref `kxwjcupuxnnbnzcgmkoi`:

- `manage-site-governance`
- `manage-dispatch-operations`
- `manage-tender-artifacts`
- `manage-parking-governance`

## Validation Results

### Local checks

- `npm run build`: PASS
- `npm run lint`: PASS with 2 pre-existing warnings unrelated to this batch

### Authenticated smoke checks

- Site governance role upsert/delete: PASS
- Dispatch create/assign/status transitions/cancel: PASS
- Client site create/delete via governance function: PASS
- Tender reference create/update/version actions: PASS
- Parking zone create + permit create + permit revoke: PASS

Note: Parking infringement status smoke is conditional on existing infringement records in the target org; the checked org had no matching test record at run time.

## Operational Notes

- One deploy attempt initially targeted the wrong project ref and returned 404; rerun with env-backed project ref succeeded.
- A temporary smoke payload for `client_sites` failed a DB check constraint requiring active-location validity; rerun with compliant payload passed.
- `manage-tender-artifacts` initially excluded `admin_officer`; role gate was corrected and redeployed.

## Final Outcome

Primary backendization flow from CRM through branching and artifacts, plus parking enforcement governance, is now API-mediated, audited, and live-deployed.

## LMR Remediation Addendum

Follow-up remediation completed for LMR bridge governance to move smoke status from failed to green.

- Root cause: remote project schema was missing `public.lmr_bridge_config` while `manage-lmr-governance` was already deployed.
- Applied migration history repair per CLI guidance for remote-only entries:
	- `supabase migration repair --status reverted 20260516000004 20260516000005 --linked`
- Applied schema repair migration:
	- `supabase/migrations/20260713000004_repair_lmr_bridge_schema.sql`
	- `supabase db push --linked` succeeded.

### LMR Smoke Re-Run (Post-Repair)

- `upsert_config(create)`: HTTP 200
- `set_config_active(false)`: HTTP 200
- `delete_config`: HTTP 200
- Result: `LMR_SMOKE=PASS`

### LMR Audit Verification

Recent `audit_log` rows confirmed for `entity_type = lmr_bridge_config`:

- `lmr_bridge_config_created`
- `lmr_bridge_config_status_updated`
- `lmr_bridge_config_deleted`

## Platform Feedback Create-Path Backendization Addendum

Extended platform governance so `bug_reports` creation is now API-mediated and validated server-side, removing direct client writes from key submission flows.

### Backend changes

- Updated `supabase/functions/manage-platform-feedback/index.ts`:
	- added `create_bug_report` action
	- caller identity is derived from authenticated user/session (`user_profiles`) and enforced server-side
	- client-supplied `user_id`, `organization_id`, and `user_role` are ignored
	- writes `bug_report_created` audit artifact
	- retained admin-only controls for `update_bug_report` and `cleanup_old_closed_reports`

### Frontend/API wiring changes

- Added `createBugReport` wrapper in `src/lib/edgeFunctions.ts`
- Rewired direct bug report inserts to the wrapper in:
	- `src/components/features/FeedbackModal.tsx`
	- `src/components/features/AiFeedbackChat.tsx`
	- `src/hooks/useAutoErrorReporter.ts`

### Validation

- Live smoke (`manage-platform-feedback`):
	- `create_bug_report` -> HTTP 200
	- server persisted caller-owned values (`user_id`, `organization_id`, `user_role`) from auth context, not payload spoof values
	- `update_bug_report` -> HTTP 200
	- `audit_log` confirmed actions: `bug_report_created`, `bug_report_updated`
	- result markers: `OWNERSHIP_GUARD=PASS`, `PLATFORM_CREATE_FLOW=PASS`

- Regression check:
	- `bun run test:bob:governance` -> PASS (6/6)
