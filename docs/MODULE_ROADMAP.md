# Module Roadmap (Operator Navigation Map)

Date: 2026-05-07 (verified against src/navigation/routeManifest.ts)
Source of truth for routes: route manifest file src/navigation/routeManifest.ts (187 route manifest entries as of Sprint 41 completion)

 > **Last Verification**: 2026-05-07 — Role-gating and route docs reviewed through Sprint 42 (B-138). Production main includes Sprints 31-42.

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

## Sprint 33 Route Addendum (2026-05-06)

New admin routes added in Sprint 33 (B-109, B-110, B-111):

1. Patrol Session Event Log (B-109)
   - Route: /patrol-session-events-log
   - Role gate: admin, admin_officer, master
   - Viewer for patrol_session_events; KPIs (Checkpoints Scanned/Missed/Patrols Started/Completed); typed event_type enum filter + date + officer search; missed checkpoint row highlight; notes/patrol_route_instance_id expand

2. Radio Transcript Log (B-110)
   - Route: /radio-transcript-log
   - Role gate: admin, admin_officer, master
   - Viewer for radio_transcript_segments (View, org_id scope); KPIs (Total/Final/Avg Confidence/Unique Transmissions); is_final/language/date filters; confidence bar; full text + segment timestamps expand

3. Dispute Intake Log (B-111)
   - Route: /dispute-intake-log
   - Role gate: admin, admin_officer, master
   - Viewer for dispute_intake; KPIs (Total/Open/Homeless Review Req/Unique Plates); status/source_type/date + plate/claimant search filters; status+source_type badges; message/evidence/hardship/admin_notes expand

## Sprint 34 Route Addendum (2026-05-07)

New admin routes added in Sprint 34 (B-112, B-113, B-114):

1. Radio TTS Render Log (B-112)
   - Route: /radio-tts-render-log
   - Role gate: admin, admin_officer, master
   - Viewer for radio_tts_renders (View, org_id scope); KPIs (Total/Synthetic/Avg Latency/Providers); provider/language/synthetic filters; translation segment and voice profile detail expand

2. Health Safety Report Log (B-113)
   - Route: /health-safety-report-log
   - Role gate: admin, admin_officer, master
   - Viewer for health_safety_reports; KPIs (Total/High+/Open/Incident Types); severity/status/type filters; description and zone metadata expand

3. Noise Seizure Log (B-114)
   - Route: /noise-seizures-log
   - Role gate: admin, admin_officer, master
   - Viewer for noise_seizures; KPIs (Total/Estimated Value/Police Present/With Photos); status/equipment filters; seizure details and photos expand

## Sprint 35 Route Addendum (2026-05-07)

New admin routes added in Sprint 35 (B-115, B-116, B-117):

1. Locations of Interest Log (B-115)
   - Route: /locations-of-interest-log
   - Role gate: admin, admin_officer, master
   - Viewer for locations_of_interest; KPIs (Total/Active/Canonical/With Hazards); kind/active/canonical/city/name filters; hazard and geocoder detail expand

2. Vehicle Monthly Stay Log (B-116)
   - Route: /vehicle-monthly-stays-log
   - Role gate: admin, admin_officer, master
   - Viewer for vehicle_monthly_stays; KPIs (Records/Total Nights/Consecutive>=3/Zones); month/plate filters; observation ids and reset metadata expand

3. Radio Voice Consent Log (B-117)
   - Route: /radio-voice-consent-log
   - Role gate: admin, admin_officer, master
   - Viewer for radio_voice_consents (View, org_id scope); KPIs (Total/Active/Revoked/Avg Retention); provider/revoked/date filters; consent purpose and revocation reason expand

## Sprint 36 Route Addendum (2026-05-07)

New admin routes added in Sprint 36 (B-118, B-119, B-120):

1. Patrol Field Event Log (B-118)
   - Route: /patrol-field-events-log
   - Role gate: admin, admin_officer, master
   - Viewer for patrol_events; KPIs (Total/With GPS/With Photos/Statuses); event/status/patrol type filters; observation and photo evidence expand

2. Alert Queue Log (B-119)
   - Route: /alert-queue-log
   - Role gate: admin, admin_officer, master
   - Viewer for alert_queue; KPIs (Total/Acknowledged/Requires Ack/Types); type/status/priority filters; acknowledge action; details JSON expand

