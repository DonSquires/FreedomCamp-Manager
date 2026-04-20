# Backend Infrastructure Redesign

## Scope delivered

- Provider-client access grants with client checkbox control (`allow_without_roster`)
- Unified access helper and v2 org-access function
- Service-specific access checkers for RLS and PTT
- Standardized org-scoped SELECT policies for core operational tables
- PTT edge-function authorization switched to RPC authorization checks
- Edge function consolidation roadmap documented (no deletions yet)
- Bob configuration updated for egress-enabled mode

## New migrations

1. `20260420000001_provider_client_access_control.sql`
   - Adds `provider_client_access_grants`
   - Adds `provider_service_type` enum
   - Enables RLS and client-admin grant management policies
2. `20260420000002_rls_standardization.sql`
   - Adds `get_user_effective_access_scope()`
   - Adds `get_user_organization_ids_v2()`
   - Adds `can_access_service(org_id, service_type)`
   - Adds standardized SELECT policies for:
     - `observations`, `breach_alerts`, `patrols`, `incidents`
     - `client_sites`, `enforcement_actions`, `zones`
3. `20260420000003_ptt_authorization_fix.sql`
   - Adds `can_access_ptt_channel(org_id)`
4. `20260420000004_backfill_provider_grants.sql`
   - Backfills First Security → LINZ/Nelson grants with `allow_without_roster=true`

## Access model

`get_user_effective_access_scope()` emits organization rows with a reason:

- `hierarchy`
- `user_override_extra`
- `user_override_location`
- `provider_grant:<service_type>`
- `master_role`

RLS table pattern now supports direct and service-grant access:

- `organization_id = ANY(get_user_organization_ids_v2())`
- `OR can_access_service(organization_id, '<service_type>')`

## PTT authorization

`supabase/functions/ptt-signaling-token/index.ts` now uses:

- `rpc('can_access_ptt_channel', { p_channel_org_id })`
- Returns `403` with message:
  - `Not authorized for this channel. Check provider access grants.`

## Edge function consolidation roadmap

See `.archive/edge-functions/README.md` for:

- Functions queued for deletion
- Consolidation targets (`process-officer-scan`, `cleanup-and-recalculate`)
- Required caller updates before removals
- 17-function target-state list

## Migration execution plan

1. Run migration 1 (new table + enum)
2. Run migration 2 (helpers + standardized policies)
3. Run migration 3 (PTT checker)
4. Run migration 4 (backfill)
5. Validate with representative users:
   - Provider officer with active grant
   - Client admin toggle OFF → provider blocked
   - Toggle ON → provider restored

## Verification checklist

- [ ] Migrations applied successfully
- [ ] First Security → LINZ/Nelson grants present and active
- [ ] Client admin can toggle `allow_without_roster`
- [ ] PTT uses `can_access_ptt_channel`
- [ ] RLS for targeted tables follows v2 helper + service checker pattern
