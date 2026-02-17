export const APP_VERSION = 'v5.1.0';
export const BUILD_DATE = '2026-02-18';
export const RELEASE_NOTES = `
## Version 5.1.0 - Organization & User Management Overhaul

### 🏢 Organization Management (Master Only)
- Complete hierarchical organization tree view
- Visual parent-child relationships with expand/collapse
- Enforcement workflow configuration per organization
- User and zone count tracking per organization
- CRUD operations with cascade validation
- Organization type classification (Security Company, Client, Contractor)

### 👥 User Management Complete Rebuild
- Fixed "multiple foreign key" error with explicit FK selection
- Three-tier organization relationship support:
  - Primary Organization: User's base organization
  - Employer Organization: Security company employing the user
  - Authorized Work Locations: Multi-org access array
- Role-based access control with proper RLS filtering
- User invitation system via Edge Function
- Session management and multi-session prevention
- Deactivation (not deletion) to preserve audit trail

### 📋 Comprehensive Workflow Documentation
- ORGANIZATION_USER_MANAGEMENT_WORKFLOW.md created
- Complete business logic, RLS patterns, and integration points
- Enforcement workflow system (admin_first vs officer_first)
- Welfare monitoring integration with employer_organization_id
- Login flow, authorization checks, and portal routing

### 🔧 Technical Improvements
- Proper organization hierarchy with auto-level calculation
- Circular reference prevention triggers
- SECURITY DEFINER helper functions for RLS
- Multi-organization user access via authorized_work_locations[]
- Dual-role support (admin_officer) with portal selection

### 🔐 Security Enhancements
- Never delete users - always deactivate for audit compliance
- Cascade warnings before organization deactivation
- Proper session termination on new login
- RLS policies use helper functions to prevent recursion
- Permissions editor for granular access control

### ⚡ Performance & UX
- Hierarchical tree rendering with expand/collapse
- Real-time user/zone counts per organization
- Search and filter capabilities in User Management
- Responsive mobile-first design for both management pages
- Loading states and error handling throughout
`;

// Version history for update manager
export interface VersionHistoryEntry {
  version: string;
  date: string;
  changes: string[];
}

export const VERSION_HISTORY: VersionHistoryEntry[] = [
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