3. Compliance Result Log (B-120)
   - Route: /compliance-results-log
   - Role gate: admin, admin_officer, master
   - Viewer for compliance_results; KPIs (Total/Compliant/Exempt/After-hours Violations); compliant/exempt/violation filters; matrix and reason detail expand

## Sprint 37 Route Addendum (2026-05-07)

New admin routes added in Sprint 37 (B-121, B-122, B-123):

1. Welfare Events Log (B-121)
   - Route: /welfare-events-log
   - Role gate: admin, admin_officer, master
   - Viewer for welfare event stream and officer welfare follow-up history.

2. Zone Geofence Snapshots (B-122)
   - Route: /zone-geofence-snapshots
   - Role gate: admin, admin_officer, master
   - Snapshot viewer for zone geofence state and boundary change checkpoints.

3. Feature Flags (B-123)
   - Route: /feature-flags
   - Role gate: master
   - Feature flag administration surface for controlled production rollout.

## Sprint 38 Route Addendum (2026-05-07)

New admin routes added in Sprint 38 (B-124, B-125, B-126):

1. Feature Flag Evaluation Log (B-124)
   - Route: /feature-flag-evaluations-log
   - Role gate: master
   - Viewer for feature_flag_evaluations; KPIs (Total/Enabled/Disabled/Unique Flags); enabled/flag_id/date filters; evaluation_context JSON and rollout_bucket expand

2. Feature Flag Rollout Log (B-125)
   - Route: /feature-flag-rollout-log
   - Role gate: master
   - Viewer for feature_flag_rollout_history; KPIs (Total/Increases/Rollbacks/Unique Flags); flag_id/stage/date filters; change_reason, monitoring_notes, error_rate, p95_latency expand

3. Missing Photo Queue (B-126)
   - Route: /missing-photo-queue
   - Role gate: admin, admin_officer, master
   - Viewer for missing_photo_queue; KPIs (Total/Pending/Failed/Resolved); status/plate/date filters; attempted_hash, original_photo_url, repair_notes expand

## Sprint 39 Route Addendum (2026-05-07)

New admin routes added in Sprint 39 (B-127, B-128, B-129):

1. Photo Integrity Health (B-127)
   - Route: /photo-integrity-health-log
   - Role gate: admin, admin_officer, master
   - Viewer for photo_integrity_health; KPIs (Rows/Avg Coverage/Missing Hash/Missing URL); org/min coverage filters

2. Photo Recovery Audit Log (B-128)
   - Route: /photo-recovery-audit-log
   - Role gate: admin, admin_officer, master
   - Viewer for photo_recovery_audit_log; KPIs (Total/Succeeded/Failed/Unique Plates); success/action/plate/date filters; error/meta expand

3. User Sessions Log (B-129)
   - Route: /user-sessions-log
   - Role gate: master
   - Viewer for user_sessions; KPIs (Total/Active 24h/Platforms/Named Devices); platform/user/date filters

## Sprint 40 Route Addendum (2026-05-07)

New admin routes added in Sprint 40 (B-130, B-131, B-132):

1. Recent Observation Photo Status (B-130)
   - Route: /recent-observations-photo-status-log
   - Role gate: admin, admin_officer, master
   - Viewer for recent_observations_photo_status; KPIs (Total/Healthy/Missing Hash/Missing URL); status/plate/date filters

2. Observation Zone Audit Log (B-131)
   - Route: /observation-zone-audit-log
   - Role gate: admin, admin_officer, master
   - Viewer for v_observation_zone_audit; KPIs (Total/Correct/Mismatched/Legacy); assignment/legacy/plate/date filters; zone assignment detail expand

3. User Deactivation Queue Log (B-132)
   - Route: /user-deactivation-queue-log
   - Role gate: master
   - Viewer for user_deactivation_queue; KPIs (Total/Processed/Pending/Errors); processed/action/user/date filters; error detail expand

## Sprint 41 Route Addendum (2026-05-07)

New admin routes added in Sprint 41 (B-133, B-134, B-135):

1. Alert Acknowledgements Log (B-133)
   - Route: /alert-acknowledgements-log
   - Role gate: admin, admin_officer, master
   - Viewer for alert_acknowledgements; KPIs (Total/Follow-up/Evidence/Reports); type/follow-up/user/date filters

2. Officer Welfare Alerts Log (B-134)
   - Route: /officer-welfare-alerts-log
   - Role gate: admin, admin_officer, master
   - Viewer for officer_welfare_alerts; KPIs (Total/Open/Resolved/Escalated); status/type/officer filters

