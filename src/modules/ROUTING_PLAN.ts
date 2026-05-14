/**
 * Consolidated Module Routing Structure
 * 
 * This file defines the new routing hierarchy for all 6 core modules.
 * Replace scattered /pages routes with /modules/<module>/views/<view>.
 * 
 * PHASES:
 * Phase 1 (Foundation) ✅ — Module structure + shared components created
 * Phase 2 (Dashboard & Patrol) — Consolidate 12 pages into 2 modules (in progress)
 * Phase 3 (Enforcement & Operations) — Consolidate 65+ pages into 2 modules
 * Phase 4 (Admin & Cleanup) — Consolidate 25+ pages + all *Log pages into 1 module
 * 
 * MIGRATION PLAN:
 * - Old page: /pages/AdminHub.tsx → New home: /modules/dashboard/views/Overview.tsx
 * - Old page: /pages/BreachAlerts.tsx → New home: /modules/enforcement/views/Breaches.tsx
 * - Old page: /pages/ZoneManagement.tsx → New home: /modules/operations/views/Zones.tsx
 * - All *Log pages (30+) → /modules/administration/views/AuditLog.tsx (unified)
 */

export const CONSOLIDATED_ROUTING = {
  // MODULE: DASHBOARD (consolidates 15+ pages)
  '/dashboard': {
    module: 'dashboard',
    pages: [
      'AdminHub',
      'FieldOfficerPortal',
      'CleanDashboard',
      'ComplianceDashboard',
      'LiveOfficerTracking',
      'OperationsMap',
      'NotificationsCenter',
      'IncidentHeatmap',
      'OccupancyAnalytics',
    ],
    views: {
      'overview': 'Overview (home)',
      'analytics': 'Analytics tab',
      'operations-map': 'Operations map',
      'alerts': 'Alerts/notifications',
    },
  },

  // MODULE: PATROL (consolidates 25+ pages)
  '/patrol': {
    module: 'patrol',
    pages: [
      'RosterPlanner',
      'PatrolScheduleManagement',
      'OpenShifts',
      'LivePatrolMonitor',
      'PatrolNavigation',
      'PatrolKPIDashboard',
      'PatrolRouteOptimiser',
      'OfficerWelfareSettings',
      'PatrolCheckpointManagement',
      'CalloutShifts',
      'OnCallPeriods',
      'LeaveManagement',
      'DispatchedJobsList',
      'DispatchConsole',
    ],
    views: {
      'scheduler': 'Roster & schedule',
      'live': 'Live monitor',
      'analytics': 'Analytics',
      'routes': 'Routes',
      'welfare': 'Officer welfare',
      'checkpoints': 'Checkpoints',
    },
  },

  // MODULE: ENFORCEMENT (consolidates 35+ pages)
  '/enforcement': {
    module: 'enforcement',
    pages: [
      'Breaches',
      'BreachAlerts',
      'BreachNotices',
      'BreachEscalation',
      'CompliancePage',
      'Compliance',
      'IncidentManagement',
      'IncidentReports',
      'EnforcementActions',
      'EnforcementCommandCenter',
      'InfringementNotices',
      'NoticeToVacate',
      'TrespassNotices',
      'Disputes',
      'InvestigationJobsPage',
      'EvidencePackages',
      'EvidencePhotoLinker',
      'PersonsOfInterestLog',
      'FlaggedVehicleManager',
      'VehiclesOfInterestLog',
    ],
    views: {
      'breaches': 'Breaches',
      'compliance': 'Compliance tracking',
      'incidents': 'Incidents',
      'actions': 'Actions queue',
      'notices': 'Notices',
      'investigations': 'Investigations',
      'disputes': 'Disputes',
      'evidence': 'Evidence management',
    },
  },

  // MODULE: OPERATIONS (consolidates 30+ pages)
  '/operations': {
    module: 'operations',
    pages: [
      'ZoneManagement',
      'ClientSites',
      'VehicleManagement',
      'Vehicles',
      'VehicleDetailPage',
      'AssetManagement',
      'PointsOfInterest',
      'DispatchLOIBrowser',
      'FixedCameras',
      'CamperRegistrations',
      'PersonRecords',
      'CanonicalPersonsLog',
      'CanonicalVehicleLog',
      'VehicleRegistry',
      'ParkingPermitManager',
      'SitePermissionsAdmin',
      'SiteRiskAssessment',
      'ZoneSignageEvidence',
    ],
    views: {
      'zones': 'Zone management',
      'sites': 'Site directory',
      'vehicles': 'Vehicle registry',
      'assets': 'Asset management',
      'poi': 'Points of interest',
      'cameras': 'Fixed cameras',
      'persons': 'Persons registry',
    },
  },

  // MODULE: ADMINISTRATION (consolidates 25+ pages + ALL 30+ Log pages)
  '/admin': {
    module: 'administration',
    pages: [
      'UserManagement',
      'AccessPermissions',
      'AccessControlPage',
      'OrganizationManagement',
      'Settings',
      'Profile',
      'AuditLog', // Note: All 30+ Log pages consolidate here
      'ComplianceAuditLog',
      'UserSessionsLog',
      'CredentialProcessingLog',
      'ImportBatchLog',
      'NotificationLog',
      'BugReportLog',
      'FeatureFlagLog',
      'DataManagement',
      'DataCleanupUtility',
      'GrandMasterRawDataBrowser',
      'FeatureFlagManager',
    ],
    views: {
      'users': 'Users & teams',
      'permissions': 'Permissions',
      'organization': 'Organization settings',
      'audit': 'Unified audit log', // Replaces 30+ Log pages
      'data': 'Data management',
      'settings': 'Settings & HR',
      'flags': 'Feature flags',
    },
  },

  // MODULE: BOB AI (consolidates 8 pages)
  '/bob': {
    module: 'bob',
    pages: [
      'BobStudio',
      'BobAssistantStudio',
      'BobIntakeQueue',
      'BobProposalLog',
      'BobProposalEventLog',
      'OpsLivePlanReviewQueue',
    ],
    views: {
      'studio': 'AI studio',
      'queue': 'Proposal queue',
    },
  },
}

// Summary for progress tracking
export const CONSOLIDATION_SUMMARY = {
  total_old_pages: 200,
  target_modules: 6,
  target_primary_views: '25-30',
  phase_1_complete: 7, // 7 shared components + module folders created
  pages_to_migrate: 200,
  log_pages_to_consolidate: 30,
  estimated_effort: 'Phase 2-3 weeks for full migration',
}
