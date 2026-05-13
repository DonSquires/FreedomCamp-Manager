# Enterprise Consolidation Blueprint
## FieldOps Manager — Single Service Provider App

**Date**: May 13, 2026  
**Status**: DRAFT (Ready for Review & Iteration)  
**Phase**: Architecture Planning (Pre-Implementation)

---

## Executive Summary

Your app has **200+ pages** (80 feature pages + 120+ LOG variants) spread across 9 portals. This causes:
- **Cognitive overload** — Users can't find features
- **Maintenance debt** — Duplicate code patterns
- **Navigation chaos** — 400+ routes without clear hierarchy
- **Mobile unusability** — Side-by-side portals don't translate to mobile

**Consolidation Goal**: Reduce to **25–30 primary views** organized into **6 core modules**, with:
- Unified navigation (sidebar + breadcrumbs)
- Role-based visibility (same UI, different permissions)
- Centralized audit logging (no separate *Log pages)
- Tab-based related data (instead of multi-page linking)
- Mobile-responsive design from day one

---

## Current State Analysis

### Pages by Category

| Category | Count | Problem |
|----------|-------|---------|
| **LOG pages** | ~120 | Each entity has ComplianceLog, ComplianceAuditLog, ComplianceResultLog, etc. Redundant UI pattern. Should be ONE unified audit table with filters. |
| **Portals** | 9 | AdminPortal, FieldOfficerPortal, ClientOrganisationPortal, ParkingOfficerPortal, NoiseOfficerPortal, BiosecurityOfficerPortal, EMS, SiteGuard, Public (x5). Portal cloning instead of role-based visibility. |
| **Management** | 15 | UserManagement, VehicleManagement, ZoneManagement, AssetManagement, etc. Each is single-purpose, no module context. |
| **Detail pages** | 20+ | PersonRecords, VehicleDetailPage, ObservationRecords, etc. Each isolated; no "back + context" flow. |
| **Dashboards** | 20+ | ComplianceDashboard, ComplianceAnalytics, PatrolKPIDashboard, OccupancyAnalytics, etc. Inconsistent data presentation. |
| **Bob/AI** | 8 | BobStudio, BobAssistantStudio, BobIntakeQueue, etc. AI features scattered; should be unified AI Control Center. |
| **Dev/Admin** | 15+ | CleanDashboard, TestDashboard, GrandMasterRawDataBrowser, DataCleanupUtility, etc. Debug/dev features mixed with user features. |
| **Reports** | 10+ | Reports, ReportsHub, CustomReportBuilder, IncidentReports, ObservationsReport, etc. Inconsistent report patterns. |
| **Other** | ~50 | Miscellaneous: Compliance, Breaches, Dispatch, Alerts, Enforcement, etc. |

---

## Target Architecture

### 6 Core Modules (Enterprise Pattern)

```
FieldOps Manager
├── Dashboard Hub
│   ├── Operations Overview (map + KPIs)
│   ├── Compliance Status (real-time)
│   ├── Officer Welfare (activity + alerts)
│   └── Quick Actions (dispatch, report, etc.)
│
├── Patrol Management
│   ├── Roster & Schedule
│   ├── Live Patrol Monitor (map + team)
│   ├── Route Optimizer
│   ├── Patrol History & Analytics
│   └── Officer Welfare & Alerts
│
├── Enforcement
│   ├── Incidents & Breaches (unified list)
│   ├── Compliance Tracking (status + actions)
│   ├── Notices & Escalations
│   ├── Investigation Jobs
│   └── Audit Trail (single table, no separate Log pages)
│
├── Operations (Zones, Sites, Vehicles)
│   ├── Zone Management (map + config)
│   ├── Site Directory (list + detail)
│   ├── Vehicle Registry (scan + detail)
│   ├── Asset Management (equipment + inventory)
│   └── Points of Interest (POI config)
│
├── Administration
│   ├── Users & Teams (org structure)
│   ├── Permissions & Roles
│   ├── Organization Settings
│   ├── Communication Settings (PTT, Radio, Chat)
│   ├── Audit Log (UNIFIED, not scattered *Log pages)
│   └── Data Management (imports, cleanup, exports)
│
└── Specialty Modules (Optional per client)
    ├── Parking Enforcement
    ├── Noise Control
    ├── Biosecurity
    ├── Smoke Compliance
    ├── EMS Integration
    └── Intelligence & CRM
```

---

## Page Migration Map

### Module 1: Dashboard Hub (REDUCE from 15+ pages → 5 views)