3. Vehicle Migration Log (B-135)
   - Route: /vehicle-migration-log
   - Role gate: master
   - Viewer for vehicle_migration_log; KPIs (Total/Runs/Canonical-linked/Legacy-linked); action/plate/run/date filters

## Sprint 42 Route Addendum (2026-05-07)

New admin routes added in Sprint 42 (B-136, B-137, B-138):

1. Observation Deletion Log (B-136)
   - Route: /observation-deletions-log
   - Role gate: admin, master
   - Viewer for observation_deletions; KPIs (Total/With Reason/Unique Zones/Unique Plates); plate/user/date filters; snapshot JSON expand

2. Dispatch Resources Log (B-137)
   - Route: /dispatch-resources-log
   - Role gate: admin, admin_officer, master
   - Viewer for dispatch_resources; KPIs (Total/Active/Auto-Dispatch/Scheduling On); kind/status/search filters; config expand

3. Radio Translation Log (B-138)
   - Route: /radio-translation-log
   - Role gate: admin, admin_officer, master
   - Viewer for radio_translation_segments view; KPIs (Total/Low Confidence/Avg Confidence/Languages); language/provider/date/search filters

## Production Status Snapshot (2026-05-07)

- Branch: main
- PR state (base main): 0 open
- Consolidation status: Sprint 31 through Sprint 42 route work is merged to production main

## Post-Sprint-42 Realignment Phases and Phase-Gate Progression (#548)

With Sprint 42 route consolidation complete, execution progresses from route expansion to realignment phase delivery and gate-based progression.

Gate status definition:
- **Green gate** = all listed criteria for that phase are met and verified with documented evidence in staging/CI artifacts.
- Evidence location standard: record gate evidence in the existing `docs/STAGING.md` file (present in this repository) and attach/reference the related GitHub Actions run URLs and test artifact links.

Phase baseline:
- **Phase A context** = foundational realignment work and prerequisites already defined in `docs/BUILD_REALIGNMENT_PLAN_2026-05-04.md` sections 11.2a and 12.1; this roadmap now tracks progression from the Phase B entry point onward.
- If that file is renamed or superseded, use the latest `docs/BUILD_REALIGNMENT_PLAN*.md` document and its Phase A acceptance + gate criteria sections as the source of truth.

1. **Phase B — Consolidate Core Operational Flows**
   - Scope: Patrol/Dispatch/Enforcement consolidation, callsign/PTT runtime binding, geofence route event persistence.
   - Exit gate to Phase C:
     - Phase A gate remains green (org isolation tests passing, case/event contract published, bootstrap routes passing, feature-flag rollback tested, ownership assignments confirmed).
     - Patrol, Dispatch, and one enforcement surface run on shared timeline contract in staging.
     - Callsign binding and dispatch acknowledgement flows are executable end-to-end.
     - Ownership and support rota are assigned for active slices.

2. **Phase C — Consolidate Specialist and Assistive Layers**
   - Scope: Site guard/security operations, identity/risk modules, POI/VOI/LOI, assets/keys/client integration surfaces.
   - Exit gate to Phase D:
     - Phase B gate is green.
     - Security assistive surfaces resolve people/vehicle/place context from shared contracts.
     - Site guard and assistive workflows attach to the same case/timeline model.

3. **Phase D — Consolidate Bob, Translation, and Transition Systems**
   - Scope: Bob approval contracts, speech/translation boundaries, active-org transition, handshake/offline/reconnect hardening.
   - Exit gate to Phase E:
     - Phase C gate is green.
     - Bob approval, translation, and transition services are auditable and degraded-mode safe.
     - Offline replay conflict handling passes defined test scenarios.

4. **Phase E — Data Movement Reduction and Enterprise Hardening**
   - Scope: page-query reduction, hook/service migration, audit dashboards, event completeness checks, comms delivery governance.
   - Completion gate:
     - Phase D gate is green.
     - Target fragmentation pages show downward direct-query drift.
     - Communications delivery audit and retry metrics are visible in operations dashboards.

## Next Phase Continuation — Phase B Kickoff

Phase B is the immediate execution phase after post-Sprint-42 planning alignment.

