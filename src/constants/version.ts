export const APP_VERSION = 'v5.1.1';
export const BUILD_DATE = '2026-02-18';
export const RELEASE_NOTES = `
## Version 5.1.1 - RLS & Dashboard Fixes

### 🔧 Critical RLS Fixes (Priority 1)
- Created RLS helper functions migration (BLOCKER FIX)
  - get_user_role(uuid) - Returns user role without RLS recursion
  - get_user_organization_id(uuid) - Returns primary organization
  - Enhanced get_user_organization_ids() - All accessible orgs
- All 17+ RLS policies now functional
- Prevents "function does not exist" errors

### 🏢 Organization Triggers (Priority 2)
- Auto-calculate organization_level based on parent hierarchy
- Prevent circular parent-child references
- Auto-update levels when parent changes
- Backfill existing organization levels

### 🔐 User Deactivation Queue (Priority 3)
- Deactivation queue system for proper auth.users disabling
- Edge Function integration ready
- Preserves audit trail while preventing login
- Reactivation support

### 📊 Dashboard RLS Trust (Priority 4)
- Removed manual organization filtering from Unified Dashboard
- Now trusts RLS policies for multi-org access
- Correctly shows data from:
  - Primary organization
  - Authorized work locations
  - Descendant organizations (for admins)
- Master users can still filter by specific org

### 📋 Documentation
- ORGANIZATION_USER_MANAGEMENT_VERIFICATION.md - Complete audit
- All 3 SQL migrations ready to deploy
- Implementation checklist with priority order
- Test scenarios for verification

### ⚡ Next Steps
1. Apply SQL migrations in Supabase (URGENT)
2. Test multi-organization access
3. Verify RLS policies work correctly
4. Optional: Implement enforcement workflow logic
`;

// Version history for update manager
export interface VersionHistoryEntry {
  version: string;
  date: string;
  changes: string[];
}

export const VERSION_HISTORY: VersionHistoryEntry[] = [
  {
    version: 'v5.1.1',
    date: '2026-02-18',
    changes: [
      'CRITICAL: Created RLS helper functions migration (fixes BLOCKER)',
      'Created organization triggers migration (auto-level, circular check)',
      'Created user deactivation queue migration',
      'Fixed manual org filtering in Unified Dashboard (now trusts RLS)',
      'Complete verification report with test scenarios',
      'Ready for SQL deployment to fix all RLS issues',
    ],
  },
  {
    version: 'v5.1.0',
    date: '2026-02-18',
    changes: [
      'Complete hierarchical organization management system',
      'Three-tier user-organization relationship model',
      'Enforcement workflow configuration per organization',
      'User invitation system with automatic email',
      'Multi-organization access for officers',
      'Comprehensive workflow documentation',
    ],
  },
  {
    version: 'v5.0.0',
    date: '2026-02-15',
    changes: [
      'Unified BI Dashboard consolidating 3 dashboards',
      'Three-level drill-down: Overview → Zone → Vehicle',
      'Real-time compliance monitoring with breach detection',
      'Advanced analytics with trends and officer leaderboards',
      'CSV/PDF export with photos and detailed breakdowns',
    ],
  },
  {
    version: 'v4.9.0',
    date: '2026-02-10',
    changes: [
      'Enhanced compliance recalculation system',
      'Automatic zone detection and correction',
      'Comprehensive data integrity checks',
      'Bug reporting system with AI analysis',
      'Database maintenance and recovery tools',
    ],
  },
  {
    version: 'v4.8.0',
    date: '2026-02-05',
    changes: [
      'Officer welfare monitoring system',
      'Live GPS tracking with inactivity alerts',
      'Investigation job management',
      'Enhanced incident reporting with court-ready features',
      'Breach alert workflow improvements',
    ],
  },
  {
    version: 'v4.7.0',
    date: '2026-01-28',
    changes: [
      'Homeless exemption system per Freedom Camping Act',
      'NZ timezone standardization',
      'Data architecture consolidation',
      'Enhanced compliance credentials upload',
      'Streamlined reporting system',
    ],
  },
];

// Compare two semantic versions (e.g., "v5.1.0" vs "v5.0.0")
// Returns: 1 if v1 > v2, -1 if v1 < v2, 0 if equal
export function compareVersions(v1: string, v2: string): number {
  // Remove 'v' prefix if present
  const cleanV1 = v1.replace(/^v/, '');
  const cleanV2 = v2.replace(/^v/, '');

  const parts1 = cleanV1.split('.').map(Number);
  const parts2 = cleanV2.split('.').map(Number);

  for (let i = 0; i < Math.max(parts1.length, parts2.length); i++) {
    const part1 = parts1[i] || 0;
    const part2 = parts2[i] || 0;

    if (part1 > part2) return 1;
    if (part1 < part2) return -1;
  }

  return 0;
}
