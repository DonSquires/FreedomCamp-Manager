/**
 * App Version Tracking
 * Format: MAJOR.MINOR.PATCH
 * - MAJOR (first digit): Significant backend changes
 * - MINOR (second digit): Frontend changes
 * - PATCH (third digit): Minor amendments
 */

export const APP_VERSION = '2.13.0001';

export const VERSION_HISTORY = [
  {
    version: '2.13.0001',
    date: '2026-02-16',
    changes: [
      '🔧 CRITICAL FIX: Urgent Follow Ups page now uses correct new schema tables',
      '✅ Updated to query canonical_vehicles instead of deprecated vehicle_records',
      '✅ Fixed observations query to use vehicle_observations_v2',
      '✅ Fixed homeless claims query to use canonical_vehicles.homeless_status',
      '✅ Updated enforcement action creation to work with new schema',
      '✅ Updated homeless confirmation to only update canonical_vehicles',
      '📊 Flagged vehicles now properly display in Observations tab',
      '🏠 Homeless claims now properly display in Homeless tab',
      '🚨 No more "Failed to load urgent follow ups" error',
    ],
  },
  {
    version: '2.13.0000',
    date: '2026-02-16',
    changes: [
      '🚨 CRITICAL LEGAL COMPLIANCE UPDATE',
      '📍 GLOBAL GPS TRACKING: Continuous location tracking across all app modes',
      '🗺️ AUTO ZONE DETECTION: GPS geofencing automatically detects current zone',
      '✅ AUTO PATROL MANAGEMENT: Patrols auto-start/stop when entering/exiting zones',
      '💧 PHOTO WATERMARKING: All photos stamped with GPS, date, time, officer info',
      '👁️ LIVE ADMIN TRACKING: Admins see real-time officer location and activity',
      '📊 ACTIVITY STREAM: Real-time feed of all field officer actions',
      '⚖️ COURT-READY EVIDENCE: Photos have visible watermark + metadata for legal use',
      '🔒 CHAIN OF CUSTODY: Full audit trail for all evidence collection',
      '📡 REAL-TIME SYNC: Admin portal shows live field operations',
    ],
  },
  {
    version: '2.12.0016',
    date: '2026-02-16',
    changes: [
      '🔧 CRITICAL FIX: GPS location now properly sent during Zoom Scan captures',
      '✅ Scans will now save actual GPS coordinates to database',
      '📍 Zone correction can now properly reassign based on real GPS location',
      '⚠️ Previous scans without GPS cannot be corrected - only new scans will work',
    ],
  },
  {
    version: '2.12.0015',
    date: '2026-02-16',
    changes: [
      '🗺️ ENHANCED: Zone Correction now uses strict GPS geofence matching',
      '✅ Observations outside all geofences moved to "Other Location" zone',
      '🎯 Auto-creates "Other Location" zone per organization if needed',
      '📊 Reports count of observations moved to Other Location',
      '🔍 Improved accuracy: Polygon geofences checked first, then point+radius',
      '⚠️ Excludes "Other Location" zone from geofence matching logic',
    ],
  },
  {
    version: '2.12.0014',
    date: '2026-02-16',
    changes: [
      '📱 FULLSCREEN: Auto-enters fullscreen on login for immersive experience',
      '💾 PERSISTENT: Fullscreen preference saved and restored across sessions',
      '🧭 NAVIGATION: Added back/forward browser navigation buttons to header',
      '⚙️ SETTINGS: Fullscreen toggle added to Settings with live status display',
      '🎯 UX: Fullscreen button in header for quick access',
      '✅ All display settings now "stick" when user logs out',
    ],
  },
  {
    version: '2.12.0013',
    date: '2026-02-16',
    changes: [
      '🎨 IMPROVED: Zone info header repositioned to top-left corner',
      '✨ Reduced opacity to 50% for better camera visibility',
      '🔦 No longer blocks torch button on right side',
      '📱 Cleaner, less obtrusive camera overlay',
    ],
  },
  {
    version: '2.12.0012',
    date: '2026-02-16',
    changes: [
      '🔧 CRITICAL FIX: Zoom Scan blank screen resolved - missing icon imports',
      '✅ Added MapPin and Clock imports for zone info header',
      '✅ Camera now loads properly with zone location and time display',
    ],
  },
  {
    version: '2.12.0011',
    date: '2026-02-16',
    changes: [
      '🔧 CACHE REFRESH: Force browser reload to apply welfare monitoring fixes',
      '✅ Confirmed async/await patterns for all Supabase RPC calls',
      '✅ No more .catch() errors in GPS tracking',
      '🔄 Version bump to clear cached JavaScript',
      '📱 All welfare monitoring functions now use proper error handling',
    ],
  },
  {
    version: '2.12.0010',
    date: '2026-02-16',
    changes: [
      '🔧 CRITICAL FIX: Resolved Supabase RPC .catch() error in welfare monitoring',
      '✅ Changed from .catch() to .then() pattern for proper error handling',
      '✅ GPS activity logging now works correctly without console errors',
      '✅ Online/offline status tracking fixed',
      '📱 Improved error messages and user feedback for GPS failures',
    ],
  },
  {
    version: '2.12.0009',
    date: '2026-02-16',
    changes: [
      '🔧 CRITICAL FIX: Zoom scan camera no longer loops/re-initializes',
      '✅ Camera stream now initializes once and stays active',
      '✅ Zoom slider changes apply smoothly without restarting camera',
      '🎥 Eliminated camera flicker and performance issues',
      '⚡ Separated camera initialization from zoom control logic',
    ],
  },
  {
    version: '2.12.0008',
    date: '2026-02-16',
    changes: [
      '📱 ENHANCED: History records now fully editable with full-screen review',
      '✅ Tap any scan in history to view complete details in modal',
      '🔍 Full-screen view shows vehicle info, status, zone, timestamp',
      '✏️ Edit button opens VehicleEditDrawer for quick modifications',
      '🗑️ Delete button with confirmation dialog for removing scans',
      '⏱️ Visual timer shows hours remaining in 24-hour edit window',
      '🔒 Records automatically lock after 24 hours with visual indicator',
      '🎨 Color-coded cards: Flagged (red), Breach (amber), Homeless (cyan), Compliant (green)',
      '🏷️ Status badges and icons for quick identification',
      '📊 Clean, professional presentation of scan history',
    ],
  },
  {
    version: '2.12.0007',
    date: '2026-02-16',
    changes: [
      '🔧 FIXED: Zoom Scan blank screen - camera now initializes properly',
      '✅ Added loading state with spinner while camera starts',
      '❌ Added error handling with retry and exit options',
      '🎥 Better camera permission prompts and feedback',
      '📱 Console logging for debugging camera issues',
      '⚡ Improved camera cleanup on unmount',
    ],
  },
  {
    version: '2.12.0006',
    date: '2026-02-16',
    changes: [
      '📱 ENHANCED: History records now fully editable with full-screen review',
      '✏️ NEW: Tap any scan in history to view complete details',
      '🔍 FULL-SCREEN: Modal shows all vehicle info, status, and timestamp',
      '✅ EDIT BUTTON: Quickly edit scan details within 24-hour window',
      '🗑️ DELETE BUTTON: Remove incorrect scans with confirmation dialog',
      '⏱️ VISUAL TIMER: Shows hours remaining for edit/delete (24h window)',
      '🔒 AUTO-LOCK: Records become read-only after 24 hours',
      '🎨 COLOR-CODED: Flagged (red), breach (amber), homeless (cyan), compliant (green)',
      '📊 STATUS ICONS: Visual indicators for quick scan identification',
    ],
  },
  {
    version: '2.12.0005',
    date: '2026-02-16',
    changes: [
      '🔧 FIXED: Scan history now loads from database - no more "No scans yet"',
      '📊 Recent scans automatically pull from last 24 hours of observations',
      '📍 NEW: Zone location displayed at top of zoom scan camera',
      '🕒 NEW: Current date and time shown on zoom scan screen',
      '🎨 IMPROVED: Zoom slider now 50% opaque for better visibility',
      '✅ Scans persist properly and appear immediately in history tab',
      '🔄 Auto-refresh every 30 seconds keeps history up to date',
    ],
  },
  {
    version: '2.12.0004',
    date: '2026-02-16',
    changes: [
      '🔍 ENHANCED: Queue notifications now clickable - tap to view full breach details',
      '📋 Full-screen detail modal shows complete compliance information',
      '⚠️ Clearer breach explanations with specific violation details',
      '💡 Officer guidance section with actionable next steps',
      '🎯 Visual distinction between BREACH (red) and AT RISK (yellow) items',
      '✅ Timestamp display shows when issue was detected',
      '📱 Touch-optimized cards with hover/active states for better mobile UX',
    ],
  },
  {
    version: '2.12.0003',
    date: '2026-02-16',
    changes: [
      '🔒 FIXED: Removed non-functional Evidence button from field officer queue',
      '✅ SIMPLIFIED: Flagged vehicle alerts now just require acknowledgement',
      '🚀 Officer can continue scanning immediately after acknowledging safety alert',
      '📋 Flagged alerts remain in queue for reference after acknowledgement',
      '⚠️ Clearer safety notice explaining officer precautions',
    ],
  },
  {
    version: '2.12.0002',
    date: '2026-02-16',
    changes: [
      '🔦 NEW: Torch/Flashlight control on Zoom Scan screen',
      '💡 Illuminate license plates in low-light conditions',
      '✨ Visual feedback - torch button glows yellow when active',
      '📱 Automatic detection of torch capability on device',
      '🎯 Positioned in top-right corner for easy access',
    ],
  },
  {
    version: '2.12.0001',
    date: '2026-02-16',
    changes: [
      '✅ NEW: Manual "Check for Updates" button in Field Officer Portal Settings',
      '🔄 Officers can now manually check for updates without logging out',
      '📱 Toast notification shows current version if already up to date',
      '⚡ Improved update detection skips dismissed versions on auto-check',
      '🎯 Manual checks always show update dialog even if previously dismissed',
    ],
  },
  {
    version: '2.12.0000',
    date: '2026-02-16',
    changes: [
      '🚗 NEW: MotorWeb Vehicle Enrichment - Enrich canonical records with NZ Vehicle Registry data',
      '✅ Vehicle Evidence Report now includes "Enrich from MotorWeb" button',
      '📊 Auto-fills make, model, year, color, owner details from authoritative registry',
      '🔍 Improved evidence quality for court-ready infringement reports',
      '🎯 Railway proxy updated to support both NZSCV and MotorWeb APIs',
      '📸 ENHANCED: Zoom Scan Queue with vertical zoom slider (1.0x - 5.0x)',
      '✅ Touch-optimized zoom controls - slide up to zoom in, down to zoom out',
      '📱 Larger touch targets and better visual feedback on mobile',
      '⚡ Photo capture animation - fancy slide-left effect confirms image captured',
      '🔒 FIXED: Safety alerts now show full-screen modal requiring acknowledgement',
      '💬 FIXED: "Advise Owner" button now works for flagged vehicles',
      '📸 FIXED: "Evidence" button now navigates to Vehicle Evidence Report',
      '🎨 Improved UI/UX with larger capture button and clearer status indicators',
      '💾 Zoom level persists in localStorage across sessions',
    ],
  },
  {
    version: '2.11.0019',
    date: '2026-02-15',
    changes: [
      '🔒 RESTRICTED: Bug Reports Management now ONLY accessible to Master users',
      '✅ All roles (Officer, Admin_Officer, Admin, Master) can submit bug reports',
      '❌ Admins and Admin_Officers CANNOT view or resolve reports',
      '✅ ONLY Masters can view all reports and update status/resolution',
      '🔐 Database RLS policies updated - masters-only for view/update/delete',
      '🎯 Clear access denied message if non-master tries to access reports page',
      '📊 Simplified workflow: Everyone reports, only Masters manage',
    ],
  },
  {
    version: '2.11.0017',
    date: '2026-02-15',
    changes: [
      '🔒 RESTRICTED: Bug Reporting System now only visible to Master users',
      '✅ Report Issue button only shows for super admins (master role)',
      '🔐 Database policy updated - only masters can create bug reports',
      '🎯 Prevents regular users/officers from cluttering issue queue',
      '👥 Bug Reports Management still accessible to admins (view only)',
    ],
  },
  {
    version: '2.11.0016',
    date: '2026-02-15',
    changes: [
      '🐛 NEW: Bug/Issue Reporting System - Users can report bugs directly from app',
      '✅ Floating "Report Issue" button accessible from any page',
      '📋 Categorized reporting: Bugs, Feature Requests, Enhancements, Performance, UI/UX, Data Issues',
      '📸 Screenshot attachments (up to 5) with preview before submission',
      '🤖 Auto-captures system context: version, device, browser, page, network status',
      '⚡ Console error logging for technical debugging',
      '📊 Admin portal: Bug Reports Management page with filtering and status tracking',
      '🎯 Severity levels: Critical, High, Medium, Low',
      '✅ Status workflow: Submitted → Acknowledged → Investigating → In Progress → Resolved',
      '👥 User notifications when reports are updated',
      '📈 Statistics dashboard: Total reports, new, in progress, resolved, critical open',
      '🔍 Advanced filtering: Search, status, type, severity',
      '💬 Resolution notes and tracking',
      '🔔 Admin notifications for new reports',
    ],
  },
  {
    version: '2.11.0015',
    date: '2026-02-15',
    changes: [
      '🔄 NEW: Update Manager - Checks for updates on login',
      '✅ Prominent update dialog with version comparison and changelog',
      '⬅️ Rollback capability - Revert to previous version if issues occur',
      '📊 Version history tracking - Up to 5 previous versions stored',
      '🔔 Update notifications can be dismissed (won\'t show again for that version)',
      '⚡ Automatic logout and app restart during updates',
      '🛡️ Safety first: Rollback button appears if previous version available',
      '📝 Full changelog display for each update',
      '🎯 Smart version comparison prevents unnecessary prompts',
    ],
  },
  {
    version: '2.11.0014',
    date: '2026-02-15',
    changes: [
      '🔒 CRITICAL SECURITY FIX: Portal Selection restricted to admin_officer role only',
      '✅ Officers now automatically routed to Field Officer portal',
      '✅ Admins/Masters now automatically routed to Admin portal',
      '✅ Only admin_officer users see portal selection choice',
      '🚫 Prevented unauthorized portal access by role-based routing',
      '🎯 App.tsx now enforces role-based navigation on login',
      '🔐 PortalSelection.tsx validates user role before rendering',
      '⚡ Automatic redirect if wrong role tries to access portal selection',
    ],
  },
  {
    version: '2.11.0013',
    date: '2026-02-15',
    changes: [
      '📱 MOBILE OPTIMIZATION: Portal Selection page fully mobile-friendly',
      '✅ Responsive logo sizing (lg on mobile, xl on desktop)',
      '✅ Adaptive text sizes (smaller on mobile, larger on desktop)',
      '✅ Compact padding on mobile (p-4 vs p-8 on desktop)',
      '✅ Smaller icons on mobile (h-12 vs h-16 on desktop)',
      '✅ Reduced spacing between elements on mobile',
      '✅ Added overflow-y-auto for scrollability',
      '✅ Proper text wrapping with leading-tight and leading-snug',
      '📲 Touch-friendly button sizes maintained',
      '🎯 All content now fits perfectly on mobile screens',
    ],
  },
  {
    version: '2.11.0012',
    date: '2026-02-15',
    changes: [
      '🎯 COMPLETE REDESIGN: Separated login from portal selection',
      '✅ New PortalSelection landing page - shows AFTER successful login',
      '✅ Login.tsx simplified - just authenticates, no portal logic',
      '✅ App.tsx uses React Router - proper route-based navigation',
      '✅ Clean flow: Login → Portal Selection → Admin or Field Portal',
      '✅ Works for ALL roles - no special cases needed',
      '🔧 Added BrowserRouter to main.tsx for routing support',
      '📱 Portal selection page is mobile-responsive',
      '🎨 Beautiful landing page with large portal buttons',
    ],
  },
  {
    version: '2.11.0011',
    date: '2026-02-15',
    changes: [
      '🐛 CRITICAL FIX: Resolved dual role login flow',
      '✅ admin_officer role now properly recognized in App.tsx routing',
      '✅ Portal selection happens BEFORE setting auth state (prevents premature redirect)',
      '✅ Pending login data stored temporarily during portal selection',
      '✅ Auth state only set after user chooses portal',
      '✅ App.tsx now routes admin_officer based on selected_portal localStorage',
      '🔧 Fixed "Unknown Role" error for admin_officer users',
      '🎯 Smooth portal selection flow: Login → Select Portal → Navigate',
    ],
  },
  {
    version: '2.11.0010',
    date: '2026-02-15',
    changes: [
      '🐛 HOTFIX: Fixed React Fragment syntax error in Login page',
      '✅ App now loads correctly after dual role implementation',
    ],
  },
  {
    version: '2.11.0009',
    date: '2026-02-15',
    changes: [
      '🔐 NEW ROLE: Admin & Field Officer - dual access to both portals',
      '✅ Portal selection dialog for dual-role users at login',
      '🚫 Self-approval prevention: admins cannot approve their own field observations',
      '📋 Compliance Display Fix: Shows "Breach (Exempt)" for homeless vehicles',
      '🏠 Homeless status now prominently displayed with breach details',
      '💡 Exemption notice: "Freedom Camping Act - Confirmed Homeless" shown clearly',
      '✅ User name changes automatically reflect throughout entire system',
      '🔒 24-hour edit window for field officers (including admin_officers)',
      '⚠️ Portal tracking: observations tagged with portal used to create them',
      '🎯 Role-based navigation: automatic redirect based on role after login',
    ],
  },
  {
    version: '2.11.0008',
    date: '2025-02-15',
    changes: [
      '🐛 CRITICAL FIX: Analytics Hub infinite loading loop resolved',
      '✅ Changed initial loading state from true to false',
      '✅ Analytics now shows "Load Analytics" button immediately',
      '🔧 Data Cleanup: Added Cancel button to stop background processing',
      '🔧 Data Cleanup: Added Refresh Status button to manually update progress',
      '🎯 Users can now interrupt long-running recalculations',
      '📊 Manual status refresh shows exact current progress without waiting',
      '⚡ Improved user control during data operations',
    ],
  },
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
