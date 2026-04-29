# FieldOps Manager - Keep / Merge / Remove Matrix

Purpose: convert the clean rebuild strategy into an executable inventory that drives implementation and safe deletion.

Date: 2026-04-01

Sources:
- docs/CLEAN_REBUILD_DESIGN.md
- docs/CLEAN_REBUILD_EXECUTION_PLAN.md
- docs/LIVE_SCHEMA.md
- docs/LIVE_FUNCTIONS.md
- src/App.tsx
- src/pages/*
- supabase/functions/*

## 1) Frontend Surface Matrix

### 1.1 Keep (Core day-1 rebuild pages)

- Login
- PortalSelection
- AdminPortal
- FieldOfficerPortal
- Compliance (merged)
- Observations (merged)
- Breaches (merged)
- Enforcement (merged)
- Vehicles (merged)
- Zones (merged)
- LiveMap (merged)
- Patrols (merged)
- Reports (merged)
- DataImport (merged)
- Disputes
- Settings
- UserManagement
- Profile
- Platform (Grand Master)
- **CRM** (new clean build — replaces legacy CRMModule; covers org accounts, client sites, contacts, rates, access)
- **BusinessManagement** (new clean build — covers staff/users, roster, fleet, assets, daily checks, audit)
- **ClientPortal** (new clean build — client-scoped site visibility, service summaries, contract reports, dispute links)

### 1.2 Merge (Current pages mapped to clean targets)

- ComplianceDashboard + ComplianceAnalytics + CompliancePage -> Compliance
- ObservationRecords + ObservationsReport + ObservationsView -> Observations
- BreachAlerts + BreachNotices -> Breaches
- EnforcementActions + EnforcementCommandCenter + EnforcementReview -> Enforcement
- VehicleManagement + VehicleRegistry + VehicleDetailPage -> Vehicles
- ZoneManagement + SpatialComplianceAdmin -> Zones
- LivePatrolMonitor + LiveOfficerTracking -> LiveMap
- PatrolScheduleManagement + PatrolKPIDashboard -> Patrols
- Reports + ReportsHub + IncidentReports -> Reports
- DataManagement + DataManagementHub + ImportData + ImportHistoricalData -> DataImport
- PrivacyCurtain -> Settings tab

### 1.3 Remove from production navigation (legacy/dev/internal)

- TestDashboard
- CleanDashboard
- SystemDiagnostics
- DataCleanupUtility
- DataIntegrityDashboard
- CleanupAndRecalculate (page)
- ComplianceRecalculation
- PhotoReingest
- EvidencePhotoLinker
- CanonicalRecordsManager (internal only if retained)
- AiAnalysis (phase 2 optional)
- UniversalSearch (phase 2 optional)
- InvestigationJobsPage (phase 2)
- Service-line and adjacent portals outside freedom-camping day-1 scope:
  - ParkingEnforcementPortal
  - ParkingOfficerPortal
  - NoiseControlPortal
  - NoiseOfficerPortal
  - SiteGuardPortal
  - EMSPortal
  - AccessControlPage
  - CRMModule
  - ClientOrganisationPortal
  - ContractorAccountPage
  - ClientSites
  - DispatchConsole
  - RosterPlanner
  - OfficerSkills
  - OfficerAvailability
  - OpenShifts
  - TimesheetReview
  - TeamChat
  - FaceRecognitionPage
  - PointsOfInterest
  - SiteRiskAssessment
  - VehicleDiscrepancies
  - NZSCVMonitor (role-specific support view; not day-1 core)
  - NotificationsCenter (reassess later)

## 2) Database Matrix

### 2.1 Keep (clean baseline core)

- organizations
- user_profiles
- zones
- zone_compliance_matrix
- zone_legal_config
- zone_signage_evidence
- observations
- breach_alerts
- canonical_vehicles
- canonical_scv
- canonical_homeless
- infringement_notices
- infringement_notice_counters
- notices_to_vacate
- enforcement_cases
- enforcement_case_events
- patrols
- patrol_schedule_zones
- patrol_checkpoints
- checkpoint_visits
- officer_shifts
- officer_welfare_settings
- officer_welfare_alerts
- officer_activity_log
- incidents
- incident_attachments
- health_safety_reports
- person_records
- person_observations
- person_vehicle_links
- person_interactions
- audit_log
- dispute_intake
- privacy_access_log
- privacy_curtain_settings
- retention_policies

### 2.2 Merge

- flagged_vehicles -> canonical_homeless
- homeless_records -> canonical_homeless
- incident_reports (if present) -> incidents + enforcement_cases
- legacy vehicle profile fragments -> canonical_vehicles (+ canonical_scv for SCV status)

### 2.3 Remove from day-1 clean baseline

- vehicle_monthly_stays (replace with direct observations-based compliance counting)
- compliance_results (if still used only as duplicate output)
- investigation_jobs
- investigation_job_templates
- privacy_impact_assessments
- canonical_persons
- other pre-aggregated legacy caches and compatibility views not used by clean UI

## 3) Edge Function Matrix

### 3.1 Keep (rebuild and keep public contracts where needed)

- process-officer-scan
- cleanup-and-recalculate
- generate-notice-to-vacate
- generate-infringement
- sync-scv-list
- create-user
- monitor-officer-welfare
- send-report-email
- export-data (consolidated)
- import-data (consolidated)
- submit-dispute-intake
- public-case-lookup
- hotspot-data
- process-homeless-data
- nightly-privacy-cleanup
- manage-user (consolidated)
- photo-maintenance (consolidated)

### 3.2 Merge / consolidate

- recalculate-compliance + recalculate-compliance-v2 + recalculate-compliance-v3 -> cleanup-and-recalculate
- alpr-process + alpr-retry + orc-ingest + plate-scanner-photo-first + analyze-vehicle-photo + vehicle-ingest + select-best-vehicle-photo + link-evidence-photos + stream-webhook -> process-officer-scan
- scan-breaches + duplicate-detection + correct-zone-assignments + zone-correction + check-almost-breaches + enrich-from-motorweb + sync-spatial-layers -> cleanup-and-recalculate
- observations-export + report generators -> export-data / send-report-email
- import-historical-data -> import-data
- set-user-password + update-user-password + create_auth_and_profiles -> manage-user / create-user
- photo-recovery + daily-photo-reconciler + reingest-photos + scrape-vehicle-photos + parkpow-photo-sync + parkpow-sync -> photo-maintenance

### 3.3 Remove from day-1 product surface

- check-data-integrity
- check-zone-corrections
- check-services-health (legacy alias: check-railway-health)
- test-compliance-matrix
- suggest-new-zone
- get-weather
- upload-file (frontend direct storage upload)
- onspace-ai-chat (phase 2, disabled in day-1 UI)
- process-credential-document (phase 2)
- process-investigation-document (phase 2)

## 4) Roles Matrix

### 4.1 Keep as product roles

- officer
- admin
- master
- grand_master

### 4.2 Merge or demote

- admin_officer -> portal selection behavior, not separate product complexity

### 4.3 Internal/support only

- nzscv_monitor (if retained, do not let it drive top-level product IA)

## 5) Cutover Gates Before Deletion

Do not drop legacy routes, tables, functions, triggers, or policies until all gates pass.

- Gate 1: core flows pass in clean stack (scan, breach generation, notices, patrols, reports)
- Gate 2: data migration reconciliation complete (row counts + key integrity)
- Gate 3: RLS verification complete for officer/admin/master/grand_master
- Gate 4: side-by-side UAT sign-off from operations and admin users
- Gate 5: rollback plan and archive snapshots confirmed

## 6) Immediate Implementation Sequence

1. Scaffold clean SQL baseline in a new rebuild track (do not mutate legacy migrations chain first).
2. Build slim route tree and placeholder pages for the clean 18-page surface.
3. Rebuild consolidated edge functions in the order defined in CLEAN_REBUILD_EXECUTION_PLAN.
4. Write and run migration scripts from live schema to clean schema.
5. Cut over traffic.
6. Archive and then delete legacy objects.
