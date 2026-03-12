# Edge Function Migration Status (Current)

## Status
- Date: 2026-03-07
- Architecture: `observations` is the operational source of truth.
- Legacy note: `observations` is historical/legacy and is not the primary operational table.

## Current Function Inventory
- Source of truth: `supabase/functions/`
- Current count: 53 function directories (excluding `_shared`).
- Deploy command:

```bash
supabase functions deploy
```

## Compliance Function Status
- `recalculate-compliance`: Active and in use by current UI/admin flows.
- `recalculate-compliance-v2`: Active for strict zone-based recalculation paths.
- Recommendation: Keep both unless product owners explicitly deprecate one path and UI references are removed.

## Security/Auth Baseline
Recent hardening completed for:
- `admin-incident-ops`
- `check-almost-breaches`
- `update-user-password`

Baseline requirements for admin-grade functions:
- Validate bearer token with Supabase Auth (`auth.getUser`).
- Authorize role from `user_profiles` (do not trust decoded JWT payload without verification).
- Scope non-master users to their organization where applicable.

## Wiring Status
- Frontend function invokes now map to existing function directories.
- Added missing functions used by UI actions:
  - `sync-spatial-layers`
  - `nightly-privacy-cleanup`

## Verification Checklist
- [ ] `bun run build` passes
- [ ] `bun run lint` has no new errors
- [ ] `supabase functions deploy` succeeds in target project
- [ ] Smoke test key endpoints:
  - `recalculate-compliance`
  - `observations-export`
  - `import-data`
  - `generate-dashboard-report`
  - `sync-spatial-layers`
  - `nightly-privacy-cleanup`
