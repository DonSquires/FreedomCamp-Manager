# Module Roadmap (Operator Navigation Map)

Date: 2026-05-06 (verified against src App.tsx)
Source of truth for routes: App router file src App.tsx (177 total routes as of Sprint 32 completion)

> **Last Verification**: 2026-05-06 — All 177 routes reviewed and role-gating validated. Sprints 18–32 (B-64–B-108) documentation complete.

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

3. Parking Permit Manager (B-66)
   - Route: /parking-permits
   - Role gate: admin, admin_officer, master
   - Full CRUD admin register for parking_permits (fully typed); KPIs (total/active/expiring 7 days/expired); Issue Permit dialog (plate, holder details, type, zone, validity); Deactivate inline; plate/holder search + type/zone/status filters; reads parking_zones for zone dropdown

## Sprint 19 Route Addendum (2026-05-06)

New admin routes added in Sprint 19 (B-67, B-68, B-69):

1. Roster Shift Log (B-67)
   - Route: /roster-shifts
   - Role gate: admin, admin_officer, master
   - Admin viewer for roster_shifts; KPI cards (total/confirmed/pending/cancelled); date/status/shift_type/search filters; confirm/cancel actions; reads roster_shifts (fully typed)

2. Noise Notice Log (B-68)
   - Route: /noise-notices
   - Role gate: admin, admin_officer, master
   - Tabbed admin log for noise enforcement notices (noise_notices) and equipment seizures (noise_seizures); Mark Complied workflow; status/date filters; reads both tables (fully typed)

3. Site Incident Log (B-69)
   - Route: /site-incidents
   - Role gate: admin, admin_officer, master
   - Admin log for site_incidents; KPI cards; incident_type/severity/status/date filters; expandable detail rows; mark-reviewed action; reads site_incidents (fully typed)

## Sprint 20 Route Addendum (2026-05-06)

New admin routes added in Sprint 20 (B-70, B-71, B-72):

1. Person Interaction Log (B-70)
   - Route: /person-interactions
   - Role gate: admin, admin_officer, master
   - Admin log for person_interactions; KPI cards (total/follow-up required/this week); interaction_type/date filters; follow-up toggle; expandable row; reads person_interactions (fully typed)

2. Plate Scan Log (B-71)
   - Route: /plate-scans-log
   - Role gate: admin, admin_officer, master
   - Admin log for plate_scans; breach/flagged/unreviewed filters; bulk mark-reviewed; confidence bar per scan; reads plate_scans (fully typed)

3. Dispatch Event Log (B-72)
   - Route: /dispatch-events
   - Role gate: admin, admin_officer, master
   - Admin log for dispatch_events; event timeline; type/status filters; escalation highlighting; reads dispatch_events (fully typed)

## Sprint 21 Route Addendum (2026-05-06)

New admin routes added in Sprint 21 (B-73, B-74, B-75):

1. Notice to Vacate Log (B-73)
   - Route: /notices-to-vacate
   - Role gate: admin, admin_officer, master
   - Admin log for notices_to_vacate; status workflow (pending → issued → delivered → complied / escalated); overdue row highlighting; reads notices_to_vacate (fully typed)

2. Contractor Manager (B-74)
   - Route: /contractor-manager
   - Role gate: admin, admin_officer, master
   - Tabbed admin view of contractor_profiles (rates + compliance) and contractor_documents (mark-current action); reads both tables (fully typed)

3. Vehicle Discrepancy Log (B-75)
   - Route: /vehicle-discrepancies
   - Role gate: admin, admin_officer, master
   - Admin log for vehicle_discrepancies; mark-reviewed action; severity/type filters; reads vehicle_discrepancies (fully typed)

## Sprint 22 Route Addendum (2026-05-06)

New admin routes added in Sprint 22 (B-76, B-77, B-78):

1. Drift Event Log (B-76)
   - Route: /drift-events
   - Role gate: admin, admin_officer, master
   - Admin log for drift_events (vehicle GPS drift beyond zone boundary); KPI cards (Total / Unreviewed / In Progress / Remediated); status/event_type/review_month/search filters; Mark Reviewed action; expandable metadata; reads drift_events (fully typed)

