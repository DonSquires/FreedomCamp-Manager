# Module Roadmap (Operator Navigation Map)

Date: 2026-05-06 (verified against src App.tsx)
Source of truth for routes: App router file src App.tsx (148 total routes as of Sprint 26 completion)

> **Last Verification**: 2026-05-06 — Sprint 26 routes added (B-88 Officer Activity Log `/officer-activity-log`, B-89 Credential Processing Log `/credential-processing-log`, B-90 Dispatch Acknowledgement Log `/dispatch-ack-log`). Previous baseline: Sprint 25 (145 routes).

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

## Sprint 23 Additions (2026-05-06)

Three new admin log-viewer pages added covering investigation jobs, operational cases, and patrol events.

1. Investigation Job Log — B-79
   - Path: /investigation-jobs-log
   - Role gate: admin, admin_officer, master
   - Table: investigation_jobs (fully typed)
   - Features: KPI strip (Total/Open/Completed/Overdue), status+priority filters, Mark Complete action, expandable detail rows

2. Operational Case Log — B-80
   - Path: /operational-cases-log
   - Role gate: admin, admin_officer, master
   - Table: operational_cases (fully typed)
   - Features: KPI strip (Total/Open/Pending/Closed), status+type+date filters, Close Case action, expandable detail rows; links to Case Bridge for full editing

3. Patrol Event Log — B-81
   - Path: /patrol-events-log
   - Role gate: admin, admin_officer, master
   - Table: patrol_events (fully typed)
   - Features: KPI strip (Total/Active/With Photos/Unique Cases), event_type+patrol_type+status+date filters, expandable rows with observation text, GPS coords, photo links

## Sprint 24 Additions (2026-05-06)

Three new admin log-viewer pages added covering checkpoint GPS compliance, EMS attendance approvals, and parking session review.

1. Checkpoint Visit Log — B-82
   - Path: /checkpoint-visits-log
   - Role gate: admin, admin_officer, master
   - Table: checkpoint_visits (fully typed)
   - Features: KPI strip (Total/Within Radius/Outside Radius/Unique Checkpoints), scan_method+radius+date filters, expandable rows with GPS coords, distance, patrol_id

2. EMS Attendance Log — B-83
   - Path: /ems-attendances-log
   - Role gate: admin, admin_officer, master
   - Table: ems_attendances (fully typed)
   - Features: KPI strip (Total/Pending/Approved/Billable Hours), status+date filters, Approve action, expandable rows with device info, district, rates

3. Parking Session Log — B-84
   - Path: /parking-sessions-log
   - Role gate: admin, admin_officer, master
   - Table: parking_sessions (fully typed)
   - Features: KPI strip (Total/Violations/Avg Dwell/Unique Plates), violation+plate+date filters, expandable rows with violation reason, GPS, entry/exit/sign/tyre-valve photos

## Sprint 25 Additions (2026-05-06)

Three new admin pages covering flagged vehicle management, parking payment review, and zone signage evidence management.

1. Flagged Vehicle Manager — B-85
   - Path: /flagged-vehicles-manager
   - Role gate: admin, admin_officer, master
   - Table: flagged_vehicles (fully typed)
   - Features: KPI strip (Total/Active/Inactive/Confirmed Homeless), is_active+priority filters, Deactivate/Reactivate actions, expandable rows with reason, notes, contact

2. Parking Payment Log — B-86
   - Path: /parking-payments-log
   - Role gate: admin, admin_officer, master
   - Table: parking_payments (fully typed)
   - Features: KPI strip (Total/Successful/Pending-Failed/Revenue NZD), status+provider+plate+date filters, expandable rows with zone_id, session_id, metadata JSON

3. Zone Signage Evidence — B-87
   - Path: /zone-signage-evidence
   - Role gate: admin, admin_officer, master
   - Table: zone_signage_evidence (fully typed)
   - Features: KPI strip (Total/Current/Superseded/Unique Zones), is_current+signage_type filters, Mark Current action, expandable rows with photo link, GPS, SHA256

## Sprint 26 Additions (2026-05-06)

Three new admin log pages covering officer activity tracking, AI credential processing, and dispatch lifecycle acknowledgement.

1. Officer Activity Log — B-88
   - Path: /officer-activity-log
   - Role gate: admin, admin_officer, master
   - Table: officer_activity_log (fully typed)
   - Features: KPI strip (Total/Unique Officers/With GPS), activity_type+date filters, expandable rows with full GPS coords + metadata JSON

2. Credential Processing Log — B-89
   - Path: /credential-processing-log
   - Role gate: admin, master
   - Table: credential_processing_log (fully typed)
   - Features: KPI strip (Total/Verified/Pending-Proc/Avg Confidence), status+doc_type+date filters, confidence bar, Mark Verified action, expandable rows with authorized_activities, ai_model, error_message, extracted_text

3. Dispatch Acknowledgement Log — B-90
   - Path: /dispatch-ack-log
   - Role gate: admin, admin_officer, master
   - Table: dispatch_acknowledgement_log (fully typed, typed lifecycle_stage enum)
   - Features: KPI strip (Total/On Scene/Completed/Avg ETA), stage+callsign+date filters, ETA display, expandable rows with case_id, job_id, notes

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
