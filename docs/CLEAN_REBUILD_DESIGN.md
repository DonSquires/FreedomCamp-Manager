# FreedomCamp Manager — Clean Rebuild Design & Sales Strategy

> **Purpose**: A candid assessment of what to keep, cut, and redesign in a clean rebuild.
> Covers simplified architecture, role-focused UX, a practical implementation plan, and
> sales messaging for councils and security companies.
>
> **Audience**: Don Squires (product owner), future developers, prospective clients.
>
> **Last updated**: 2026-04-24

---

## Table of Contents

1. [Honest Assessment: What We've Built](#1-honest-assessment-what-weve-built)
2. [The Clean Rebuild Philosophy](#2-the-clean-rebuild-philosophy)
3. [What to Keep, Cut, and Consolidate](#3-what-to-keep-cut-and-consolidate)
4. [Clean Schema (20 tables, not 40+)](#4-clean-schema-20-tables-not-40)
5. [Clean Edge Function Set (15, not 69)](#5-clean-edge-function-set-15-not-69)
6. [Role-by-Role UX Design](#6-role-by-role-ux-design)
7. [Clean Frontend Structure](#7-clean-frontend-structure)
8. [New Role: Grand Master (Platform Owner)](#8-new-role-grand-master-platform-owner)
9. [Step-by-Step Clean Rebuild Order](#9-step-by-step-clean-rebuild-order)
10. [Sales Strategy & Client Pitch](#10-sales-strategy--client-pitch)

---

## 1. Honest Assessment: What We've Built

The current app works. Officers can scan plates, admins can see breaches, and compliance
is calculated. But the codebase has accumulated significant complexity over 200+
migrations and 60+ edge functions:

### What accumulated over time

| Issue | Evidence | Impact |
|---|---|---|
| 3 compliance recalculation functions | `recalculate-compliance`, `-v2`, `-v3` | Maintenance burden; callers use wrong version |
| 60+ pages | Including `TestDashboard.tsx`, `CleanDashboard.tsx`, PHASE_*.md files | Confusing navigation; dead code in production |
| 69 edge functions | Many do overlapping work (ALPR, scan pipeline fragmented across 5+ functions) | Hard to debug, hard to onboard new devs |
| 200+ migrations | Some undo others, some add columns that are immediately populated by another | Schema is hard to understand from scratch |
| 5 user roles | officer, admin, admin_officer, master, nzscv_monitor | nzscv_monitor is barely used; admin_officer overlap is confusing |
| `flagged_vehicles` "deprecated then un-deprecated" | See BUILD_PLAN_V3.md §2.9 | Callers are confused about what table to use |
| `canonical_vehicles`, `canonical_scv`, `canonical_homeless` | Three separate tables for related vehicle data | Query complexity when you just want "is this vehicle SCV?" |
| Dead edge functions | `recalculate-compliance`, `recalculate-compliance-v2`, `alpr-retry`, `check-railway-health` | Deployed but never called |
| Developer-facing pages in production | `TestDashboard.tsx`, `CleanDashboard.tsx`, `DataCleanupUtility.tsx`, `SystemDiagnostics.tsx` | Clients see internal tooling |

### What works well and must be preserved

| Feature | Why it's good |
|---|---|
| Single scan flow | Officer taps scan → plate identified → compliance verdict in ~5 seconds |
| Offline queue | IndexedDB + `useOfflineQueue` is solid; field officers depend on this |
| Zone geofencing | GPS auto-detection with child zone priority is well-designed |
| Notice generation | PDF/HTML notice workflow is complete and legally sound |
| `calculate_vehicle_compliance_v3()` RPC | The compliance engine is accurate and versioned |
| `canonical_scv` table | Clean lookup; right design. Just needs to be the only source |
| RLS model | Org-scoped data isolation works correctly |
| Email templates | Branded and professional |

---

## 2. The Clean Rebuild Philosophy

> **One job, done perfectly. Nothing else.**

The app has one core job: **field officers scan plates → admins review breaches →
councils enforce freedom camping rules**. Everything else is supporting infrastructure.

### Guiding principles

1. **Every page serves a user, not a developer.** Remove debug pages, test dashboards,
   cleanup utilities. These belong in a separate internal admin tool or the Supabase
   Dashboard, not the production app.

2. **One function per job.** Three compliance recalculation functions means three places
   to update when the rules change. One function, versioned by the DB RPC.

3. **Mobile-first for officers, desktop-first for admins.** Currently both portals share
   the same component patterns. Officers need large tap targets, minimal reading, instant
   feedback. Admins need data density, filters, exports.

4. **Roles match real people.** Five roles is two too many. Real deployments have:
   officers who scan, admins who review, managers (master) who run the contract, and
   platform owners (grand master) who sell and support new clients.

5. **Schema tells a story.** A new developer should be able to read the 20 core tables
   and understand the entire system in an afternoon. Not 40+ tables with 200 migrations.

6. **Build for the sales pitch.** Every feature visible to a client demo should be
   polished. Internal tooling should be hidden or removed from the UI entirely.

---

## 3. What to Keep, Cut, and Consolidate

### 3.1 Edge Functions: Keep 15, Cut 54

| Keep | Purpose |
|---|---|
| `process-officer-scan` | Core scan pipeline (plate → compliance → breach) |
| `cleanup-and-recalculate` | Nightly batch correction + recompute |
| `generate-notice-to-vacate` | PDF notice generation |
| `generate-infringement` | Infringement notice PDF |
| `sync-scv-list` | SCV registry sync from NZSCV |
| `create-user` | User provisioning |
| `monitor-officer-welfare` | Welfare check-in scheduler |
| `send-report-email` | Email delivery for reports |
| `export-data` | Observations / reports export (consolidate `observations-export`) |
| `import-data` | Historical data import (consolidate `import-data` + `import-historical-data`) |
| `submit-dispute-intake` | Public dispute submission |
| `public-case-lookup` | Public notice lookup |
| `hotspot-data` | Hotspot heatmap data for admin |
| `process-homeless-data` | Homeless data import |
| `nightly-privacy-cleanup` | Privacy compliance cleanup |

| Cut / Consolidate | Why |
|---|---|
| `recalculate-compliance` | Dead — superseded by `-v3` |
| `recalculate-compliance-v2` | Dead — superseded by `-v3` |
| `recalculate-compliance-v3` | **Fold into `cleanup-and-recalculate`** (already called there) |
| `alpr-process` + `alpr-retry` + `orc-ingest` + `plate-scanner-photo-first` | **Consolidate into `process-officer-scan`** — these are all steps in the same scan pipeline |
| `scan-breaches` | **Fold into `cleanup-and-recalculate`** — breach detection runs as part of nightly cleanup |
| `check-nzscv-status` | **Fold into `process-officer-scan`** — SCV check is a step in the scan |
| `analyze-vehicle-photo` | **Fold into `process-officer-scan`** step 3 |
| `vehicle-ingest` | **Fold into `process-officer-scan`** — vehicle record creation is a scan step |
| `duplicate-detection` | **Fold into `cleanup-and-recalculate`** Phase 2 |
| `correct-zone-assignments` | **Fold into `cleanup-and-recalculate`** Phase 1 |
| `zone-correction` | **Fold into `cleanup-and-recalculate`** Phase 1 |
| `check-zone-corrections` | Dev/diagnostic tool — move to internal admin |
| `check-data-integrity` | Dev/diagnostic tool — move to internal admin |
| `check-railway-health` | Dev/diagnostic tool — remove from production |
| `check-almost-breaches` | **Fold into `cleanup-and-recalculate`** as overnight prediction phase |
| `get-compliance-statistics` | Frontend can query the DB directly via RPC |
| `observations-list` | Frontend queries Supabase directly |
| `observations-in-bounds` | Frontend queries Supabase directly with PostGIS |
| `generate-dashboard-report` | Consolidate into `send-report-email` |
| `generate-leadership-pack` | Consolidate into `send-report-email` |
| `generate-vehicle-report` | Consolidate into `send-report-email` |
| `generate-incident-pdf` | Consolidate into `generate-notice-to-vacate` |
| `admin-incident-ops` | Frontend can do this directly |
| `enrich-from-motorweb` | Fold into `cleanup-and-recalculate` vehicle enrichment step |
| `select-best-vehicle-photo` | Fold into `process-officer-scan` |
| `link-evidence-photos` | Fold into `process-officer-scan` |
| `photo-recovery` + `daily-photo-reconciler` + `reingest-photos` + `scrape-vehicle-photos` + `parkpow-photo-sync` + `parkpow-sync` | Consolidate into a single `photo-maintenance` scheduled job |
| `sync-spatial-layers` | Fold into `cleanup-and-recalculate` |
| `suggest-new-zone` | Remove — AI suggestion is not used |
| `test-compliance-matrix` | Dev tool — remove from production |
| `stream-webhook` | Fold into `process-officer-scan` (this is called by the stream) |
| `update-compliance-policy` | Frontend does this directly |
| `send-invite-email` | Use Supabase built-in invite |
| `send-push-notification` | Simplify to be part of `monitor-officer-welfare` |
| `set-user-password` + `update-user-password` | Consolidate into one `manage-user` function |
| `create_auth_and_profiles` | Merge into `create-user` |
| `upload-file` | Remove — frontend can upload direct to Supabase Storage |
| `onspace-ai-chat` | Phase 2 feature — remove from v1 clean rebuild |
| `process-credential-document` + `process-investigation-document` | Phase 2 — remove for now |

---

### 3.2 Database Tables: Keep 20, Cut 20+

#### Keep (core, actively used)

| Table | Purpose |
|---|---|
| `organizations` | Multi-tenancy anchor |
| `user_profiles` | User records with role |
| `zones` | Geofenced compliance areas |
| `zone_compliance_matrix` | Versioned compliance rules per zone |
| `zone_legal_config` | Payment, objections, and dispute portal per zone |
| `observations` | Core fact table — every plate scan |
| `breach_alerts` | Unresolved compliance breaches |
| `canonical_vehicles` | Vehicle attributes (make/model/year/colour) |
| `canonical_scv` | SCV certification per plate |
| `canonical_homeless` | Homeless status per plate |
| `infringement_notices` | Issued infringement notices |
| `notices_to_vacate` | Issued NTV documents |
| `patrols` | Patrol sessions |
| `patrol_schedule_zones` | Zones assigned to a patrol |
| `officer_shifts` | Shift start/end records |
| `audit_log` | Immutable action log |
| `dispute_intake` | Public dispute submissions |
| `person_records` | Known individuals linked to plates |
| `enforcement_cases` | Case management for repeat offenders |
| `privacy_access_log` | Privacy Act 2020 PII access log |

#### Cut or Merge

| Table | Disposition |
|---|---|
| `flagged_vehicles` | **Merge into `canonical_homeless`** — it's the same concept. Use `canonical_homeless.status = 'flagged'` |
| `homeless_records` | **Merge into `canonical_homeless`** — duplicates the concept |
| `vehicle_discrepancies` | Useful but niche — keep as opt-in phase-2 feature. Remove from initial clean build |
| `investigation_jobs` | Rarely used — phase-2 only |
| `incident_reports` (if separate) | Merge into `enforcement_cases` |
| `patrol_checkpoints` | Keep only if using lone-worker QR scan. Otherwise cut |
| `compliance_results` (if still exists) | Was replaced by columns on `observations` |
| `photo_records` (if separate) | Merge into `observations.photo_url` |
| PHASE_*.md files in src/pages | Not DB tables but dead files — delete |

---

### 3.3 Frontend Pages: Keep 18, Cut/Merge 40+

#### What to cut immediately

| Page | Reason |
|---|---|
| `TestDashboard.tsx` | Developer tool |
| `CleanDashboard.tsx` | Prototype replaced by `AdminPortal` |
| `DataCleanupUtility.tsx` | Internal admin tool, not for clients |
| `DataIntegrityDashboard.tsx` | Internal admin tool |
| `SystemDiagnostics.tsx` | Internal admin tool |
| `CleanupAndRecalculate.tsx` | Exposes internal DB operations to admins |
| `ComplianceRecalculation.tsx` | Developer/debug page |
| `PhotoReingest.tsx` | Internal tool |
| `EvidencePhotoLinker.tsx` | Internal tool |
| `PHASE_3_COMPLETE.md` etc. | Development notes, not pages |

#### What to merge

| Pages | Merge into |
|---|---|
| `ComplianceDashboard` + `ComplianceAnalytics` + `CompliancePage` | One `Compliance.tsx` page with tabs |
| `VehicleManagement` + `VehicleRegistry` + `VehicleDetailPage` | `Vehicles.tsx` with drill-down |
| `ObservationRecords` + `ObservationsReport` + `ObservationsView` | `Observations.tsx` with filters |
| `LivePatrolMonitor` + `LiveOfficerTracking` | `LiveMap.tsx` |
| `BreachAlerts` + `BreachNotices` | `Breaches.tsx` with alert/notice tabs |
| `EnforcementCommandCenter` + `EnforcementActions` + `EnforcementReview` | `Enforcement.tsx` with workflow tabs |
| `ReportsHub` + `Reports` + `IncidentReports` | `Reports.tsx` |
| `DataManagement` + `DataManagementHub` + `ImportData` + `ImportHistoricalData` | `DataImport.tsx` |
| `PatrolScheduleManagement` + `PatrolKPIDashboard` | `Patrols.tsx` with schedule/KPI tabs |

---

## 4. Clean Schema (20 tables, not 40+)

### Entity-Relationship Summary

```
organizations
  └── user_profiles (role: officer | admin | master | grand_master)
  └── zones
        └── zone_compliance_matrix
        └── zone_legal_config
        └── patrols
              └── patrol_schedule_zones
  └── observations (plate_number, zone_id, officer_id, photo_url, is_compliant)
        └── breach_alerts
        └── infringement_notices
        └── notices_to_vacate
  └── enforcement_cases
        └── dispute_intake

canonical_vehicles  (plate-level, cross-org, make/model/year/colour)
canonical_scv       (plate-level, SCV certification)
canonical_homeless  (plate-level, homeless/flagged status — replaces flagged_vehicles + homeless_records)

officer_shifts      (shift start/end, GPS)
patrol_checkpoints  (QR lone-worker check-ins) [optional]
person_records      (individuals linked to plates)
audit_log           (immutable)
privacy_access_log  (PII access)
```

### One Migration File

A clean rebuild starts from a **single** `001_initial_schema.sql` file that creates all
20 tables with correct indexes, RLS policies, triggers, and RPCs. No migration archaeology.

The starting migration file should be ~800 lines of clean SQL, not 200+ individual files
that need to be applied in sequence. The existing codebase provides the exact final shape.

---

## 5. Clean Edge Function Set (15, not 69)

### Consolidated scan pipeline

```
Officer taps "Scan" on phone
  │
  └── process-officer-scan (single function, ~600 lines)
        1. Receive photo + GPS + officer context
        2. Send photo to Railway inference service (ALPR + vehicle attributes)
        3. Look up plate in canonical_vehicles (make/model/year/colour)
        4. Look up plate in canonical_scv (SCV status)
        5. Look up plate in canonical_homeless
        6. Determine zone from GPS
        7. Run calculate_vehicle_compliance_v3() RPC
        8. Create observation record
        9. Create breach_alert if non-compliant
        10. Return verdict to officer
```

This replaces: `process-officer-scan` + `alpr-process` + `alpr-retry` + `orc-ingest` +
`plate-scanner-photo-first` + `check-nzscv-status` + `analyze-vehicle-photo` +
`vehicle-ingest` + `stream-webhook` + `select-best-vehicle-photo` + `link-evidence-photos`.

### Consolidated nightly cleanup

```
pg_cron → cleanup-and-recalculate (runs 3am NZT)
  Phase 1: Zone GPS correction (reassign observations to correct zone)
  Phase 2: Duplicate detection + breach dedup
  Phase 3: Vehicle attribute refresh from canonical sources
  Phase 4: Overnight breach detection (check-almost-breaches logic)
  Phase 5: Compliance recalculation for corrected observations
  Phase 6: Photo maintenance (reconcile, reingest missing photos)
  Phase 7: SCV list sync from NZSCV registry
```

This replaces: `cleanup-and-recalculate` + `recalculate-compliance-v3` + `scan-breaches` +
`correct-zone-assignments` + `zone-correction` + `check-zone-corrections` +
`duplicate-detection` + `check-almost-breaches` + `sync-scv-list` (scheduled) +
`daily-photo-reconciler` + `enrich-from-motorweb` + `sync-spatial-layers`.

---

## 6. Role-by-Role UX Design

### Role 1: Field Officer (`officer`)

**Who they are**: Security patrol officer on foot or in a vehicle. Using a phone, often
in the dark, rain, or wind. Gloves on. Phone brightness at max.

**What they need — their entire day in the app**:

```
START SHIFT
  └── Tap "Start Patrol" on their zone → GPS confirms they're in the right area

SCAN A VEHICLE
  └── Large "SCAN" button — opens camera immediately
  └── Point camera at plate → result in 3–5 seconds
  └── COMPLIANT:  Green screen. Vehicle history shown. Tap to dismiss.
  └── BREACH:     Red screen. Night count shown. Tap to issue Notice to Vacate.
  └── INCONCLUSIVE: Yellow screen. Manual plate entry offered.

ISSUE NOTICE TO VACATE
  └── Officer confirms details (pre-filled from scan)
  └── One tap → PDF generated and stored
  └── Optional: hand officer's phone to occupant to see QR code for dispute portal

WELFARE CHECK-IN
  └── Periodic notification: "Confirm you're OK?"
  └── Two-tap response: OK / Needs Help

END SHIFT
  └── Tap "End Patrol"
  └── Summary: plates scanned, breaches found, notices issued
```

**UX principles for officer portal**:
- **No navigation menu** — one view at a time, full-screen
- **Three main states**: Scanning, Result, History
- **Large text, high contrast** — readable at arm's length in daylight
- **Night patrol mode** — dim red/dark mode to preserve night vision
- **Offline indicator** always visible if not connected
- **Zero configuration** — officer selects their zone once at shift start. Nothing else.

**Remove from officer view**:
- Settings pages (admin configures these)
- Reports (admin reviews these)
- Zone management (admin manages these)
- Compliance analytics (admin reads these)
- Any mention of "canonical", "compliance matrix", "migration", "recalculate"

---

### Role 2: Admin (`admin`)

**Who they are**: A manager at Iron Eagle Security or a council compliance team member.
Desk job. Desktop browser. Checks the system daily, sometimes responds to alerts in the
field via phone.

**What they need — their entire day in the app**:

```
MORNING REVIEW (5 minutes)
  └── Dashboard: yesterday's scan count, breach rate, new alerts, open notices
  └── Breach Alerts: filter "New Today" → action each one (assign/acknowledge/dismiss)

MANAGING AN ACTIVE BREACH
  └── Click a breach alert → see full observation history for that plate
  └── Issue infringement notice → enter amount, due date → generate PDF
  └── Log contact attempt → notes field

PATROL OVERVIEW
  └── Live Map: where are officers right now?
  └── Did they complete their scheduled zones?
  └── Any welfare check failures?

ZONE MANAGEMENT (occasional)
  └── Draw a new zone on the map → set nightly limit → save
  └── Edit legal config for infringement notices (payment URL, objections email)

REPORTS (weekly/monthly)
  └── Select date range + org → generate compliance report → email to council
  └── Export observations CSV for council records

USER MANAGEMENT
  └── Add/remove officers → send invite email → set role
```

**UX principles for admin portal**:
- **Sidebar navigation** with clear section labels
- **Dashboard is the home page** — always shows today's summary first
- **Inline actions** — admin should action a breach without leaving the breach list
- **Keyboard shortcuts** for power users (acknowledge alert: A, assign: S, dismiss: D)
- **No developer tools** — no cleanup utility, no recalculation triggers, no diagnostic pages

---

### Role 3: Master (`master`)

**Who they are**: Senior manager or account manager who runs multiple contracts (multiple
organizations). May be the same person as admin for smaller deployments.

**Additional access beyond admin**:

```
MULTI-ORG VIEW
  └── Dashboard shows all orgs they manage, with KPIs per org
  └── Can switch between orgs without logging out
  └── Can see cross-org vehicle histories (helpful for habitual violators who move between areas)

CONTRACT REPORTING
  └── Monthly council report with compliance rate, breach count, NTV count
  └── Officer performance KPIs (scans per shift, breach conversion rate)
  └── Zone health report (which zones have the most activity)

USER MANAGEMENT
  └── Can create admin users (not just officers)
  └── Can deactivate officers or admins

AUDIT ACCESS
  └── Full audit log access for their orgs
  └── Privacy access log review (Privacy Act 2020 compliance)
```

---

### Role 4: Grand Master (`grand_master`)

**NEW ROLE** — Platform owner / sales. This is Don (or a future senior account manager
at Iron Eagle) who manages the entire platform across all clients.

**What they need — a new role in the system**:

```
PLATFORM OVERVIEW
  └── All organizations on the platform
  └── Total scans, breaches, notices across the entire platform (anonymised for sales)
  └── Platform health: which orgs are active, which are stale, which need attention

CLIENT ONBOARDING
  └── Create a new organization
  └── Set up first admin user → send invite
  └── Configure branding (org name, logo for notices)
  └── Set up zones (draw boundaries)
  └── Activate/deactivate organization (billing control)

BILLING & SUBSCRIPTION
  └── Per-org: active officer count, scans this month, notices issued
  └── Export billing data for invoicing
  └── Suspend or reactivate an org

PLATFORM SETTINGS
  └── Global SCV list management (sync-scv-list)
  └── Feature flags per org (enable/disable dispute portal, infringement notices, etc.)
  └── SMTP and notification settings

SALES DEMO MODE
  └── One-click load of demo data for a prospective client presentation
  └── Demo org with realistic NZ freedom camping data
  └── Clean teardown after demo
```

**Why grand_master ≠ master**:
- `master` manages multiple contracts but is still an operational role
- `grand_master` manages the platform itself — they see across all orgs but their job
  is sales, onboarding, and billing, not enforcement operations

---

## 7. Clean Frontend Structure

### Pages (18 total)

```
Public (no auth)
├── /login                 Login.tsx
├── /portal-selection      PortalSelection.tsx
└── /dispute               PublicDisputePortal.tsx

Field Officer (officer, admin_officer)
└── /field                 FieldOfficerPortal.tsx
      ├── view: scan        Full-screen camera + result
      ├── view: history     Last 24h scans
      └── view: shift       Start/end patrol, welfare check

Admin (admin, admin_officer, master)
├── /dashboard             Dashboard.tsx       ← today's KPIs
├── /live                  LiveMap.tsx         ← officer locations + zones
├── /breaches              Breaches.tsx        ← alerts tab + notices tab
├── /vehicles              Vehicles.tsx        ← search + detail
├── /observations          Observations.tsx    ← searchable history
├── /zones                 Zones.tsx           ← map + compliance rules
├── /patrols               Patrols.tsx         ← schedule + KPIs
├── /enforcement           Enforcement.tsx     ← cases + infringement notices
├── /reports               Reports.tsx         ← generate + export
├── /users                 Users.tsx
└── /compliance            Compliance.tsx      ← analytics + breakdown

Master (master + above)
└── /organizations         Organizations.tsx   ← multi-org switcher + KPIs

Grand Master (grand_master only)
└── /platform              Platform.tsx        ← all orgs, billing, onboarding

Shared (all authenticated)
├── /profile               Profile.tsx
└── /settings              Settings.tsx
```

### What disappears from the UI

- `TestDashboard`, `CleanDashboard`, `DataCleanupUtility`, `DataIntegrityDashboard`,
  `SystemDiagnostics`, `CleanupAndRecalculate`, `ComplianceRecalculation`,
  `PhotoReingest`, `EvidencePhotoLinker` — all deleted
- `PHASE_*.md` files in `src/pages/` — deleted (they're markdown notes, not pages)
- Duplicate compliance pages (`CompliancePage`, `ComplianceAnalytics`,
  `ComplianceDashboard`) → merged into one `Compliance.tsx`

---

## 8. New Role: Grand Master (Platform Owner)

### DB change required

```sql
ALTER TABLE public.user_profiles
  DROP CONSTRAINT user_profiles_role_check,
  ADD CONSTRAINT user_profiles_role_check
    CHECK (role IN ('officer', 'admin', 'admin_officer', 'master', 'grand_master'));
```

Note: `nzscv_monitor` is removed (this read-only function can be covered by giving a
`master` scoped access, or by building a simple external monitoring dashboard).

### Frontend route guard

```tsx
// Grand master only sees /platform
<Route path="/platform" element={
  <ProtectedRoute>
    <RoleRoute allowedRoles={['grand_master']}>
      <Platform />
    </RoleRoute>
  </ProtectedRoute>
} />
```

### `Platform.tsx` page — key views

**Overview tab**
- Total organisations: active / trial / suspended
- Platform-wide stats: scans this month, breaches, notices (across all orgs)
- Map of all active zones in NZ (sales demo visual)

**Organisations tab**
- List with: org name, region, officer count, scans this month, contract status
- Actions: Edit, Suspend, Activate, View as Admin
- Create New Organisation button → wizard (name → admin user → zones → activate)

**Billing tab**
- Per-org: monthly scan count, officer seats, notice count
- Export CSV for invoicing
- Billing period selector

**Platform Settings tab**
- SCV list: last sync date, trigger manual sync
- Feature flags per org (JSON config)
- SMTP settings test
- Demo mode: load/clear demo data

---

## 9. Step-by-Step Clean Rebuild Order

This is a practical sequence that produces a working app at each step.

### Phase A — Foundation (1–2 days)

1. Create new Supabase project (or run against existing with migration reset)
2. Apply single `001_initial_schema.sql` (20 tables, indexes, RLS, triggers, RPCs)
3. Configure auth (email templates, SMTP secrets)
4. Deploy `create-user` edge function
5. Create first `grand_master` user
6. Verify login works

**Done**: You can log in and create orgs/users.

---

### Phase B — Scan Pipeline (2–3 days)

1. Deploy `process-officer-scan` (consolidated, ~600 lines)
2. Implement `FieldOfficerPortal.tsx` (scan + result + history views only)
3. Verify: officer scans a plate → gets compliance result
4. Verify: offline queue works
5. Implement welfare check-in notifications

**Done**: A field officer can do their full job.

---

### Phase C — Admin Operations (2–3 days)

1. Implement `Dashboard.tsx` (today's KPIs from `get_admin_dashboard_stats()` RPC)
2. Implement `Breaches.tsx` (alert queue with inline actions)
3. Implement `LiveMap.tsx` (officer positions + zone polygons)
4. Implement `Zones.tsx` (zone CRUD + compliance rules)
5. Deploy `generate-notice-to-vacate` + `generate-infringement`
6. Implement `Enforcement.tsx` (NTV + infringement notice generation)

**Done**: An admin can manage their full daily workflow.

---

### Phase D — Reports & Analytics (1–2 days)

1. Implement `Compliance.tsx` (breakdown by zone, chart over time)
2. Implement `Reports.tsx` (date range → generate → email or download)
3. Implement `Vehicles.tsx` (search by plate, show history)
4. Implement `Patrols.tsx` (schedule + KPI dashboard)

**Done**: Admin can produce council reports.

---

### Phase E — Multi-org & Grand Master (1–2 days)

1. Implement `Organizations.tsx` (master multi-org switcher)
2. Implement `Platform.tsx` (grand master overview + billing)
3. Deploy `process-homeless-data`, `sync-scv-list`
4. Implement `Users.tsx` (full user management)

**Done**: Grand master can onboard new clients and manage the platform.

---

### Phase F — Dispute & Public Portal (1 day)

1. Deploy `submit-dispute-intake`, `public-case-lookup`
2. Implement `PublicDisputePortal.tsx` (public form)
3. Add dispute queue to `Enforcement.tsx`

**Done**: Full end-to-end enforcement workflow including disputes.

---

### Phase G — Cleanup & Polish (1 day)

1. Delete all dead pages (`TestDashboard`, etc.)
2. Delete all dead edge functions (`recalculate-compliance`, `-v2`, etc.)
3. Run `bun run build` — zero TypeScript errors
4. Run `bun run lint` — zero lint errors
5. Run full manual test against staging

**Done**: Production-ready clean build.

---

## 10. Sales Strategy & Client Pitch

### 10.1 Target Clients

| Client Type | Who to speak to | Pain point |
|---|---|---|
| **District/City Councils** | Compliance Manager, Parks Manager | Manual paper-based enforcement, no audit trail, no court-ready records |
| **Regional Councils** | Reserves Officer, Bylaws Officer | Same as above + cross-district data sharing |
| **Security Companies** (like Iron Eagle) | Operations Manager, Contract Manager | Reporting to councils is manual, time-consuming, inconsistent |
| **DoC (Department of Conservation)** | Field Operations | Remote sites, no connectivity, need offline capability |

---

### 10.2 The Two-Sentence Pitch

> *"FreedomCamp Manager is a digital enforcement platform that lets patrol officers scan
> a vehicle's number plate with their phone and know within 5 seconds whether they're
> legally camping. Every scan is GPS-stamped, photo-evidenced, and court-ready — and
> your council gets a monthly compliance report without any manual data entry."*

---

### 10.3 Demo Flow (15-minute sales demo)

**Setup before the demo**: Load demo org "Demo Council - Nelson" with 3 zones, 5 officers,
and 2 weeks of realistic scan history including breaches and notices.

**Step 1 — Show the problem (2 min)**
> "This is what it looked like before: [show a photo of a notebook with handwritten plate
> numbers]. No GPS. No photo. No timestamp. Impossible to prove in court."

**Step 2 — Officer view (5 min)**
> "This is what your officer sees on their phone." Open `FieldOfficerPortal` on a phone.
> - Tap Start Patrol
> - Scan a demo plate (or type it manually)
> - Show the BREACH result — red screen, shows 4 nights this week (limit: 2)
> - Tap "Issue Notice to Vacate" — show the auto-filled form
> - Tap Generate — show the PDF with the council logo, legal text, QR code for disputes

**Step 3 — Admin view (5 min)**
> "This is what your compliance manager sees on their desk." Open `Dashboard.tsx`.
> - Show today's scan count, breach rate, open alerts
> - Click a breach alert → show vehicle history, all sites visited this month
> - Click Generate Monthly Report → show the PDF report format

**Step 4 — Proof it works offline (2 min)**
> Turn on airplane mode. Scan a plate. Show the "Queued" indicator.
> Turn airplane mode off. Show the scan sync.
> "Your officers work in areas with no signal. The system works anyway."

**Step 5 — Close (1 min)**
> "Pricing is per organisation, based on officer count and zone count. We handle hosting,
> updates, and the SCV registry integration. You own your data and can export it anytime."

---

### 10.4 Pricing Model (suggested)

| Tier | Who | Included | Suggested price |
|---|---|---|---|
| **Starter** | Small council or security co, 1–5 officers, up to 10 zones | All features, email support | $400–600/month |
| **Standard** | Mid-size council, 5–15 officers, unlimited zones | All features + priority support + monthly report template | $800–1,200/month |
| **Enterprise** | Regional council or multi-district, 15+ officers, multi-org | All features + custom branding + SLA + onsite training | from $2,000/month |

**One-off setup fee**: $500–1,500 depending on complexity (zone mapping, historical data
import, officer training).

**Why this pricing works**:
- Replaces a part-time admin role ($30k+ p.a.) that was previously doing manual reporting
- Council compliance managers can justify it as operational savings, not a new cost
- Compare to ParkPow or other ALPR SaaS at $500+/month per camera — this covers an
  entire patrol team

---

### 10.5 Objections & Responses

| Objection | Response |
|---|---|
| "We already have a spreadsheet system" | "Great — we can import that history. And when the council asks for GPS coordinates and a photo for every observation in a Freedom Camping Act enforcement action, your spreadsheet won't have that." |
| "What about privacy?" | "All data is stored in New Zealand on Supabase (AWS ap-southeast-2 / Sydney). We're Privacy Act 2020 compliant — there's a built-in access log for every time a person record is viewed." |
| "What if your company closes down?" | "You can export all your data as CSV or JSON at any time. The platform is built on standard open tools (PostgreSQL, React). We can hand you the source code if required." |
| "Our officers aren't tech-savvy" | "The officer app is designed for people who've never used software before. It's one button: Scan. If the plate is in breach, the screen goes red. That's it." |
| "We don't have internet in remote areas" | "The app works offline. Scans queue on the phone and sync when connectivity returns. Officers in Fiordland and Coromandel use it today." |
| "We'd need council IT approval" | "There's nothing to install on council IT infrastructure. It's a web app and a phone app. The only IT involvement is setting up email addresses for admin users." |

---

### 10.6 Differentiators vs Competitors

| Feature | FreedomCamp Manager | Generic ALPR / ParkPow | Paper/Spreadsheet |
|---|---|---|---|
| Freedom Camping Act compliance engine | ✓ (built-in) | ✗ | ✗ |
| Offline-first mobile scanning | ✓ | ✓ (some) | N/A |
| SCV registry integration (NZSCV) | ✓ (live) | ✗ | ✗ |
| Notice to Vacate PDF generation | ✓ (1 tap) | ✗ | Manual |
| Court-ready evidence (GPS + photo + timestamp) | ✓ | Partial | ✗ |
| Homeless / welfare support workflow | ✓ | ✗ | ✗ |
| Dispute portal for recipients | ✓ | ✗ | N/A |
| Multi-council / multi-org | ✓ | Varies | N/A |
| NZ-hosted, NZ-focused | ✓ | Varies | N/A |
| No per-scan fee | ✓ (flat rate) | Often per-scan | N/A |

---

### 10.7 Council Reporting Example

Include in sales collateral: a one-page sample of the monthly council report output.

The report includes:
- Period: March 2026
- Total vehicles scanned: 847
- Compliance rate: 91.2%
- Breach alerts: 74
- Notices to Vacate issued: 31
- Infringement notices issued: 8
- Most active site: Wakatu Carpark (281 scans)
- Repeat offenders: 12 vehicles with 3+ nights this month
- Officer hours: 142 hours across 6 officers

> *"This report is automatically generated — no manual data entry required."*

---

*End of CLEAN_REBUILD_DESIGN.md*