2. Investigation Job Config (B-77)
   - Route: /investigation-job-config
   - Role gate: admin, admin_officer, master
   - Tabbed admin configuration for investigation_job_templates (activate/deactivate) and investigation_job_types (create type dialog); reads investigation_job_templates + investigation_job_types (fully typed)

3. Zone Legal Config Viewer (B-78)
   - Route: /zone-legal-config
   - Role gate: admin, master
   - Split list+detail panel for zone_legal_config; sections: enforcement rules, stay limits, org context, payment configuration; reads zone_legal_config (fully typed)

## Sprint 23 Route Addendum (2026-05-06)

New admin routes added in Sprint 23 (B-79, B-80, B-81):

1. Investigation Job Log (B-79)
   - Route: /investigation-jobs-log
   - Role gate: admin, admin_officer, master
   - Log viewer for investigation_jobs with Mark Complete action; KPI cards (Total / Open / In Progress / Completed); status/job_type/priority/search filters; reads investigation_jobs (fully typed)

2. Operational Case Log (B-80)
   - Route: /operational-cases-log
   - Role gate: admin, admin_officer, master
   - Log viewer for operational_cases with Close Case action; KPI cards (Total / Open / Closed); status/case_type/search filters; reads operational_cases (fully typed)

3. Patrol Events Log — secondary admin route (B-81)
   - Route: /patrol-events-log
   - Role gate: admin, admin_officer, master
   - Second access path for PatrolEventLog (B-59) surfaced in the admin Records group; same component as /patrol-events

## Sprint 24 Route Addendum (2026-05-06)

New admin routes added in Sprint 24 (B-82, B-83, B-84):

1. Checkpoint Visit Log (B-82)
   - Route: /checkpoint-visits-log
   - Role gate: admin, admin_officer, master
   - Log viewer for checkpoint_visits; KPI cards (Total / Within Radius / Outside Radius / Avg GPS Accuracy); scan_method/radius/date filters; expandable GPS detail row; reads checkpoint_visits (fully typed)

2. EMS Attendance Log (B-83)
   - Route: /ems-attendances-log
   - Role gate: admin, admin_officer, master
   - Log viewer for ems_attendances; Approve action; KPI cards (Total / Pending / Approved / Billable Hours); status/date filters; reads ems_attendances (fully typed)

3. Parking Session Log (B-84)
   - Route: /parking-sessions-log
   - Role gate: admin, admin_officer, master
   - Log viewer for parking_sessions; KPI cards (Total / Violations / Avg Dwell); violation/plate/date filters; photo links; reads parking_sessions (fully typed)

## Sprint 25 Route Addendum (2026-05-06)

New admin routes added in Sprint 25 (B-85, B-86, B-87):

1. Flagged Vehicle Manager (B-85)
   - Route: /flagged-vehicles-manager
   - Role gate: admin, admin_officer, master
   - Admin manager for flagged_vehicles; KPI cards (Total / Active / Confirmed Homeless / High Priority); is_active/priority filters; Deactivate/Reactivate actions; reads flagged_vehicles (fully typed)

2. Parking Payment Log (B-86)
   - Route: /parking-payments-log
   - Role gate: admin, admin_officer, master
   - Log viewer for parking_payments; KPI cards (Total / Paid / Revenue NZD); status/payment_provider/plate/date filters; metadata expand; reads parking_payments (fully typed)

3. Zone Signage Evidence (B-87)
   - Route: /zone-signage-evidence
   - Role gate: admin, admin_officer, master
   - Evidence log for zone_signage_evidence; KPI cards (Total / Current / Outdated); is_current/signage_type filters; Mark Current action; photo link + SHA256 hash display; reads zone_signage_evidence (fully typed)

## Sprint 26 Route Addendum (2026-05-06)

New admin routes added in Sprint 26 (B-88, B-89, B-90):

