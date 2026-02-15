/**
 * App Version Tracking
 * Format: MAJOR.MINOR.PATCH
 * - MAJOR (first digit): Significant backend changes
 * - MINOR (second digit): Frontend changes
 * - PATCH (third digit): Minor amendments
 */

export const APP_VERSION = '2.11.0007';

export const VERSION_HISTORY = [
  {
    version: '2.11.0007',
    date: '2025-02-15',
    changes: [
      '🎨 HUMAN-FRIENDLY: Replaced all raw JSON displays with professional formatted views',
      '✅ Observation Details: Compliance metrics now show in clean grid cards with labels',
      '✅ Data Integrity: Technical details formatted as key-value pairs, not raw JSON',
      '✅ Audit History: Change logs display as readable key-value tables',
      '✅ Activity Dashboard: Audit logs show structured data instead of JSON dumps',
      '🗑️ Removed unnecessary "Record Information" section from observation details',
      '📱 Mobile-friendly: All formatted displays work perfectly on phones/tablets',
      '💡 Professional presentation: Fine amounts, night counts, severity levels clearly labeled',
      '🎯 User-focused: Violation messages and recommended actions highlighted prominently',
    ],
  },
  {
    version: '2.11.0006',
    date: '2025-02-15',
    changes: [
      '🔧 FIXED: Data Cleanup & Recalculation now uses proper recalculation function',
      '📱 MOBILE-FRIENDLY: Redesigned with responsive layout for phones and tablets',
      '📊 HUMAN-READABLE: Progress reports now show clear, easy-to-understand metrics',
      '✅ Live background processing with realtime updates',
      '🎯 Clear completion dialog with comprehensive results breakdown',
      '💡 Helpful explanations for each cleanup phase',
      '⏱️ Shows processing duration and statistics in plain English',
      '📲 Touch-friendly buttons and checkboxes on mobile',
      '🔔 User-friendly notifications and status messages',
    ],
  },
  {
    version: '2.11.0005',
    date: '2025-02-15',
    changes: [
      '📱 MOBILE RESPONSIVENESS: All admin pages now fully mobile-optimized',
      '🚗 CANONICAL INTEGRATION: Flagged Vehicles + Homeless Support use canonical_vehicles',
      '✅ VehicleCard component with profile photos throughout',
      '✅ Enriched vehicle data (make/model/year/color from canonical records)',
      '📊 Analytics Hub: Clarified UX - requires "Load Analytics" button click',
      '🎯 Enforcement Hub: Already showing real breach data from canonical_vehicles',
      '📋 Incident Reports: Enhanced mobile layout with better spacing',
      '🔧 Fixed Flagged Vehicles: ALPR photo analysis + canonical enrichment',
      '🔧 Fixed Homeless Support: VehicleCard display + canonical enrichment',
      '📱 Responsive grids: Stack on mobile, multi-column on tablets/desktop',
      '🖼️ Profile photos: Show across all vehicle displays',
    ],
  },
  {
    version: '2.11.0004',
    date: '2025-02-15',
    changes: [
      '🧹 ADMIN PORTAL CLEANUP: Removed all redundant menu items',
      '❌ Removed duplicate "Switch to Field Portal" buttons (was 4x)',
      '❌ Removed "Cross-Org View" (functionality covered by universal filters)',
      '❌ Removed "Organization" label - now "Organization Overview"',
      '❌ Removed "Special Vehicles" - renamed to "Flagged Vehicles" for clarity',
      '❌ Removed "Vehicle Records" from Analytics (duplicated in Data Management Hub)',
      '❌ Removed entire MAINTENANCE section for regular users',
      '📋 CLARIFICATION: "Data Cleanup & Recalculation" (Data Management Hub) ≠ standalone "Recalculation"',
      '✅ Data Cleanup = comprehensive 3-phase pipeline (zone correction + duplicate removal + compliance recalculation)',
      '✅ Standalone Recalculation = compliance recalculation only (removed from menu)',
      '🎯 Streamlined menu: 12 items (down from 25+) with clearer organization',
      '📱 Better mobile experience with reduced navigation clutter',
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
