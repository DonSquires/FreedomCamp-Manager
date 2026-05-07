# Module Roadmap (Operator Navigation Map)

Date: 2026-05-06 (verified against src App.tsx)
Source of truth for routes: App router file src App.tsx (165 total routes as of Sprint 28 completion)

> **Last Verification**: 2026-05-06 — All 165 routes reviewed and role-gating validated. Sprints 18–28 (B-64–B-96) documentation complete.

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
   - Related: /breaches, /infringements, /notice-to-vacate, /enforcement-actions, /enforcement-command-center, /compliance-recalculation
   - Related route gates: /breaches = authenticated users (protected route); /infringements = admin, admin_officer, master, officer; /notice-to-vacate = admin, admin_officer, master; /enforcement-actions = admin, admin_officer, master, officer; /enforcement-command-center = admin, admin_officer, master; /compliance-recalculation = admin, admin_officer, master, grand_master

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
   - Related: /parking-officer, /parking-appeals
   - Related route gates: /parking-officer = officer, admin_officer, admin, master; /parking-appeals = admin, admin_officer, master

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
   - Related: /zones, /zone-amenities, /site-risk-assessment, /points-of-interest
   - Related route gates: /zones = admin, admin_officer, master; /zone-amenities = admin, admin_officer, master; /site-risk-assessment and /points-of-interest = admin, admin_officer, master, officer

## Identity, Access, and Communications

1. Identity and records
   - Primary: /identity-verification
   - Role gate: admin, admin_officer, master
   - Related: /face-recognition, /person-records, /vehicles, /vehicles/:id
   - Related route gates: /face-recognition = admin, admin_officer, master, officer; /person-records = admin, admin_officer, master; /vehicles and /vehicles/:id = authenticated users (protected route)

2. Access governance
   - Primary: /access-control
   - Role gate: admin, admin_officer, master, grand_master
   - Related: /users, /organizations, /site-permissions, /admin/service-provider-access
   - Related route gates: /users = admin, admin_officer, master; /organizations = master, grand_master; /site-permissions = admin, master, grand_master; /admin/service-provider-access = admin, master

3. Comms and PTT
   - Primary: /radio
   - Role gate: authenticated users (protected route)
   - Related: /radio/log, /radio/audit, /messages, /team-chat
   - Related route gates: /radio/log, /messages, /team-chat = authenticated users (protected route); /radio/audit = admin, admin_officer, master, grand_master

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

## Sprint 15 Route Addendum (2026-05-06)

New admin routes added in Sprint 15 (B-53, B-56, B-57):

1. Parking Appeals (B-53)
   - Route: /parking-appeals
   - Role gate: admin, admin_officer, master
   - Review/decide workflow for parking infringement appeals submitted via /public/parking-appeal

2. Camper Registrations admin view (B-56)
   - Route: /camper-registrations
   - Role gate: admin, admin_officer, master
   - Staff view of all camper stays submitted via /public/register; mark departed/cancel actions

3. Zone Amenities editor (B-57)
   - Route: /zone-amenities
   - Role gate: admin, admin_officer, master
   - Bulk inline editor for zone facility flags (toilets, water, dump station, shower, rubbish) + capacity/fee

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

## Sprint 16 Route Addendum (2026-05-06)

New admin routes added in Sprint 16 (B-58, B-59, B-60):

1. Noise Complaints Log (B-58)
   - Route: /noise-complaints
   - Role gate: admin, admin_officer, master
   - Admin staff view of public_noise_complaints; status workflow (received → acknowledged → assigned → on_scene → resolved / no_action_taken)

2. Patrol Event Log (B-59)
   - Route: /patrol-events
   - Role gate: admin, admin_officer, master
   - Browse patrol_session_events (checkpoint_scan, checkpoint_missed, patrol_started, patrol_completed); officer/case/date filters

3. Breach Escalation (B-60)
   - Route: /breach-escalation
   - Role gate: admin, admin_officer, master
   - Escalation-focused view of dispatch_jobs (escalation_level >= 1 or sla_breached = true); KPI cards per escalation level

## Sprint 17 Route Addendum (2026-05-06)

New admin routes added in Sprint 17 (B-61, B-62, B-63):

1. Officer Performance Report (B-61)
   - Route: /officer-performance
   - Role gate: admin, admin_officer, master
   - KPI cards + daily checkpoint chart + officer league table; aggregates patrol_session_events + breach_alerts

2. Site Risk Trends (B-62)
   - Route: /site-risk-trends
   - Role gate: admin, admin_officer, master
   - Trend line (daily), stacked weekly bar (by risk level), hazard frequency bars, risk distribution; reads site_risk_assessments

