# Org Scoping Audit (2026-04-25)

Generated: 2026-05-03T08:14:44.589Z

Total query sites: 251
Missing required org filter: 0
Review needed: 61
Known exceptions: 2

## Review Needed

- src/hooks/useFlaggedVehicles.ts:145 table=flagged_vehicles
- src/hooks/useFlaggedVehicles.ts:167 table=flagged_vehicles
- src/hooks/useHealthSafety.ts:154 table=health_safety_reports
- src/hooks/useHealthSafety.ts:173 table=health_safety_reports
- src/hooks/useHealthSafety.ts:216 table=health_safety_reports
- src/hooks/useManDownDetection.ts:89 table=officer_welfare_alerts
- src/hooks/useManDownDetection.ts:197 table=officer_welfare_alerts
- src/hooks/useOfficerNotifications.ts:164 table=flagged_vehicles
- src/hooks/useOfficerNotifications.ts:191 table=investigation_jobs
- src/hooks/useOfficerNotifications.ts:298 table=flagged_vehicles
- src/hooks/useOfficerNotifications.ts:306 table=investigation_jobs
- src/hooks/useOfficerWelfareMonitor.ts:102 table=officer_welfare_alerts
- src/hooks/useOfficerWelfareMonitor.ts:125 table=officer_welfare_alerts
- src/hooks/useOfficerWelfareMonitor.ts:170 table=officer_welfare_settings
- src/hooks/usePatrolCheckpoints.ts:113 table=checkpoint_visits
- src/hooks/usePatrolRouteInstances.ts:155 table=patrol_route_instance_stops
- src/hooks/usePatrolRouteInstances.ts:294 table=patrol_route_instance_stops
- src/hooks/usePatrolRouteInstances.ts:312 table=patrol_route_instance_stops
- src/hooks/usePatrolRouteInstances.ts:353 table=patrol_route_instance_stops
- src/hooks/usePatrolRouteInstances.ts:365 table=patrol_route_instances
- src/hooks/usePatrolRouteInstances.ts:373 table=patrol_route_instances
- src/hooks/usePersonRecords.ts:95 table=person_records
- src/hooks/usePersonRecords.ts:122 table=person_records
- src/hooks/usePersonRecords.ts:154 table=person_records
- src/hooks/usePersonRecords.ts:176 table=person_records
- src/hooks/usePersonRecords.ts:199 table=person_records
- src/hooks/usePersonRecords.ts:265 table=person_observations
- src/hooks/usePointsOfInterest.ts:145 table=persons_of_interest
- src/hooks/usePointsOfInterest.ts:162 table=persons_of_interest
- src/hooks/usePointsOfInterest.ts:228 table=vehicles_of_interest

## Known Exceptions

- src/hooks/useAuditLogs.ts:90 table=audit_log
- src/hooks/useAuditLogs.ts:225 table=audit_log

## Notes

- This is a static text audit; final authority remains Supabase RLS policies.
- Tables marked global/user-scoped are allowed to omit organization filters in client code.