1. **Phase B Entry Check (Go/No-Go)**
   - Confirm Phase A gate remains green using the Phase A baseline source in `docs/BUILD_REALIGNMENT_PLAN_2026-05-04.md` (sections 11.2a and 12.1).
   - Confirm ownership/support rota for B1–B4 slices is assigned and active.
   - Confirm feature-flag rollout + rollback controls are ready for every Phase B slice.

2. **Phase B Delivery Order**
   - B1: Patrol and Respond
   - B2: Dispatch and Command
   - B3: Communications (callsign/PTT runtime linkage)
   - B4: Freedom Camping + Parking

3. **Phase B Progression Checkpoints**
   - **Checkpoint 1 (B1 complete)**: patrol route/checkpoint/welfare events persist on shared timeline contract.
   - **Checkpoint 2 (B2 complete)**: dispatch intake/assignment/acknowledgement is end-to-end on shared contract.
   - **Checkpoint 3 (B3 complete)**: callsign binding and dispatch-to-radio escalation flows are operational.
   - **Checkpoint 4 (B4 complete)**: at least one enforcement surface is fully on the shared timeline contract.

4. **Phase B Exit to Phase C**
   - All Phase B gate criteria are green (per build realignment gate definitions).
   - Evidence is recorded in `docs/STAGING.md` with linked CI runs and validation artifacts.

## Next Phase Continuation — Phase C Kickoff

With Phase B delivery and gate evidence in place, the next execution phase is Phase C.

1. **Phase C Entry Check (Go/No-Go)**
   - Confirm Phase B gate is green against `docs/BUILD_REALIGNMENT_PLAN_2026-05-04.md` section 12.1 criteria.
   - Confirm specialist/assistive ownership rota is active for C1–C4 slices.
   - Confirm shared case/timeline contract remains the integration baseline for all Phase C slices.

2. **Phase C Delivery Order (per 11.1 / 11.1a)**
   - C1: Site Guard and Security Operations
   - C2: Identity and Risk (Access Control, Face Recognition, Identity Verification, Site Risk)
   - C3: Intelligence Data (POI/VOI/LOI, evidence capture, alert queues)
   - C4: Client Services (Assets, Keys, Client/Contact/Service Agreement, reporting integration)

3. **Phase C Progression Checkpoints**
   - **Checkpoint 1 (C1 complete)**: site guard/static guard workflows and emergency assist attach to shared case/timeline contracts.
   - **Checkpoint 2 (C2 complete)**: identity/risk surfaces resolve people, vehicle, and place context from shared contracts.
   - **Checkpoint 3 (C3 complete)**: intelligence surfaces (POI/VOI/LOI/evidence/alerts) are contract-backed and org-scoped.
   - **Checkpoint 4 (C4 complete)**: client services surfaces attach assets/keys/client/service data to the same operational contract model.

4. **Phase C Exit to Phase D**
   - All Phase C gate criteria are green (per build realignment gate definitions).
   - Evidence is recorded in `docs/STAGING.md` with linked CI runs and validation artifacts.

## Next Phase Continuation — Phase D Kickoff

With Phase C delivery and gate evidence in place, the next execution phase is Phase D.

1. **Phase D Entry Check (Go/No-Go)**
   - Confirm Phase C gate is green against `docs/BUILD_REALIGNMENT_PLAN_2026-05-04.md` section 12.1 criteria.
   - Confirm Bob, translation, and transition ownership rota is active for D1–D3 slices.
   - Confirm degraded-mode behaviour for Bob and translation surfaces is defined before implementation begins.

2. **Phase D Delivery Order (per 11.1 / 11.1a)**
   - D1: Bob Approval Contracts and Proposal / Audit Pathways
   - D2: Translation / Speech Runtime Boundaries and Degraded-Mode Controls
   - D3: Active-Org Transition Services, Hybrid Handshake, Offline Replay and Reconnect Hardening

3. **Phase D Progression Checkpoints**
   - **Checkpoint 1 (D1 complete)**: Bob approval, proposal, and audit contract outputs are traceable and governed end-to-end.
   - **Checkpoint 2 (D2 complete)**: translation/speech services are bounded, degraded-mode safe, and produce auditable synthetic-audio outputs.
   - **Checkpoint 3 (D3 complete)**: active-org transitions, hybrid handshakes, and offline-replay conflict resolution pass defined test scenarios.

4. **Phase D Exit to Phase E**
   - All Phase D gate criteria are green (per build realignment gate definitions).
   - Evidence is recorded in `docs/STAGING.md` with linked CI runs and validation artifacts.