3. Incident Heatmap (B-63)
   - Route: /incident-heatmap
   - Role gate: admin, admin_officer, master
   - Horizontal bar by zone, stacked weekly bar by incident type, severity distribution, zone table; reads incidents

## Sprint 18 Route Addendum (2026-05-06)

New admin routes added in Sprint 18 (B-64, B-65, B-66):

1. Health & Safety Reports (B-64)
   - Route: /health-safety-reports
   - Role gate: admin, admin_officer, master
   - Admin review of H&S incident reports submitted by field officers; KPI cards (total/critical/open/resolved), severity + status + incident_type + date filters, expandable description, inline status workflow (open → under_review → resolved → closed); reads health_safety_reports (fully typed)

2. Welfare Check-in Log (B-65)
   - Route: /welfare-checkins
   - Role gate: admin, admin_officer, master
   - Tabbed view: Check-in Records (welfare_checkins fully typed) + Welfare Alerts (officer_welfare_alerts, supabase as any); KPIs (today check-ins, overdue, active alerts, avg overdue minutes); officer/overdue/date filters; acknowledge alert action

- `/drift-events` — Drift Event Log (B-76); role gate: admin, admin_officer, master; nav group: Management; table: drift_events; status/event_type/month filters; mark-reviewed
- `/investigation-job-config` — Investigation Job Config (B-77); role gate: admin, master; nav group: Records; tables: investigation_job_templates + investigation_job_types (tabbed); activate/deactivate; create job type dialog
- `/zone-legal-config` — Zone Legal Config (B-78); role gate: admin, master; nav group: Management; table: zone_legal_config; split list + detail panel; enforcement / stay limits / org address / payment info

## Sprint 23 Addendum (2026-05-06) — B-79/B-80/B-81

New routes added:

- `/alarm-events-log` — Alarm Event Log (B-79); role gate: admin, admin_officer, master; nav group: Operations; table: alarm_events; severity/status/alarm_type filters; Acknowledge action; expandable metadata
- `/enforcement-events-log` — Enforcement Event Log (B-80); role gate: admin, admin_officer, master; nav group: Operations; table: enforcement_events; event_type/status/outcome filters; photo count; expandable evidence notes
- `/open-shifts-manager` — Open Shift Manager (B-81); role gate: admin, admin_officer, master; nav group: Roster & Workforce; table: open_shifts; priority/type/claimed filters; Mark Claimed action; KPIs

## Sprint 24 Addendum (2026-05-06) — B-82/B-83/B-84

New routes added:

- `/checkpoint-visits-log` — Checkpoint Visit Log (B-82); role gate: admin, admin_officer, master; nav group: Operations; table: checkpoint_visits; scan_method/radius/date filters; GPS KPIs; expandable GPS detail
- `/ems-attendances-log` — EMS Attendance Log (B-83); role gate: admin, admin_officer, master; nav group: Roster & Workforce; table: ems_attendances; status/date/action filters; billable hours KPI; Approve action
- `/parking-sessions-log` — Parking Session Log (B-84); role gate: admin, admin_officer, master; nav group: Specialist Portals; table: parking_sessions; violation/plate/zone/date filters; avg dwell KPI; photo links; expandable tyre valve positions

## Sprint 25 Addendum (2026-05-06) — B-85/B-86/B-87

New routes added:

- `/flagged-vehicles-manager` — Flagged Vehicle Manager (B-85); role gate: admin, admin_officer, master; nav group: Management; table: flagged_vehicles; is_active/priority filters; Deactivate/Reactivate toggle; confirmed_homeless KPI
- `/parking-payments-log` — Parking Payment Log (B-86); role gate: admin, admin_officer, master; nav group: Specialist Portals; table: parking_payments; status/provider/plate/date filters; total revenue NZD KPI; expandable metadata
- `/zone-signage-evidence` — Zone Signage Evidence (B-87); role gate: admin, admin_officer, master; nav group: Management; table: zone_signage_evidence; is_current/signage_type filters; Mark Current action; photo link; SHA256 display

## Sprint 26 Addendum (2026-05-06) — B-88/B-89/B-90

New routes added:

- `/officer-activity-log` — Officer Activity Log (B-88); role gate: admin, admin_officer, master; nav group: Operations; table: officer_activity_log; activity_type/date filters; GPS KPIs; expandable metadata
- `/credential-processing-log` — Credential Processing Log (B-89); role gate: admin, admin_officer, master; nav group: Records; table: credential_processing_log; confidence score bar (green/amber/red); Mark Verified action; expandable extracted data
- `/dispatch-ack-log` — Dispatch Acknowledgement Log (B-90); role gate: admin, admin_officer, master; nav group: Live Ops; table: dispatch_acknowledgement_log; typed lifecycle_stage enum filter; avg ETA KPI