| Current Pages | Future Home | Consolidation |
|---|---|---|
| AdminHub, AdminPortal, FieldOfficerPortal (home variants) | Dashboard: Overview | Single homepage; role-based visibility inside tabs |
| CleanDashboard, TestDashboard, ComplianceDashboard, OccupancyAnalytics, IncidentHeatmap | Dashboard: Analytics Tab | Unified analytics card/chart layout |
| LiveOfficerTracking, LivePatrolMonitor, OperationsMap, JobMap | Dashboard: Operations Map Tab | Single map view with layer toggles |
| NotificationsCenter, OfficerWelfareAlertsLog | Dashboard: Alerts Sidebar | Toast + notification drawer |
| Platform, PortalSelection | Routing (not a page) | Remove portal selector; route by role + org |

**Action**: Create `Dashboard/` module with 5 views; remove 15+ redundant pages.

---

### Module 2: Patrol Management (REDUCE from 25+ pages → 7 views)

| Current Pages | Future Home | Consolidation |
|---|---|---|
| RosterPlanner, PatrolScheduleManagement, OpenShifts, OpenShiftManager | Patrol: Scheduler | Single scheduler view with date/officer tabs |
| LivePatrolMonitor, PatrolNavigation, DispatchedJobsList | Patrol: Live Monitor | Map + officer list + job queue in unified dashboard |
| PatrolKPIDashboard, OfficerPerformanceReport, PatrolEventLog | Patrol: Analytics | Tab in scheduler or separate Analytics view |
| PatrolRouteOptimiser, PatrolRouteLog | Patrol: Routes | Route config + history in detail panel |
| OfficerWelfareSettings, WelfareCheckinLog, OfficerActivityLog | Patrol: Welfare | Officer profile tab "Welfare & Activity" |
| PatrolCheckpointManagement, PatrolCheckpointLog | Patrol: Checkpoints | Config in Zone detail; logs in audit trail |
| CheckpointVisitLog, PatrolSessionEventLog, PatrolFieldEventLog, DriftEventLog | Audit Trail | Move to Administration: Audit Log |

**Action**: Consolidate to 7 strategic views. Archive/audit all *Log pages.

---

### Module 3: Enforcement (REDUCE from 35+ pages → 8 views)

| Current Pages | Future Home | Consolidation |
|---|---|---|
| Breaches, BreachAlerts, BreachNotices, BreachEscalation | Enforcement: Breaches | List with status filters; detail tabs (history, actions, notices) |
| CompliancePage, Compliance, ComplianceRecalculation | Enforcement: Compliance | Unified compliance tracker; recalculation as background job |
| IncidentManagement, IncidentReports, IncidentLog | Enforcement: Incidents | Unified incident registry; reports as ad-hoc dashboards |
| EnforcementActions, EnforcementActionLog, EnforcementCommandCenter, EnforcementReview | Enforcement: Actions | Action queue + detail; review as workflow state |
| InfringementNotices, InfringementNoticeLog, ParkingInfringementLog | Enforcement: Notices | Multi-notice-type selector; detail tabs |
| NoticeToVacate, NoticeToVacateLog, TrespassNotices, TrespassNoticeLog | Enforcement: Notices | Consolidate with other notice types |
| ComplianceEscalations, ComplianceAnalytics | Enforcement: Dashboard | Escalation queue + analytics cards |
| InvestigationJobsPage, InvestigationJobLog, InvestigationJobConfig | Enforcement: Investigations | Job config inline in detail; history in audit log |
| Disputes, DisputeIntakeLog, PublicDisputePortal | Enforcement: Disputes | Unified dispute intake; public portal as separate route branch |
| PersonsOfInterestLog, FlaggedVehicleLog, FlaggedVehicleManager | Enforcement: Watchlist | Single list with person/vehicle tabs |
| ObservationRecords, ObservationLog, ObservationDeletionLog, ObservationZoneAuditLog, PersonObservationLog | Enforcement: Observations | Replace with Audit Trail entries; raw observation data only in batch export |
| VehiclesOfInterestLog, VehicleDiscrepancies, VehicleDiscrepancyLog | Enforcement: Vehicle Alerts | Single vehicle anomaly dashboard |
| EvidencePackages, EvidencePhotoLinker, PhotoMetadataLog, PhotoReingest | Enforcement: Evidence | Evidence management with photo ingestion workflow |

**Action**: Consolidate to 8 strategic views. Merge *Log pages into unified Audit.

---

### Module 4: Operations (REDUCE from 30+ pages → 6 views)

