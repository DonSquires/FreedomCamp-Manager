# Org Scoping Audit (2026-04-25)

Generated: 2026-05-03T07:41:16.475Z

Total query sites: 250
Missing required org filter: 39
Review needed: 61
Known exceptions: 2

## Missing Required Org Filters

- src/hooks/useAuditLogs.ts:163 table=audit_log
- src/hooks/useChatMessages.ts:71 table=chat_messages
- src/hooks/useEnforcementActions.ts:153 table=enforcement_actions
- src/hooks/useEnforcementActions.ts:182 table=enforcement_actions
- src/hooks/useEnforcementActions.ts:209 table=enforcement_actions
- src/hooks/useImportHistory.ts:222 table=import_batches
- src/hooks/useIncidents.ts:70 table=incidents
- src/hooks/useOfficerNotifications.ts:124 table=breach_alerts
- src/hooks/useOfficerNotifications.ts:225 table=breach_alerts
- src/hooks/useOfficerNotifications.ts:230 table=breach_alerts
- src/hooks/useOfficerNotifications.ts:250 table=breach_alerts
- src/hooks/usePatrolCheckpoints.ts:140 table=patrol_checkpoints
- src/hooks/usePatrolRouteInstances.ts:344 table=audit_log
- src/hooks/useShiftGate.ts:97 table=zones
- src/hooks/useVehicleAnalysis.ts:41 table=observations
- src/hooks/useVehicleAnalysis.ts:145 table=observations
- src/hooks/useVehicleCompliance.ts:192 table=observations
- src/hooks/useVehicleProfilePhoto.ts:53 table=observations
- src/hooks/useVehicleProfilePhoto.ts:125 table=observations
- src/hooks/useZones.ts:90 table=zones
- src/hooks/useZones.ts:116 table=zones
- src/hooks/useZones.ts:138 table=zones
- src/lib/dispatchJobs.ts:25 table=dispatch_jobs
- src/lib/dispatchJobs.ts:36 table=dispatch_jobs
- src/lib/fullExport.ts:271 table=observations
- src/lib/geofence.ts:249 table=patrols
- src/lib/geofence.ts:265 table=zones
- src/lib/geofence.ts:273 table=zones
- src/lib/geofence.ts:442 table=patrols
- src/lib/geofence.ts:457 table=patrols
- src/lib/scanPipeline.ts:71 table=observations
- src/lib/testUtils.ts:151 table=zones
- src/lib/testUtils.ts:178 table=observations
- src/lib/testUtils.ts:207 table=breach_alerts
- src/lib/testUtils.ts:360 table=observations
- src/lib/testUtils.ts:400 table=observations
- src/lib/testUtils.ts:465 table=zones
- src/lib/testUtils.ts:468 table=observations
- src/lib/testUtils.ts:471 table=breach_alerts

## Review Needed

- src/hooks/useFlaggedVehicles.ts:145 table=flagged_vehicles
- src/hooks/useFlaggedVehicles.ts:167 table=flagged_vehicles
- src/hooks/useHealthSafety.ts:154 table=health_safety_reports
- src/hooks/useHealthSafety.ts:173 table=health_safety_reports
- src/hooks/useHealthSafety.ts:216 table=health_safety_reports
- src/hooks/useManDownDetection.ts:89 table=officer_welfare_alerts
- src/hooks/useManDownDetection.ts:197 table=officer_welfare_alerts
- src/hooks/useOfficerNotifications.ts:152 table=flagged_vehicles
- src/hooks/useOfficerNotifications.ts:179 table=investigation_jobs
- src/hooks/useOfficerNotifications.ts:258 table=flagged_vehicles
- src/hooks/useOfficerNotifications.ts:266 table=investigation_jobs
- src/hooks/useOfficerWelfareMonitor.ts:102 table=officer_welfare_alerts
- src/hooks/useOfficerWelfareMonitor.ts:125 table=officer_welfare_alerts
- src/hooks/useOfficerWelfareMonitor.ts:170 table=officer_welfare_settings
- src/hooks/usePatrolCheckpoints.ts:113 table=checkpoint_visits
- src/hooks/usePatrolRouteInstances.ts:155 table=patrol_route_instance_stops
- src/hooks/usePatrolRouteInstances.ts:294 table=patrol_route_instance_stops
- src/hooks/usePatrolRouteInstances.ts:312 table=patrol_route_instance_stops
- src/hooks/usePatrolRouteInstances.ts:350 table=patrol_route_instance_stops
- src/hooks/usePatrolRouteInstances.ts:362 table=patrol_route_instances
- src/hooks/usePatrolRouteInstances.ts:370 table=patrol_route_instances
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
- src/hooks/useAuditLogs.ts:218 table=audit_log

## Notes

- This is a static text audit; final authority remains Supabase RLS policies.
- Tables marked global/user-scoped are allowed to omit organization filters in client code.
