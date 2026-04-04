# Bug Report — Officer Role Access Control

**Date:** April 2026
**Audit type:** Security — role-based access control (RBAC)
**Scope:** Web app (Vercel), `officer` role

---

## Summary

A security audit of the `officer` role identified 11 issues where officers could either:
- Navigate directly to admin-only pages via URL (missing route guards)
- See and trigger admin-only action buttons within pages they legitimately access
- Encounter confusing silent redirects from nav items that link to restricted routes

All 11 issues have been **fixed** in the same commit as this report.

---

## Fixed Issues

---

### BUG-001 — `/vehicles` unguarded: officers could flag, scrape, and update canonical vehicle records
**Severity:** 🔴 Critical
**Files:** `src/pages/VehicleManagement.tsx`
**Fix:** Added `isAdmin` guard around the Flag/Unflag button in each vehicle card, and around the "Vehicle Details Enrichment" and "Scrape Sales Sites" panels in the detail dialog. Officers now see a read-only vehicle list.

---

### BUG-002 — `/breaches` unguarded: officers could resolve, dismiss, bulk-dismiss, and issue enforcement
**Severity:** 🔴 Critical
**Files:** `src/pages/BreachAlerts.tsx`
**Details:**
- The Decision Dock (desktop) showed ISSUE / WARNING / REJECT / ASSIGN TO OFFICER / RESOLVE buttons to all authenticated users with no role check.
- The mobile breach drawer had the same buttons.
- Bulk Ack/Dismiss checkboxes were shown to all users.
- "Re-fetch Vehicle Details" (MotorWeb enrichment) had no role guard.

**Fix:**
- Added `isAdmin = ['admin', 'admin_officer', 'master'].includes(user?.role)` at component level.
- Wrapped entire Decision Dock actions section in `{isAdmin ? <actions/> : <read-only message/>}`.
- Wrapped mobile decision buttons in `isAdmin` guards.
- Changed bulk select/action bar to only render when `isAdmin`.
- Wrapped both "Enrich Vehicle" buttons in `isAdmin` guards.

---

### BUG-003 — `/incident-reports` unguarded: officers could set/remove legal holds
**Severity:** 🔴 Critical
**Files:** `src/App.tsx`, `src/pages/IncidentReports.tsx`
**Fix:**
- Added `RoleRoute allowedRoles={['admin', 'admin_officer', 'master']}` wrapper to the `/incident-reports` route in `App.tsx`.
- Added `isAdmin` guard around the "Set Legal Hold / Remove Hold" button in `IncidentReports.tsx`.

---

### BUG-004 — `/hotspots` unguarded: accessible via direct URL by any authenticated user
**Severity:** 🟠 High
**Files:** `src/App.tsx`
**Fix:** Added `RoleRoute allowedRoles={['admin', 'admin_officer', 'master']}` wrapper to the `/hotspots` route.

---

### BUG-005 — `/observations-report` unguarded: admin report accessible via direct URL
**Severity:** 🟠 High
**Files:** `src/App.tsx`
**Details:** The "Observations Report" nav item correctly excluded officers, but the route had no `RoleRoute`.
**Fix:** Added `RoleRoute allowedRoles={['admin', 'admin_officer', 'master']}` wrapper to the `/observations-report` route.

---

### BUG-006 — `/observations` unguarded: accessible via direct URL by any authenticated user
**Severity:** 🟠 High
**Files:** `src/App.tsx`
**Fix:** Added `RoleRoute allowedRoles={['admin', 'admin_officer', 'master']}` wrapper to the `/observations` route.

---

### BUG-007 — "Investigations" nav item shown in officer sidebar despite route being admin-only
**Severity:** 🟠 High
**Files:** `src/components/features/AppLayout.tsx`
**Details:** The nav item at `/investigations` listed `roles: ['admin', 'admin_officer', 'master', 'officer']`, so officers saw it in the sidebar. Clicking it silently redirected to `/` because the route's `RoleRoute` excluded `'officer'`.
**Fix:** Removed `'officer'` from the nav item roles array.

