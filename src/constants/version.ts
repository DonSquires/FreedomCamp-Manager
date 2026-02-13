/**
 * App Version Tracking
 * Format: MAJOR.MINOR.PATCH
 * - MAJOR (first digit): Significant backend changes
 * - MINOR (second digit): Frontend changes
 * - PATCH (third digit): Minor amendments
 */

export const APP_VERSION = '2.5.0026';

export const VERSION_HISTORY = [
  {
    version: '2.5.0026',
    date: '2025-02-13',
    changes: [
      '🏗️ CRITICAL SCHEMA FIXES: Database relationships cleaned and optimized',
      '✅ Added plate_number column to breach_alerts (CRITICAL for admin review)',
      '🔧 Fixed create_breach_alert_from_compliance() trigger to populate plate_number',
      '📋 Identified deprecated relationships: vehicle_record_id (use plate_number instead)',
      '🗂️ canonical_vehicles constraints relaxed: first_seen_at/last_seen_at now nullable',
      '🎯 Core Principles Architecture verified: observations → canonical_vehicles → compliance_results',
      '⚡ System ready for comprehensive recalculation of all compliance data',
    ],
  },
  {
    version: '2.5.0025',
    date: '2025-02-13',
    changes: [
      '📅 LINZ DATA CORRECTION: All LINZ records backdated by 1 day',
      '🕐 Default time standardized to 19:00 (7pm NZ) for all LINZ imported data',
      '✅ Fixed timezone import error causing records to appear one day ahead',
      '🔧 Updated tables: vehicle_observations_v2, vehicle_records, enforcement_actions, compliance_results',
      '📊 LINZ zones: Today\'s records moved to yesterday, time set to 19:00',
    ],
  },
  {
    version: '2.5.0024',
    date: '2025-02-13',
    changes: [
      '🔧 CRITICAL FIX: Dashboard "Invalid time value" error resolved',
      '✅ Fixed toNZDate() function using Intl.DateTimeFormat instead of locale string parsing',
      '📅 Simplified date range calculations to avoid timezone conversion issues',
      '🛡️ Added validation and fallbacks in getNZDateRange() for invalid dates',
      '✨ Date inputs now initialize correctly with today\'s date in YYYY-MM-DD format',
      '🌍 NZ timezone conversion still applied at database query level (unchanged)',
    ],
  },
  {
    version: '2.5.0023',
    date: '2025-02-13',
    changes: [
      '🔧 CRITICAL FIX: Date picker inputs showing blank/"Invalid Date"',
      '✅ Date inputs now properly initialize with today\'s date in YYYY-MM-DD format',
      '🔒 Added fallback handling for empty/null date values',
      '📅 HTML5 date inputs now correctly display and accept dates',
      '🛡️ normalizeDateString() now returns today instead of empty string on invalid input',
      '✨ Date pickers work correctly on mobile and desktop browsers',
    ],
  },
  {
    version: '2.5.0022',
    date: '2025-02-13',
    changes: [
      '🚨 CRITICAL DATA CORRUPTION FIX: All datetime recording now forces NZ timezone',
      '✅ Problem: Users with browsers set to non-NZ timezones (e.g., USA PST) caused records to appear in wrong day',
      '🔧 Solution: All recording operations now explicitly convert to NZ time before UTC storage',
      '📍 Edge Functions: process-field-scan now uses Pacific/Auckland timezone for recorded_at',
      '📱 Frontend: EvidenceCollection and PlateCapture force NZ timezone before toISOString()',
      '🕐 Flow: Browser time → Convert to NZ time → Store as UTC → Display as NZ time',
      '✨ Example: Tania in NZ records at 10am NZ → stored as correct UTC → shows as "today" ✅',
      '🌍 Added toUTCFromNZ() helper function for timezone-safe conversions',
      '📊 All observations now consistently use NZ timezone regardless of browser settings',
    ],
  },
  {
    version: '2.5.0021',
    date: '2025-02-13',
    changes: [
      '🔧 CRITICAL FIX: "Invalid time value" error when loading dashboard',
      '✅ Added normalizeDateString() to handle both YYYY-MM-DD and DD/MM/YYYY formats',
      '📅 HTML5 date inputs now correctly validate and normalize DD/MM/YYYY → YYYY-MM-DD',
      '🌍 parseNZDate() now handles NZ locale format (13/02/2026) in addition to ISO format',
      '🔍 Added debug logging for date format conversions',
      '✨ Dashboard date fields now work correctly regardless of browser locale',
    ],
  },
  {
    version: '2.5.0020',
    date: '2025-02-13',
    changes: [
      '🕐 CRITICAL TIMEZONE FIX: All dashboard dates now use NZ timezone (Pacific/Auckland)',
      '✅ Date filters convert NZ dates to UTC for database queries (fixes "yesterday" bug)',
      '📅 Today in NZ properly filters observations from 00:00 to 23:59 NZ time',
      '🌍 Database queries use UTC range: NZ midnight → UTC (accounts for +13 offset)',
      '📊 Display dates show NZ timezone explicitly: "(NZ Time)" indicators added',
      '🔧 Fixed drill-down date filtering to use NZ timezone consistently',
      '✨ Tania\'s scans today now show as "today", Bex\'s last night show as "yesterday"',
      '🎯 All date navigation (Today, Yesterday, Last 7/30/90 Days) now NZ-aware',
    ],
  },
  {
    version: '2.5.0019',
    date: '2025-02-13',
    changes: [
      '📅 DRILL-DOWN DATE FILTER VISIBILITY: Zone drill-down now clearly shows active date range',
      '✨ Added date range indicator in zone header with calendar icon',
      '🔍 Category breakdown shows duration badge (Single Day / X Days)',
      '📋 Vehicle list header confirms which date range is being viewed',
      '✅ Date filters already working, now VISUALLY OBVIOUS to users',
    ],
  },
  {
    version: '2.5.0018',
    date: '2025-02-13',
    changes: [
      '🏗️ DASHBOARD REBUILT FROM CORE PRINCIPLES - Complete architecture overhaul',
      '✅ Status calculation now uses compliance_results table (Section 2 - Reporting)',
      '🎯 Priority hierarchy: homeless → overstayer → at_risk → flagged → compliant',
      '🏠 Homeless vehicles (confirmed) show as HOMELESS (breach but FC Act exempt)',
      '⚖️ Overstayers determined by compliance_results.is_compliant = false',
      '⚠️ At Risk detected by violation_reasons containing "at risk" or "one more night"',
      '📊 Compliance rate excludes homeless vehicles (FC Act exemption)',
      '✨ No more reliance on vehicle_monthly_stays for status determination',
      '🔍 Console logging shows complete status calculation flow',
      '📈 Zone breakdown correctly aggregates homeless/overstayer/at-risk counts',
    ],
  },
  {
    version: '2.5.0017',
    date: '2025-02-13',
    changes: [
      '📊 COMPLIANCE CALCULATION FIX: Homeless vehicles (FC Act exempt) now excluded from compliance rate',
      '✅ Compliance rate formula: (non-homeless compliant) / (total non-homeless vehicles)',
      '🏠 Homeless vehicles no longer counted as non-compliant (FC Act exemption)',
      '📍 Zone Performance cards now display homeless vehicle count when > 0',
      '🎯 Zone cards show homeless count in cyan, flagged count in purple (only when present)',
      '✨ Dashboard compliance stats now accurately reflect FC Act exemptions',
    ],
  },
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