## Next Phase Continuation — Phase E Kickoff

With Phase D delivery and gate evidence in place, the next execution phase is Phase E.

1. **Phase E Entry Check (Go/No-Go)**
   - Confirm Phase D gate is green against `docs/BUILD_REALIGNMENT_PLAN_2026-05-04.md` section 12.1 criteria.
   - Confirm ownership/support rota is active for E1–E4 slices.
   - Confirm target high-fragmentation pages and dashboard acceptance criteria are agreed before implementation starts.

2. **Phase E Delivery Order**
   - E1: Direct page-query reduction baseline and targets.
   - E2: Hook/service migration for highest-fragmentation surfaces.
   - E3: Audit dashboard completeness for operational and contract events.
   - E4: Communications delivery governance (retry visibility and accountability).

3. **Phase E Progression Checkpoints**
   - **Checkpoint 1 (E1 complete)**: baseline vs current direct-query drift is published for target pages.
   - **Checkpoint 2 (E2 complete)**: migrated surfaces consume shared hook/service contracts.
   - **Checkpoint 3 (E3 complete)**: audit completeness and event integrity checks are green.
   - **Checkpoint 4 (E4 complete)**: communications delivery and retry metrics are visible in operations dashboards.

4. **Phase E Completion Gate**
   - Phase D gate remains green while E changes land.
   - Target fragmentation pages show downward direct-query drift.
   - Communications delivery governance is live and measurable in operations dashboards.
   - Evidence is recorded in `docs/STAGING.md` with linked CI runs and validation artifacts.

## Phase E1 Data-Access Consolidation Baseline (2026-05-08)

Phase E1 starts with a static direct-query drift gate for the highest-fragmentation pages named in the build realignment plan. The baseline counts below are grounded in the current page files and are enforced by `tests/e2e/phase-e1-data-access-consolidation.spec.ts`; future hook/service migrations should lower the relevant baseline only after the page count drops.

Reduction evidence: `BreachAlerts` has been lowered to 0 through breach hook consolidation. `VehicleManagement` lowered from 21 to 14 by moving dialog observation list reads, zone/org name enrichment, photo-column detection, observation photo lookup, MotorWeb update, and flag toggle into `src/hooks/useVehicles.ts`. `AdminPortal` lowered from 20 to 0 by moving recent historical observations, welfare alerts, active patrol counts, today roster reads into `src/hooks/useAdminPortalData.ts`, and the primary dashboard useQuery (16 calls) into `useAdminPrimaryDashboard`. `FieldOfficerPortal` lowered from 15 to 11 by moving SOS welfare alert insert, notification mark-read, and officer shift start/end mutations into `src/hooks/useFieldOfficerMutations.ts`. `NoiseControlPortal` lowered from 13 to 0 by extracting all reads and mutations into `src/hooks/useNoiseControl.ts`.

| Target page | Current direct `supabase.from(...)` calls | Phase E1 target |
| --- | ---: | --- |
| PTTRadio | 3 | Hold at or below baseline while shared radio hooks remain the data boundary. |
| DispatchConsole | 3 | Hold at or below baseline while dispatch contract hooks absorb new reads. |
| FieldOfficerPortal | 0 | All reads/mutations extracted into useFieldOfficerData + useFieldOfficerMutations hooks (11 → 0). |
| AssetManagement | 0 | Keep page free of direct Supabase query clusters. |
| VehicleManagement | 0 | All vehicle-list reads extracted into useVehicleListQuery in useVehicles.ts (14 → 0). |
| BreachAlerts | 0 | Keep page free of direct Supabase query clusters after breach hook consolidation. |
| AdminPortal | 0 | Primary dashboard useQuery extracted into useAdminPrimaryDashboard hook (16 → 0). |
| NoiseControlPortal | 0 | All reads and mutations extracted into useNoiseControl hooks (13 → 0). |
| ClientAccountPage | 0 | Keep page free of direct Supabase query clusters. |
| RosterPlanner | 0 | Keep page free of direct Supabase query clusters. |

Phase E1 gate artifacts:
- Test spec: `tests/e2e/phase-e1-data-access-consolidation.spec.ts`
- CI workflow: `.github/workflows/ci-phase-e1-data-access-consolidation-gate.yml`
- Local command: `bunx playwright test tests/e2e/phase-e1-data-access-consolidation.spec.ts --config=playwright.api.config.ts --reporter=list`
