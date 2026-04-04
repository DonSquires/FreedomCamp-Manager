# Rebuild Gap Closure Checklist (Schema Extract #6)

Last updated: 2026-04-04

## Scope

This checklist tracks closure work after validating the rebuild against:
- Railway live services (all active projects)
- Database Schema Extract #6 artifact (`20260404_005054`)
- Current codebase build (`bun run build`)

## Verified Now

- [x] Railway CLI repaired and authenticated
- [x] Active Railway projects enumerated
- [x] FieldOps API URL variables set on production services
- [x] FieldOps services restarted successfully
- [x] Health checks return 200 on active API services
- [x] App builds successfully (`bun run build`)

## API Wiring Closure

- [x] `INFERENCE_SERVICE_URL` set on FieldOps services
- [x] `PROXY_SERVER_URL` set on FieldOps services
- [x] `PTT_SERVER_URL` set on FieldOps services
- [x] `VITE_INFERENCE_SERVICE_URL` set on frontend service
- [x] `VITE_PROXY_SERVER_URL` set on frontend service
- [x] `VITE_PTT_SERVER_URL` set on frontend service

## Page Parity Closure (Name-level)

Original parity check expected these page names:
`Observations`, `Breaches`, `Enforcement`, `Vehicles`, `Zones`, `LiveMap`, `Patrols`, `DataImport`

Action:
- [x] Add page aliases in `src/pages/` to satisfy expected names.
- [ ] Confirm route-level parity for each alias in `src/App.tsx`.

## Database Parity Closure (Schema Extract #6)

Extract snapshot reported:
- `LIVE_TABLE_COUNT=31`
- `TARGET_TABLE_COUNT=36`
- `TARGET_MISSING=27`

Missing from target list comparison:
- `user_profiles`
- `zone_signage_evidence`
- `observations`
- `breach_alerts`
- `canonical_vehicles`
- `infringement_notices`
- `notices_to_vacate`
- `enforcement_cases`
- `enforcement_case_events`
- `patrols`
- `patrol_schedule_zones`
- `patrol_checkpoints`
- `checkpoint_visits`
- `officer_shifts`
- `officer_welfare_settings`
- `officer_welfare_alerts`
- `officer_activity_log`
- `incidents`
- `incident_attachments`
- `health_safety_reports`
- `person_observations`
- `person_vehicle_links`
- `person_interactions`
- `audit_log`
- `dispute_intake`
- `privacy_access_log`
- `retention_policies`

Action:
- [ ] Reconcile target table list vs renamed/replaced live tables.
- [ ] Mark each item as: `exists`, `renamed`, `replaced`, or `missing`.
- [ ] For true missing tables, create migrations and regenerate types.

## End-to-End Completion Criteria

Rebuild is complete only when all are true:
- [x] API variables fully set (including `VITE_PTT_SERVER_URL`)

Note:
- Frontend service reported `Deployment is not restartable` on manual restart. Variable write succeeded and is visible via `railway variable list`.
- [ ] Page parity check passes without alias-only exceptions
- [ ] Schema parity reconciliation completed and approved
- [ ] `bun run build` passes
- [ ] Critical service smoke checks pass post-redeploy
