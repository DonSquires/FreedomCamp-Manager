# Module Roadmap (Operator Navigation Map)

Date: 2026-05-06 (verified against src App.tsx)
Source of truth for routes: App router file src App.tsx (136 total routes as of Sprint 13 completion)

> **Last Verification**: 2026-05-06 — Sprint 13 routes added (B-48 Radio Transmissions Log, B-49 Voice Profiles & Consent; B-45 Trespass Notices, B-46 Access Permissions, B-47 Canonical Person Viewer, B-44 Dispatch LOI Browser). Previous baseline: a6e39a0f (2026-05-04, 122 routes).

## How To Use

1. Start from a capability family below.
2. Navigate via the primary route.
3. Use the related routes for adjacent operations.

## Core Operations

1. CRM and account operations
   - Primary: /crm
   - Role gate: admin, admin_officer, master, grand_master
   - Related: /crm/client/:orgId, /crm/contractor/:orgId, /client-sites, /access-control, /client-master-list
   - Related route gates: /crm/client/:orgId and /crm/contractor/:orgId inherit /crm gate; /client-sites = admin, admin_officer, master; /access-control = admin, admin_officer, master, grand_master; /client-master-list = admin, admin_officer, master

2. Compliance and enforcement
   - Primary: /compliance
   - Role gate: admin, admin_officer, master
   - Related: /breaches, /infringements, /notice-to-vacate, /enforcement-actions, /enforcement-command-center, /compliance-recalculation, /trespass-notices, /access-permissions, /loi-browser
   - Related route gates: /breaches = authenticated users (protected route); /infringements = admin, admin_officer, master, officer; /notice-to-vacate = admin, admin_officer, master; /enforcement-actions = admin, admin_officer, master, officer; /enforcement-command-center = admin, admin_officer, master; /compliance-recalculation = admin, admin_officer, master, grand_master; /trespass-notices = admin, admin_officer, master; /access-permissions = admin, admin_officer, master; /loi-browser = admin, admin_officer, master

3. Patrol and dispatch
   - Primary: /live-patrol
   - Role gate: admin, admin_officer, master
   - Related: /dispatch, /dispatch-wizard, /dispatch-monitor, /dispatched-jobs, /job-map, /roster
   - Related route gates: /dispatch, /dispatch-wizard, /dispatch-monitor, /dispatched-jobs, /roster = admin, admin_officer, master; /job-map = admin, admin_officer, master, officer

4. Field officer workflows
   - Primary: /field and /field-officer
   - Role gate: officer, admin_officer (field portal area-gated)
   - Related: /observations, /observations-report, /patrol-checkpoints, /patrol-schedule
   - Related route gates: /observations, /observations-report, /patrol-checkpoints, /patrol-schedule = admin, admin_officer, master

## Specialist Portals

1. Parking
   - Primary: /parking
   - Role gate: admin, admin_officer, master
   - Related: /parking-officer
   - Related route gates: /parking-officer = officer, admin_officer, admin, master

2. Noise
   - Primary: /noise-control
   - Role gate: admin, admin_officer, master
   - Related: /noise-officer
   - Related route gates: /noise-officer = officer, admin_officer, admin, master

3. Biosecurity
   - Primary: /biosecurity-control
   - Role gate: admin, admin_officer, master
   - Related: /biosecurity-officer
   - Related route gates: /biosecurity-officer = officer, admin_officer, admin, master

4. Smoke
   - Primary: /smoke-control
   - Role gate: admin, admin_officer, master
   - Related: /smoke-officer
   - Related route gates: /smoke-officer = officer, admin_officer, admin, master

## AI, Intelligence, and Review Surfaces

1. Bob assistant and orchestration
   - Primary: /bob-assistant
   - Role gate: admin, admin_officer, master, officer, grand_master
   - Related: /bob-intake-queue, /live-plan-reviews, /bob-ui-review, /ai-analysis
   - Related route gates: /bob-intake-queue, /live-plan-reviews, /bob-ui-review = admin, admin_officer, master, grand_master; /ai-analysis = admin, admin_officer, master

2. Intelligence and approvals
   - Primary: /intel-approvals
   - Role gate: master, grand_master
   - Related: /investigations, /incident-reports
   - Related route gates: /investigations and /incident-reports = admin, admin_officer, master

3. Tender and analysis workspace
   - Primary: /tender-workspace
   - Role gate: admin, master, grand_master
   - Related: /tender-workspace/:id, /tender-reference-library
   - Related route gates: /tender-workspace/:id and /tender-reference-library = admin, master, grand_master

## Data, Diagnostics, and Recovery

1. Data management
   - Primary: /admin/data-hub
   - Role gate: admin, admin_officer, master
   - Related: /data, /admin/data-cleanup, /admin/data-integrity, /import-data, /import-historical
   - Related route gates: /data, /admin/data-cleanup, /admin/data-integrity, /import-data = admin, admin_officer, master; /import-historical = admin, master

2. Recovery and maintenance
   - Primary: /admin/cleanup-recalculate
   - Role gate: admin, master
   - Related: /photo-reingest, /evidence-photo-linker, /diagnostics
   - Related route gates: /photo-reingest and /evidence-photo-linker = admin, admin_officer, master; /diagnostics = master, grand_master