| Current Pages | Future Home | Consolidation |
|---|---|---|
| ZoneManagement, ZoneAmenities, ZoneLegalConfigViewer | Operations: Zones | Map + list with detail tabs (amenities, legal config, dispatch rules) |
| ClientSites, ClientSiteLog, SitePermissionsAdmin, SiteRiskAssessment, SiteRiskTrends, SiteIncidentLog | Operations: Sites | Directory + detail tabs (risk, incidents, permissions, incidents) |
| VehicleManagement, Vehicles, VehicleRegistry, VehicleDetailPage, VehicleMonthlyStayLog, CanonicalVehicleLog, CanonicalScvLog | Operations: Vehicles | Registry + filter + detail tabs (scans, stay history, registration) |
| AssetManagement (5 tabs already: Equipment, Stock, Stocktake, Key Mgmt) | Operations: Assets | Expand with Category filtering + barcode scanner integration |
| PointsOfInterest, DispatchLOIBrowser, LocationsOfInterestLog | Operations: POI | Map + list + detail (with dispatch rules) |
| FixedCameras, FixedCameraLog | Operations: Cameras | Camera registry + live feed view |
| ZoneSignageEvidence, ZoneSignageEvidenceLog, SiteGuardPortal | Operations: Compliance Evidence | Site photo evidence + audit trail |
| CamperRegistrations, PublicCamperRegistration, CanonicalPersonsLog, CanonicalHomelessLog, CanonicalPersonZonesLog | Operations: Persons Registry | Central person record with zone assignment history |
| PersonRecords, PersonRecordLog, CanonicalPersonViewer, PersonInteractionLog, PersonRecordLog, CanonicalRecordsManager | Operations: Persons Registry (consolidate above) | Single registry; logs in audit trail |
| VehicleDiscrepancies, ParkingPermitManager, ParkingPermitLog, ParkingZoneLog | Operations: Parking Config | Parking-specific zone/permit config |

**Action**: Consolidate to 6 views; break *Log pages into audit stream.

---

### Module 5: Administration (REDUCE from 25+ pages → 7 views)

| Current Pages | Future Home | Consolidation |
|---|---|---|
| UserManagement, OfficerSkills, OfficerSkillsLog, OfficerAvailability, OfficerAvailabilityLog | Admin: Users & Teams | User list + detail tabs (skills, availability, shifts, welfare) |
| AccessPermissions, AccessControlPage, AccessAuditLog, SitePermissionsAdmin | Admin: Permissions | Permission matrix + access audit in unified audit log |
| OrganizationManagement, OrganizationProfile, OrganizationLog, ServiceAgreements, ContractorManager, ContractorAccountPage, ClientAccountPage | Admin: Organization | Org profile + detail tabs (contracts, clients, settings) |
| Settings, Profile, OfficerAllowances, TravelAllowances, OnCallPeriods, CalloutShifts, LeaveManagement | Admin: Settings & HR | User profile + org settings in sidebar |
| AuditLog, ComplianceAuditLog, UserSessionsLog, CredentialProcessingLog, ImportBatchLog, ImportStagingLog, NotificationLog, BugReportLog, FeatureFlagLog (ALL *Log pages) | Admin: Unified Audit Log | Single table with entity type + action filters (replace 30+ *Log pages) |
| DataManagement, DataManagementHub, GrandMasterRawDataBrowser, DataCleanupUtility, DataIntegrityDashboard, CleanupAndRecalculate, ImportData, ImportHistoricalData, PhotoReingest, CohortAnalysis | Admin: Data Management | Data import + export + cleanup workflows |
| FeatureFlagManager, FeatureFlagEvaluationLog, FeatureFlagRolloutLog | Admin: Feature Flags | Feature flag management + rollout queue |

**Action**: Consolidate to 7 views. Merge ALL 30+ *Log pages into single Audit Log with filters.

---

### Module 6: Bob/AI Control Center (CONSOLIDATE from 8+ pages → 1-2 views)

| Current Pages | Future Home | Consolidation |
|---|---|---|
| BobStudio, BobAssistantStudio, GrandmasterCodingStudio | Bob: Studio | Single AI prompt/testing environment with access tiers |
| BobIntakeQueue, BobProposalLog, BobProposalEventLog, BobActionProposalEventLog, OpsLivePlanReviewQueue | Bob: Proposal Queue | Unified intake + proposal + approval workflow |
| BobUIReview | Bob: UI Review | Feature in Studio; removed as separate page |

**Action**: Consolidate to 2 strategic views (Studio + Queue). Remove debug pages.

---

### Optional Specialty Modules