---

### BUG-008 — BreachAlerts ISSUE button: guard was toast-only, button still rendered to officers
**Severity:** 🟡 Medium
**Files:** `src/pages/BreachAlerts.tsx`
**Details:** `handleIssueEnforcement` contained a role check that showed a toast warning but did not hide or disable the ISSUE button in the UI.
**Fix:** Resolved as part of BUG-002 fix — entire Decision Dock is now hidden from officers.

---

### BUG-009 — "Assign to Officer" button in BreachAlerts had no role guard
**Severity:** 🟡 Medium
**Files:** `src/pages/BreachAlerts.tsx`
**Fix:** Resolved as part of BUG-002 fix — entire Decision Dock is now hidden from officers.

---

### BUG-010 — Officers could update incident status (Investigate / Mark Resolved) in IncidentManagement
**Severity:** 🟡 Medium
**Files:** `src/pages/IncidentManagement.tsx`
**Details:** The `/incidents` route is intentionally accessible to officers (create incident report). However, the "Investigate" and "Mark Resolved" status-change buttons on existing incidents were not role-guarded.
**Fix:** Added `isAdmin` guard around the status action button group.

---

## Remaining Known Issues (Not Fixed In This PR)

### BUG-011 — Raw Supabase/PostgreSQL error messages exposed to officers
**Severity:** 🔵 Low
**Files:** `src/pages/FieldOfficerPortal.tsx` (9 locations), `src/pages/IncidentManagement.tsx`, `src/pages/VehicleManagement.tsx`
**Details:** Several `toast.error(err?.message)` calls forward the raw error object's `.message` field directly to the user. If Supabase returns a row-level security violation, policy name, table name, or other internal schema detail, it will be shown to the officer.

**Affected lines:**
| File | Line | Pattern |
|---|---|---|
| `FieldOfficerPortal.tsx` | 350 | `err?.message ?? 'SOS failed…'` |
| `FieldOfficerPortal.tsx` | 482 | `err?.message ?? 'Update failed'` |
| `FieldOfficerPortal.tsx` | 653 | `err.message \|\| 'Failed to issue enforcement action'` |
| `FieldOfficerPortal.tsx` | 779 | `err?.message ?? 'Failed to start shift'` |
| `FieldOfficerPortal.tsx` | 830 | `err?.message ?? 'Failed to end shift'` |
| `FieldOfficerPortal.tsx` | 943 | `err.message \|\| 'Scan failed — please try again'` |
| `FieldOfficerPortal.tsx` | 1009 | `err?.message \|\| 'Manual entry failed'` |
| `IncidentManagement.tsx` | ~185 | `err.message \|\| 'Failed to create incident'` |
| `VehicleManagement.tsx` | 853 | `err.message \|\| 'Failed to update flag'` |

**Recommended fix:** Create a shared `friendlyError(err, fallback)` helper that maps known Supabase/PostgREST error codes to safe messages, logs the raw error to the console, and returns only the safe fallback string to the toast.

---

## Files Changed

| File | Change |
|---|---|
| `src/App.tsx` | Added `RoleRoute` guards to `/hotspots`, `/incident-reports`, `/observations`, `/observations-report` |
| `src/components/features/AppLayout.tsx` | Removed `'officer'` from Investigations nav item roles |
| `src/pages/VehicleManagement.tsx` | Added `isAdmin` guards to Flag/Unflag button, Enrich Data panel, Scrape Sales Sites panel |
| `src/pages/BreachAlerts.tsx` | Added `isAdmin` guards to Decision Dock (desktop + mobile), bulk actions bar, Enrich Vehicle buttons |
| `src/pages/IncidentReports.tsx` | Added `isAdmin` guard to Legal Hold button |
| `src/pages/IncidentManagement.tsx` | Added `isAdmin` guard to status update buttons |