1. Officer Activity Log (B-88)
   - Route: /officer-activity-log
   - Role gate: admin, admin_officer, master
   - Log viewer for officer_activity_log; KPI cards (Total / Unique Officers / GPS Fixes / Activity Types); activity_type/date filters; GPS KPI; expandable metadata; reads officer_activity_log (fully typed)

2. Credential Processing Log (B-89)
   - Route: /credential-processing-log
   - Role gate: admin, admin_officer, master
   - Log viewer for credential_processing_log; KPI cards (Total / Verified / Pending / Failed); confidence bar per row; Mark Verified action; status/document_type/date filters; reads credential_processing_log (fully typed)

3. Dispatch Acknowledgement Log (B-90)
   - Route: /dispatch-ack-log
   - Role gate: admin, admin_officer, master
   - Log viewer for dispatch_acknowledgement_log; KPI cards (Total / Acknowledged / En Route / On Scene); lifecycle_stage filter (typed enum); ETA display; reads dispatch_acknowledgement_log (fully typed)

## Sprint 27 Route Addendum (2026-05-06)

New admin routes added in Sprint 27 (B-91, B-92, B-93):

1. Compliance Audit Log (B-91)
   - Route: /compliance-audit-log
   - Role gate: admin, admin_officer, master
   - Log viewer for compliance_audit_log; KPI cards (Total / Compliant / Blocked / Unique Officers); check_type/compliance_status/date filters; can_enforce + can_work badges; expandable blocked_reason; reads compliance_audit_log (fully typed)

2. Enforcement Event Log (B-92)
   - Route: /enforcement-events-log
   - Role gate: admin, admin_officer, master
   - Log viewer for enforcement_events; KPI cards (Total / Open / Closed / Unique Officers); event_type/status/violation_type/date filters; subject_type + identifier display; expandable action_taken + evidence_notes + photo URLs; reads enforcement_events (fully typed)

3. Noise Job Log (B-93)
   - Route: /noise-jobs-log
   - Role gate: admin, admin_officer, master
   - Log viewer for noise_jobs; KPI cards (Total / Open / Completed / High Priority); status/priority/noise_type/date filters; job_number + address + outcome; expandable complaint_description + outcome_notes + GPS + safety_notes; reads noise_jobs (fully typed)

## Sprint 28 Route Addendum (2026-05-06)

New admin routes added in Sprint 28 (B-94, B-95, B-96):

1. Patrol Route Log (B-94)
   - Route: /patrol-route-log
   - Role gate: admin, admin_officer, master
   - Viewer for patrols table; KPIs (Total / Active / Completed / Avg Breaches Found); status/priority/date filters; breaches_found + vehicles_checked + duration_minutes columns; expandable description, notes, scheduled/actual times, accepted status; reads patrols (fully typed)

2. Alarm Event Log (B-95)
   - Route: /alarm-events-log
   - Role gate: admin, admin_officer, master
   - Viewer for alarm_events; KPIs (Total / Open / Acknowledged / Critical+High); alarm_type/severity/status/date filters; Acknowledge action; expandable notes + raw_payload JSON; reads alarm_events (fully typed)

3. Bug Report Log (B-96)
   - Route: /bug-reports-log
   - Role gate: admin, master
   - Viewer for bug_reports; KPIs (Total / Open / AI Analyzed / Needs Human Review); issue_type/severity/status/date filters; AI analyzed icon + BrainCircuit; Mark Resolved action; expandable description, steps, expected/actual, ai_suggested_fix, resolution_notes; reads bug_reports (fully typed)

## Sprint 29 Route Addendum (2026-05-06)

New admin routes added in Sprint 29 (B-97, B-98, B-99):

1. Radio Transmission Log (B-97)
   - Route: /radio-transmissions-log
   - Role gate: admin, admin_officer, master, officer
   - Viewer for radio_transmissions (View in database.ts); KPIs (Total / Emergency / Active / Avg Duration); channel_type / emergency / date filters; floor_granted/released expand; metadata JSON expand

