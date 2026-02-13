/**
 * App Version Tracking
 * Format: MAJOR.MINOR.PATCH
 * - MAJOR (first digit): Significant backend changes
 * - MINOR (second digit): Frontend changes
 * - PATCH (third digit): Minor amendments
 */

export const APP_VERSION = '2.5.0016';

export const VERSION_HISTORY = [
  {
    version: '2.5.0016',
    date: '2025-02-13',
    changes: [
      '🔧 CRITICAL FIX: Homeless vehicle status priority corrected in dashboard',
      '✅ Homeless vehicles now ALWAYS show as "HOMELESS" status (FC Act Exempt)',
      '❌ Previously showed as "OVERSTAYER" or "FLAGGED" even when homeless_status = confirmed',
      '🚫 DAY VISIT ZONE COMPLIANCE FIX: 0 nights/month zones now properly detect breaches',
      '✅ Any overnight stay in day-visit-only zones (Akertson, Isel Park, Kinzett) now triggers breach',
      '🎯 Compliance evaluation now checks max_consecutive_nights === 0 separately from > 0',
      '📊 Dashboard now correctly shows breached vehicles in day-visit zones',
      '🏠 Homeless priority: homeless > overstayer > at_risk > flagged > compliant',
    ],
  },
  {
    version: '2.5.0015',
    date: '2025-02-13',
    changes: [
      '🏠 HOMELESS "BREACH BUT EXEMPT" DISPLAY: Field officers & admins now see clear status',
      '✅ Compliance modal shows violations PLUS FC Act exemption explanation side-by-side',
      '🚫 Purple badge displays "BREACH BUT EXEMPT (FC ACT)" for confirmed homeless vehicles',
      '📊 Breach Alerts Report shows "BREACH BUT EXEMPT" status prominently in table',
      '🔒 No enforcement actions triggered for FC Act exempt vehicles',
      '🌙 DAY VISIT OVERNIGHT DETECTION: Fixed compliance logic for day-visit-only zones',
      '⚡ Night observation (8pm-6am) → "At Risk" warning (vehicle present at night)',
      '🚨 Morning observation at same GPS location (within 15m) → "Breach" (overnight stay confirmed)',
      '📍 New edge function: evaluate-day-visit-compliance for GPS-based overnight detection',
      '🎯 Zones like Akerston/Kinzett now correctly enforce day-visit-only rules',
    ],
  },
  {
    version: '2.5.0014',
    date: '2025-02-13',
    changes: [
      '📸 AUTO-SELECT PROFILE PHOTO: Vehicle modal now auto-selects best photo when opening',
      '✅ No profile photo but observations have photos → automatically calls select-best-vehicle-photo',
      '🎯 Uses OnSpace AI (Gemini 3 Flash) to score photos based on plate visibility, lighting, angle',
      '🔄 Profile photo updates immediately in modal after selection',
      '🆕 Existing profile photos remain sticky (won\'t overwrite unless manually changed)',
      '✨ Toast notification confirms auto-selection',
    ],
  },
  {
    version: '2.5.0013',
    date: '2025-02-13',
    changes: [
      '🔧 CRITICAL FIX: Analytics Dashboard loadDashboard() query error',
      '❌ Removed is_compliant and is_breach from observation queries',
      '✅ Queries now correctly use vehicle_observations_v2 WITHOUT removed columns',
      '📊 Dashboard stats calculated from monthly stays + compliance_results (not from observations)',
      '🎯 Compliance evaluation is in compliance_results table (Section 2 - Reporting)',
    ],
  },
  {
    version: '2.5.0012',
    date: '2025-02-13',
    changes: [
      '✅ FIXED: Organization Dashboard vehicle modal showing blank form',
      '🔄 Updated openVehicleModal to use vehicle_observations_with_details view',
      '🔗 Observations now properly joined with canonical_vehicles data',
      '🛠️ Vehicle Information form now displays make/model/year/color from canonical records',
      '✅ Compliance results accessed via compatibility view join',
    ],
  },
  {
    version: '2.5.0011',
    date: '2025-02-13',
    changes: [
      '✅ FRONTEND QUERIES UPDATED: All reports now use clean architecture',
      '🔄 ComplianceAnalytics: Uses vehicle_observations_with_details view',
      '🔄 VehicleActivityReport: Joins canonical_vehicles for vehicle details',
      '🔄 EnforcementHub: Queries compliance_results for breach data',
      '🔄 VehicleDetailsView: Uses compatibility view for observation history',
      '📋 Created ARCHITECTURE_MIGRATION_TESTING.md checklist',
      '🔍 Created verify_architecture_integrity.sql for data validation',
      '🎯 All queries follow: observation + canonical + compliance pattern',
    ],
  },
  {
    version: '2.5.0010',
    date: '2025-02-13',
    changes: [
      '🏗️ CLEAN ARCHITECTURE: Separated data gathering from reporting',
      '📊 vehicle_observations_v2 stripped to pure observation data (photo, plate, location, notes)',
      '🔗 Vehicle details now ONLY in canonical_vehicles (no duplication)',
      '⚖️ Compliance results now ONLY in compliance_results table',
      '✅ Section 1 (Data Gathering): Observation records what was seen',
      '✅ Section 2 (Reporting): Compliance evaluates against matrix rules',
      '🔄 Created vehicle_observations_with_details view for backward compatibility',
      '🎯 process-field-scan refactored: create observation → evaluate compliance (separate steps)',
    ],
  },
  {
    version: '2.5.0009',
    date: '2025-02-12',
    changes: [
      '✅ ADMIN PORTAL CONSOLIDATION COMPLETE - All 5 Phases Done',
      '📋 Created comprehensive testing checklist for all consolidated hubs',
      '🎯 Phase 1-5 verified: Officer Welfare + Enforcement + Analytics + Data + Settings',
      '📊 Total reduction: 40+ pages → 25 pages (37% fewer admin pages)',
      '🔍 Testing protocol ready for systematic verification',
      '✨ All consolidated hubs maintain 100% original functionality',
    ],
  },
  {
    version: '2.5.0008',
    date: '2025-02-12',
    changes: [
      '🚗 MOTORWEB PRIMARY SOURCE: Motorweb NZ now first priority for enrichment',
      '📊 Enrichment order: Motorweb → Photo Analysis → NZSCV → Carjam',
      '✅ Motorweb provides most accurate NZ vehicle registration data',
      '🔄 Fallback cascade ensures maximum data coverage',
      '📋 Vehicle Enrichment Maintenance now shows Motorweb badge',
      '⚡ Motorweb integration complete in maintenance workflow',
    ],
  },
  {
    version: '2.5.0007',
    date: '2025-02-12',
    changes: [
      '🚗 CONTINUOUS CAPTURE MODE: Auto-processes with canonical vehicle enrichment',
      '📊 Scanned vehicles show existing data from canonical_vehicles automatically',
      '🤖 Background AI enrichment triggers for incomplete vehicle details',
      '✅ Motorweb Integration: NZ vehicle database enrichment edge function',
      '🔍 Motorweb scrapes make/model/year/color from https://motorweb.co.nz/pub/',
      '🔄 Auto-updates canonical_vehicles with Motorweb data when available',
      '📋 Continuous mode: scan → canonical lookup → AI enrich → add to history (seamless)',
      '🎯 Details mode: scan → popup with enriched data → Check → compliance modal',
    ],
  },
  {
    version: '2.5.0006',
    date: '2025-02-12',
    changes: [
      '🔧 CRITICAL FIX: Officer delete/edit now properly refreshes portal data',
      '✅ ScannedVehiclesList now triggers parent refresh after successful delete/edit',
      '🔄 FieldOfficerPortal handles onScanDeleted callback to update session data',
      '📊 Added detailed logging for delete operations and data reload',
      '🏢 PHASE 4 COMPLETE: Data Management Hub created',
      '📋 Consolidated 4 data management pages into unified hub with tabs',
      '🗂️ Data Hub includes: Vehicles, Zones, Compliance Matrix, Person Records',
      '⚙️ PHASE 5 COMPLETE: Settings & Configuration Hub created',
      '🔐 Consolidated Organizations + Users + System Settings into unified hub',
      '🎯 Master users see all 3 tabs, regular users see Users + System Settings',
      '📉 Total admin pages reduced from 40+ to 25 (37% reduction)',
      '✨ Better navigation with contextual stats in each hub',
    ],
  },
  // ... rest of version history
];

export function compareVersions(v1: string, v2: string): number {
  const parts1 = v1.split('.').map(Number);
  const parts2 = v2.split('.').map(Number);

  for (let i = 0; i < 3; i++) {
    if (parts1[i] > parts2[i]) return 1;
    if (parts1[i] < parts2[i]) return -1;
  }

  return 0;
}

export function isUpdateAvailable(currentVersion: string, latestVersion: string): boolean {
  return compareVersions(latestVersion, currentVersion) > 0;
}