3. Spatial and zone administration
   - Primary: /spatial-compliance
   - Role gate: admin, admin_officer, master
   - Related: /zones, /site-risk-assessment, /points-of-interest
   - Related route gates: /zones = admin, admin_officer, master; /site-risk-assessment and /points-of-interest = admin, admin_officer, master, officer

## Identity, Access, and Communications

1. Identity and records
   - Primary: /identity-verification
   - Role gate: admin, admin_officer, master
   - Related: /face-recognition, /person-records, /canonical-persons, /vehicles, /vehicles/:id
   - Related route gates: /face-recognition = admin, admin_officer, master, officer; /person-records = admin, admin_officer, master; /canonical-persons = admin, admin_officer, master; /vehicles and /vehicles/:id = authenticated users (protected route)

2. Access governance
   - Primary: /access-control
   - Role gate: admin, admin_officer, master, grand_master
   - Related: /users, /organizations, /site-permissions, /admin/service-provider-access
   - Related route gates: /users = admin, admin_officer, master; /organizations = master, grand_master; /site-permissions = admin, master, grand_master; /admin/service-provider-access = admin, master

3. Comms and PTT
   - Primary: /radio
   - Role gate: authenticated users (protected route)
   - Related: /radio/log, /radio/audit, /radio-transmissions, /voice-profiles, /messages, /team-chat
   - Related route gates: /radio/log, /messages, /team-chat = authenticated users (protected route); /radio/audit = admin, admin_officer, master, grand_master; /radio-transmissions = admin, admin_officer, master; /voice-profiles = admin, admin_officer, master

## Executive and Governance Views

1. Platform and admin views
   - Primary: /platform
   - Role gate: grand_master
   - Related: /admin, /admin/dashboard, /reports, /custom-reports, /audit-log
   - Related route gates: /admin, /admin/dashboard, /reports, /custom-reports, /audit-log = admin, admin_officer, master

2. Client-facing visibility
   - Primary: /client-portal
   - Role gate: client_viewer, client_officer, client_admin, admin, admin_officer, master, grand_master
   - Related: /organization-profile, /reports-hub, /disputes
   - Related route gates: /organization-profile and /disputes = admin, admin_officer, master; /reports-hub redirects to /reports (admin, admin_officer, master)

## Maintenance Rule

Update this roadmap when any route is added, removed, renamed, or re-gated in the App router file.

## Route Topology Addendum (2026-05-03)

Route gating and default redirect behavior was centralized into a shared role-path helper used by App routing and login entry flow.

1. New helper: navigation rolePath helper (`src navigation rolePath.ts`)
   - getDefaultRouteForRole(role)
   - getRoleConstrainedRedirect(role, path, hasPortalChoice)
2. App router integration: App router (`src App.tsx`)
   - ProtectedRoute now delegates role-constrained redirects to rolePath helper.
   - RoleRoute and AreaRoute unauthorized redirects now route to role-aware defaults, not a blanket root redirect.
3. Login integration: Login page (`src pages Login.tsx`)
   - Post-auth redirect now uses role-aware defaults from rolePath helper.

Operational impact:

1. admin_officer portal-selection enforcement remains session-choice aware.
2. nzscv_monitor remains constrained to monitoring and account areas.
3. client persona roles remain constrained to client portal and account areas.
4. grand_master default landing remains /platform.

## Sprint 18 Addendum (2026-05-06) — B-64/B-65/B-66

New routes added:

- `/health-safety-reports` — Health & Safety Reports (B-64); role gate: admin, admin_officer, master; nav group: Records
- `/welfare-checkins` — Welfare Check-in Log (B-65); role gate: admin, admin_officer, master; nav group: Specialist Portals
- `/parking-permits` — Parking Permit Manager (B-66); role gate: admin, admin_officer, master; nav group: Specialist Portals

## Sprint 19 Addendum (2026-05-06) — B-67/B-68/B-69

New routes added:

- `/roster-shifts` — Roster Shift Log (B-67); role gate: admin, admin_officer, master; nav group: Roster & Workforce; table: roster_shifts
- `/noise-notices` — Noise Notice Log (B-68); role gate: admin, admin_officer, master; nav group: Operations; tables: noise_notices + noise_seizures (tabbed)
- `/site-incidents` — Site Incident Log (B-69); role gate: admin, admin_officer, master; nav group: Operations; table: site_incidents

## Sprint 20 Addendum (2026-05-06) — B-70/B-71/B-72

New routes added:

- `/person-interactions` — Person Interaction Log (B-70); role gate: admin, admin_officer, master; nav group: Operations; table: person_interactions
- `/plate-scans-log` — Plate Scan Log (B-71); role gate: admin, admin_officer, master; nav group: Management; table: plate_scans
- `/dispatch-events` — Dispatch Event Log (B-72); role gate: admin, admin_officer, master; nav group: Live Ops; table: dispatch_events

## Sprint 21 Addendum (2026-05-06) — B-73/B-74/B-75

New routes added:

- `/notices-to-vacate` — Notice to Vacate Log (B-73); role gate: admin, admin_officer, master; nav group: Operations; table: notices_to_vacate; status workflow: pending→issued→delivered→complied/escalated
- `/contractor-manager` — Contractor Manager (B-74); role gate: admin, admin_officer, master; nav group: Admin; tables: contractor_profiles + contractor_documents (tabbed)
- `/vehicle-discrepancies` — Vehicle Discrepancy Log (B-75); role gate: admin, admin_officer, master; nav group: Management; table: vehicle_discrepancies; mark-reviewed action
