export const APP_VERSION = 'v5.2.0';
export const BUILD_DATE = '2026-02-19';
export const RELEASE_NOTES = `
## Version 5.2.0 - Unified ALPR System + Security Fixes

### 🎯 Unified Plate Scanner Architecture
- **Centralized ALPR Helper** (_shared/alpr.ts) - Single source of truth
- **Photo-First Ingest** - plate-scanner-photo-first handles both modes
- **Structured Breadcrumb Logging** - Full observability at each step
- **Immediate Response** - No 3-second compliance timeout (async evaluation)
- **Both Modes Unified** - Driving & Handheld use same ingest path

### 🔐 Critical Security Fixes
- **API Key Security** - Moved PLATE_RECOGNIZER_API_KEY to environment variables
- **No Hardcoded Secrets** - All API keys now in Supabase secrets
- **Backward Compatible** - recognize-plate updated but still functional

### 🛠️ UI State Management Fixes
- **Zone Detection** - Auto-detect with 5-second timeout + manual selector
- **Loading State Cleanup** - try/catch/finally guarantees spinner clears
- **Workflow Lock** - Camera disabled when popup/modal active (prevents race conditions)
- **Error Recovery** - Failed scans auto-open manual entry modal

### 📊 Payload Standardization
- **JSON Format** - Consistent shape across driving & handheld modes
- **Base64 Images** - Unified image encoding (no multipart/JSON mismatch)
- **Idempotency Keys** - Prevent duplicate submissions

### 📚 Comprehensive Documentation
- **README_REBUILD.md** - Complete rebuild documentation
- **Architecture Diagram** - Request flow and function responsibilities
- **Testing Checklist** - Acceptance criteria for both modes
- **Deployment Guide** - Environment variable setup + verification

### ⚡ Performance Improvements
- **No Blocking Waits** - Functions return immediately (compliance via trigger)
- **Background Processing** - ALPR runs async, camera never stops
- **Smart Caching** - Zone selection persisted across sessions

### 🔧 Bug Fixes
- Fixed infinite loading spinner (PlateScanner)
- Fixed "No Zone" blocking camera forever
- Fixed duplicate ALPR code across functions
- Fixed missing error handling in photo upload
- Fixed race condition in compliance evaluation

### 📝 Next Steps
1. Set PLATE_RECOGNIZER_API_KEY in Supabase Secrets (REQUIRED)
2. Test both Driving & Handheld modes with live scans
3. Verify breadcrumb logs in Edge Function dashboard
4. Monitor KPI tiles match drill-down counts
5. Enable FEATURE_INGEST_V2 for pilot officers
`;

// Version history for update manager
export interface VersionHistoryEntry {
  version: string;
  date: string;
  changes: string[];
}

export const VERSION_HISTORY: VersionHistoryEntry[] = [
  {
    version: 'v5.2.0',
    date: '2026-02-19',
    changes: [
      'Unified ALPR system with centralized helper (_shared/alpr.ts)',
      'Security fix: Moved API keys to environment variables (no hardcoded secrets)',
      'Photo-first ingest handles both Driving & Handheld modes',
      'Fixed infinite loading spinner in Plate Scanner',
      'Zone detection with 5-second timeout + manual selector fallback',
      'Structured breadcrumb logging for full observability',
      'try/catch/finally guarantees UI state cleanup',
      'Comprehensive documentation (README_REBUILD.md)',
    ],
  },
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