2. Open Shift Manager (B-98)
   - Route: /open-shifts (wired to new OpenShiftManager page)
   - Role gate: admin, admin_officer, master, officer
   - Manager for open_shifts; KPIs (Total / Open / Claimed+Filled / High Priority); status/shift_type/priority/date filters; Claim and Unclaim mutations; description/requirements expand

3. Noise Assessment Log (B-99)
   - Route: /noise-assessments-log
   - Role gate: admin, admin_officer, master
   - Viewer for noise_assessments; KPIs (Total / Exceeds Limit / Avg dB / Avg AI Confidence); noise_type/recommended_action/exceeds_district_plan/date filters; AI confidence bar; GPS/matrix scores/photos expand

## Sprint 30 Route Addendum (2026-05-06)

New admin routes added in Sprint 30 (B-100, B-101, B-102):

1. Trespass Notice Log (B-100)
   - Route: /trespass-notices-log
   - Role gate: admin, admin_officer, master
   - Viewer for trespass_notices; KPIs (Total/Active/Expired/Expiring Soon); status/notice_type/date filters; overdue highlight; legal_basis/notes/photos/witness expand

2. Parking Infringement Log (B-101)
   - Route: /parking-infringements-log
   - Role gate: admin, admin_officer, master
   - Viewer for parking_infringements; KPIs (Total/Outstanding/Paid/Revenue NZD); status/date/plate-search filters; payment info/dispute notes/court ref/PDF+photo links expand

3. Person Observation Log (B-102)
   - Route: /person-observations-log
   - Role gate: admin, admin_officer, master
   - Viewer for person_observations; KPIs (Total/Alert Generated/Avg Match Conf/Minor Records); obs_type/alert/date/plate-search filters; alert type badges; match confidence bar; GPS/metadata/evidence photos expand

## Sprint 31 Route Addendum (2026-05-06)

New admin routes added in Sprint 31 (B-103, B-104, B-105):

1. Vehicles of Interest Log (B-103)
   - Route: /vehicles-of-interest-log
   - Role gate: admin, admin_officer, master
   - Viewer for vehicles_of_interest; KPIs (Total/Active/Expired/Expiring Soon); status/date/plate-search filters; overdue highlight; description/notes/photos; linked person + primary zone expand

2. Persons of Interest Log (B-104)
   - Route: /persons-of-interest-log
   - Role gate: admin, admin_officer, master
   - Viewer for persons_of_interest; KPIs (Total/Active/Expired/Privacy Notice Given); status/date/name-search filters; overdue highlight; physical description/contact/distinguishing features/privacy lawful purpose/notes/photos expand

3. Photo Metadata Log (B-105)
   - Route: /photo-metadata-log
   - Role gate: admin, admin_officer, master
   - Viewer for photo_metadata; KPIs (Total Photos/Unique Users/SHA256 Verified/Avg Size KB); mime_type/date/file-name-search filters; MIME type badge; SHA256 hash display; storage path + view link expand

## Sprint 32 Route Addendum (2026-05-06)

New admin routes added in Sprint 32 (B-106, B-107, B-108):

1. Radio Comms Event Log (B-106)
   - Route: /radio-comms-events-log
   - Role gate: admin, admin_officer, master
   - Viewer for radio_comms_events; KPIs (Total/Escalated/Degraded Mode/Unique Cases); event_type enum filter + degraded_mode filter + date filter; event_type badge; callsign/channel; notes expand; fully typed enum

2. Case Comment Log (B-107)
   - Route: /case-comments-log
   - Role gate: admin, admin_officer, master
   - Viewer for case_comments; KPIs (Total Comments/Unique Cases/Unique Authors/Edited); date/case_id/author filters; edited badge; full comment text expand

3. LMR Bridge Session Log (B-108)
   - Route: /lmr-bridge-sessions-log
   - Role gate: admin, admin_officer, master
   - Viewer for lmr_bridge_sessions; KPIs (Total Sessions/Emergency/Avg Duration/With Transcript); direction/emergency/date filters; duration formatted; transcript text + audio link + metadata JSON expand