| Module | Current Pages | Future Home | Status |
|---|---|---|---|
| **Parking** | ParkingEnforcementPortal, ParkingOfficerPortal, ParkingAppeals, ParkingPaymentLog, ParkingPermitLog, ParkingSessionLog, ParkingZoneLog, DynamicPricing, RevenueForecast, PublicPayByPlate | Specialty: Parking | Separate module if multi-client requirement |
| **Noise** | NoiseControlPortal, NoiseOfficerPortal, NoiseComplaintsLog, NoiseAssessmentLog, NoiseNoticeLog, NoiseJobLog, PublicNoiseComplaintPortal, SmokeComplaintControlPage, SmokeComplaintOfficerPortal | Specialty: Noise Control | Separate module if multi-client requirement |
| **Biosecurity** | BiosecurityOfficerPortal, BiosecurityControlPage | Specialty: Biosecurity | Separate module if multi-client requirement |
| **EMS & Mobility** | EMSPortal, EmsAttendanceLog, MobilePlateFinder | Specialty: EMS | Separate module if multi-client requirement |
| **Intelligence & CRM** | CRMModule, ClientMasterList, TenderWorkspace, TenderWorkspaceDetail, TenderReferenceLibrary, IntelApprovalQueue, POIVOIDashboard | Specialty: Intelligence | Separate module if multi-client requirement |
| **Communications** | PTTRadio, RadioAuditDashboard, RadioTransmissionsLog, RadioCommsEventLog, RadioTranscriptLog, RadioTranslationLog, RadioTtsRenderLog, RadioVoiceConsentLog, RadioVoiceProfileLog, LMRBridge, LmrBridgeSessionLog, LmrBridgeConfigLog, TeamChat, NZSCVMonitor, MobilePlateFinder | Specialty: Communications | Separate module if multi-client requirement |

---

## Navigation Architecture

### Sidebar Navigation (Desktop)

```
FieldOps Manager (Logo)
├── [Search + Command Palette]
│
├── Patrol
│   ├─ Dashboard (main)
│   ├─ Live Monitor
│   ├─ Roster & Schedule
│   ├─ Routes
│   └─ Analytics
│
├── Enforcement
│   ├─ Breaches
│   ├─ Compliance
│   ├─ Incidents
│   ├─ Notices
│   ├─ Actions
│   └─ Investigations
│
├── Operations
│   ├─ Zones
│   ├─ Sites
│   ├─ Vehicles
│   ├─ Assets
│   ├─ POI
│   └─ Persons
│
├── Users (Admin only)
│   ├─ Team Members
│   ├─ Permissions
│   ├─ Organization
│   └─ Settings
│
├── Reports
│   === Saved Report Templates ===
│   (Dynamic based on org config)
│
└── (+ Specialty Modules, if enabled)
    ├─ Parking
    ├─ Noise Control
    ├─ Communications
    └─ Intelligence
```

### Mobile Navigation

- Sidebar collapses to hamburger icon (2 columns: icon + label)
- Favorites pinnable to toolbar
- Bottom tab bar for quick access (Dashboard, Live Map, Notifications, User)
- Single-column view for all pages

### Global Search & Commands

- Command palette (⌘+K or Ctrl+K): Search pages, saved filters, recent items
- Search filters: Type-ahead by entity (patrol, breach, zone, person, vehicle, etc.)
- Saved searches: Quick links to pre-filtered views

---

## Implementation Phases

### Phase 1: Foundation (Week 1–2)
- [ ] Create module folder structure: `src/modules/patrol/`, `src/modules/enforcement/`, etc.
- [ ] Create shared AuditLog component (replaces 30+ *Log pages)
- [ ] Create Sidebar component with navigation tree
- [ ] Create tab-based detail page component (reusable for all detail views)
- [ ] Set up role-based visibility guards

### Phase 2: Dashboard & Patrol (Week 2–3)
- [ ] Consolidate dashboard pages into Dashboard module
- [ ] Consolidate patrol pages into Patrol module
- [ ] Migrate routing (update App.tsx with new route structure)
- [ ] Update breadcrumb navigation

### Phase 3: Enforcement & Operations (Week 4–5)
- [ ] Consolidate enforcement pages into Enforcement module
- [ ] Consolidate operations pages into Operations module
- [ ] Implement unified audit log
- [ ] Update searches and filters

### Phase 4: Administration & Cleanup (Week 6–7)
- [ ] Consolidate admin pages into Administration module
- [ ] Remove old portal redirect logic
- [ ] Implement feature flags for specialty modules
- [ ] Deprecate old pages with redirects

### Phase 5: Testing & Docs (Week 8)
- [ ] E2E tests for new routing
- [ ] Mobile responsiveness QA
- [ ] Update instruction manual with new navigation
- [ ] Create user training videos

---

## Key Principles

1. **One module, one responsibility**
2. **Tabs for related data** (not separate pages)
3. **Single audit log** (not scattered *Log pages)
4. **Role-based visibility** (same UI, different data)
5. **Mobile-first components** (sidebar collapse, responsive tables)
6. **Reusable patterns** (DetailPanel, AuditLog, TabContainer, ActionQueue)

---

## Next Steps

1. **Review & Feedback** — Does this structure align with your business model?
2. **Assign Owners** — Who owns each module consolidation?
3. **Create ADR** — Document architecture decision
4. **Start Phase 1** — Begin module folder structure and shared components
5. **Update Instruction Manual** — New navigation flows
