/**
 * App Version Tracking
 * Format: MAJOR.MINOR.PATCH
 * - MAJOR (first digit): Significant backend changes
 * - MINOR (second digit): Frontend changes
 * - PATCH (third digit): Minor amendments
 */

export const APP_VERSION = '2.11.0005';

export const VERSION_HISTORY = [
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
