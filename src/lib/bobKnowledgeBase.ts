/**
 * BOB_PROJECT_KNOWLEDGE
 *
 * Compiled from docs/ — feeds Bob the complete project context so every
 * conversation starts from an accurate, current understanding of the build.
 *
 * Injected as the first "assistant" message in every BobAssistantStudio
 * conversation (Format A messages array sent to onspace-ai-chat edge function).
 *
 * Update this file whenever major new capabilities, tables, or conventions land.
 * Last updated: 2026-04-04 from docs/ snapshot.
 */

export const BOB_PROJECT_KNOWLEDGE = `
# FieldOps Manager — Project Briefing for Bob Assistant
Compiled from authoritative build docs. Current as of April 2026.

---

## 1. What This Build Is

FieldOps Manager (also called FreedomCamp Manager) is a web-based admin control centre for freedom camping enforcement in New Zealand. Operated by Iron Eagle Security / OnSpace AI, it connects field officers, admin teams, and client organisations in real time.

Five core jobs:
1. Scan vehicles via camera/ALPR and evaluate compliance against zone rules
2. Manage breaches: alert queue, enforcement workflow, legally formatted notices (PDF)
3. Track officers: real-time GPS, welfare check-ins, shift management
4. Generate reports + evidence for councils, courts, and internal review
5. Run multiple organisations with full data isolation (one contractor, many council clients)

Delivered as a Progressive Web App (PWA): installable on any smartphone, works offline, no app store needed.

Relevant NZ legislation: Freedom Camping Act 2011, Local Government Act 2002, RMA 1991.

---

## 2. Tech Stack

Frontend: React 18, TypeScript, Vite, Tailwind CSS v3, shadcn/ui (Radix UI)
State: Zustand (src/stores/), TanStack Query v5
Forms: react-hook-form + zod
Charts: recharts
Routing: react-router-dom v6
Backend: Supabase (PostgreSQL + Edge Functions + RLS)
ALPR proxy: proxy-server/ (Node/Express, NZSCV lookup)
AI inference: inference-service/ (ONNX OCR, Node) deployed on Railway
Package manager: bun
Hosting: Vercel (frontend), Railway (inference + proxy), Supabase (DB + edge)

Path alias "@/*" maps to "./src/*". Always import Supabase client from "@/lib/supabase".

---

## 3. User Roles

Role "grand_master": Platform owner (Don Squires, squires.don@live.com). Cross-org access, no org_id restriction. Sees all organisations.
Role "master": Contractor-level admin. Full access within selected organisation.
Role "admin": Organisation admin. Manages their org's data, officers, zones.
Role "admin_officer": Hybrid — can use both Admin Portal and Field Officer Portal.
Role "officer": Field enforcement officer. Field Officer Portal only.
Role "nzscv_monitor": Read-only SCV register monitor.

IMPORTANT: grand_master and master users have organization_id = null. They use selectedOrganizationId from useGlobalFiltersStore for operational org context. Code that reads user.organization_id directly will fail for these roles.

Login flow: Login > portal selector (if admin_officer) > Admin Portal OR Field Officer Portal.

---

## 4. Key Frontend Structure

src/
  App.tsx — Router, ProtectedRoute, RoleRoute guards
  pages/ — 88 React page components
  components/
    ui/ — shadcn/ui primitives only (never re-implement)
    features/ — AppLayout, TeamChat, AiFeedbackChat, etc.
    layout/ — Navigation, sidebar
  hooks/ — useVehicles, usePatrols, useSessionGpsLogging, useBobCollaboration, etc.
  stores/ — authStore.ts, globalFiltersStore.ts, pttStore.ts, bobAssistantStore.ts
  lib/ — supabase.ts, bobCollaboration.ts, bobKnowledgeBase.ts, etc.
  types/ — database.ts (Supabase generated types), index.ts

State management layers:
- Zustand: auth, theme, PTT, device settings, offline queue
- TanStack Query: all Supabase data fetching with caching
- React Context: feature-scoped state (form wizards, compound components)
- useState/useReducer: local UI state

---

## 5. Core Database Tables (live, authoritative)

Table "observations"
Primary key: observation_id (uuid). Key fields: plate_number, zone_id, organization_id, recorded_by, recorded_at, is_compliant, is_breach, breach_type, breach_reason, consecutive_nights, nights_stayed_this_month, compliance_snapshot (jsonb), photo, gps_latitude, gps_longitude, processing_status, has_discrepancies.
DO NOT USE: compliance_summary (use compliance_snapshot), image_url (use photo or photo_url), weather_conditions (column does not exist).

Table "canonical_vehicles"
Primary key: plate_number (text). Stable identifier: vehicle_id (uuid). Tracks vehicle stats across all orgs. NOT org-scoped.
V3 BREAKING: self_contained is no longer authoritative — use canonical_scv.is_self_contained. homeless_status is no longer authoritative — use canonical_homeless.status.
DO NOT USE: id, make, model, colour (use vehicle_color), year (use vehicle_year). vehicle_year is INTEGER.

Table "canonical_scv"
PK: plate_number. Fields: is_self_contained (bool), certificate_expiry (date), source (scv_list|nzscv_api|photo_analysis|manual), verified_at. Global registry, not org-scoped. A missing row = "unknown" not "false".

Table "canonical_homeless"
PK: plate_number. Fields: status (confirmed|suspected|cleared|unknown), confirmed_by, source, notes. Global registry.

Table "breach_alerts"
PK: id. Fields: organization_id, zone_id, plate_number, observation_id, breach_type (consecutive_nights|monthly_limit|self_contained|after_hours|day_visit_violation|allowed_days_violation), status (pending|acknowledged|enforcement_started|resolved|dismissed).
DO NOT USE: resolved_by (use admin_reviewed_by).

Table "zones"
PK: id. Fields: name, organization_id, status (active|inactive|day_visit_only), compliance rules (max_consecutive_nights, monthly_night_limit, requires_self_contained, etc.), geometry (PostGIS polygon), zone_type, parent_zone_id.
Zone uniqueness: unique partial index on (organization_id, lower(name)).

Table "user_profiles"
PK: id (= auth.users.id). Fields: role, organization_id, employer_organization_id, last_gps_latitude, last_gps_longitude, last_gps_update, coa_number, coa_expiry, has_warrant, credentials_verified, compliance_status.

Table "organizations"
Fields: name, parent_organization_id, organization_level, organization_type (client|contractor), overnight_verification_mode.

Table "officer_shifts / patrols"
Shift lifecycle. patrols has schedule jsonb and patrol_schedule_zones junction for multi-zone patrol assignment. get_patrol_kpis() RPC for analytics.

Table "infringement_notices"
Canonical fields: amount_cents (integer, in cents), due_date (DATE), created_by (UUID). Legacy fields fee_amount, payment_deadline, issued_by exist for backward compat only — do not use in new code.

Other notable tables: compliance_results, incident_reports, canonical_persons, person_vehicle_links, dispute_intake, vehicle_discrepancies, patrol_schedule_zones, flagged_vehicles, audit_log, notifications, zone_legal_config, enforcement_cases, notice_artifacts, bob_policy_controls, rate_limit_entries.

---

## 6. Key RPC Functions

calculate_vehicle_compliance_v3(plate, zone_id, date, obs_id, obs_time): Full compliance evaluation. Returns is_compliant, breach_type, nights, matrix snapshot.
check_vehicle_compliance_v3(plate, zone_id, ...): Lightweight compliance check for real-time UI (security_definer).
check_organization_compliance(user_id): Can this officer work? Returns can_work + missing_items.
log_officer_gps_update(officer_id, lat, lng, accuracy, org_id): GPS write path for officer location tracking.
get_live_officer_locations(p_organization_id): Returns live officer GPS. Columns: last_gps_latitude, last_gps_longitude, last_gps_update, last_scan_zone, recent_scans.
get_patrol_kpis(org_id, date_range): Patrol performance KPIs.
get_zone_compliance_breakdown(org_id): Compliance stats by zone, returns zone_type + parent_zone_id.
safe_insert_observation(...): Idempotent observation insert.
set_org_geometry(org_id, geojson): Set org boundary polygon.
recompute_all_compliance_since_effective_date(date): Batch compliance recompute.

GPS FIELD NAMES — hardened migration 20260604000001 renamed fields:
OLD (wrong): zone_name, gps_latitude (on user_profiles), activity_type, last_activity_at
NEW (correct): last_scan_zone, last_gps_latitude, last_gps_longitude, last_gps_update, recent_scans

---

## 7. Supabase Edge Functions (key ones)

onspace-ai-chat: Bob / AI chat. Uses INFERENCE_SERVICE_URL pointing to Bob inference service (RunPod).
plate-scanner-photo-first: Layer 1 scan ingest (v2 pathway, FEATURE_INGEST_V2).
plate-scanner-complete: Legacy scan ingest (v1).
recalculate-compliance-v3: Triggers compliance recalc for a plate/zone.
generate-incident-pdf / generate-notice-to-vacate: PDF generation.
ptt-signaling-token: Push-to-talk JWT token. Requires PTT_SERVER_URL secret to be set.
sync-scv-list: Bulk import NZ SCV register into canonical_scv.
check-nzscv-status: Live NZSCV lookup via proxy-server.
process-homeless-data: Import/update canonical_homeless records.
submit-dispute-intake: Receive public dispute form submissions.
monitor-officer-welfare: Welfare check scheduling and alerts.
send-invite-email: Officer/admin invite emails.
nightly-privacy-cleanup: GDPR/Privacy Act data purge jobs.

CORS pattern required in all edge functions:
  import { withCors, getCorsHeaders } from "../_shared/withCors.ts"
  if (req.method === "OPTIONS") return new Response("ok", { headers: getCorsHeaders(req) })

---

## 8. External Services

Bob inference service (RunPod): ONNX OCR + /chat endpoint (inference-service/ folder).
Railway proxy-server: NZSCV API proxy, MotorWeb proxy (proxy-server/ folder).
ParkPow: ALPR session/violation sync (supabase/functions/parkpow-sync).
Vercel: Frontend hosting (vercel.json).
Supabase: DB, Auth, Edge Functions, Storage.

Required env vars for AI: INFERENCE_SERVICE_URL (Bob RunPod URL), INFERENCE_API_KEY (optional).
For PTT: PTT_SERVER_URL.
If not set, both show "Unable to reach Edge Function" errors — this is a backend config issue, not a code bug.

---

## 9. Scanning Pipeline

Three scan modes:
1. Detail Scan: single vehicle, 3-stage ALPR (local pattern match > ONNX OCR > compliance check), ~3 seconds.
2. Bulk Scan: sequential multi-vehicle, results appear in real time.
3. Zoom Scan: telephoto for distant plates (20-50m).

Offline mode: scans queue locally, auto-sync on reconnect. Shown as "Queued (offline)" amber badge.

After scan result: compliance badge (green/red/amber), homeless badge (purple), actions: Warning, Notice to Vacate, Infringement, Print Ticket.

---

## 10. Notice Types

Warning Notice: first contact, no fine.
Notice to Vacate: must leave zone within timeframe.
Infringement Notice: formal fine under bylaw.
Seizure Receipt: documents property seizure.

PDFs generated by edge function, stored in Supabase Storage "notice-artifacts" bucket, linked to observation indefinitely.

---

## 11. Bob Collaboration Bridge (meta-knowledge)

Bob can act as a sub-agent for other parts of the system via src/lib/bobCollaboration.ts and src/hooks/useBobCollaboration.ts.

publishBobCollaborationPacket(packet): any page sends Bob a structured task.
useBobCollaboration() hook: pages call askBob({title, prompt, source, autoSubmit, returnRoute}) and receive bobResponse when Bob has answered.
autoSubmit: true means Bob auto-processes the prompt without user interaction.
returnRoute: shows a "Return" button so the user can navigate back after Bob answers.
Response event: BOB_RESPONSE_READY CustomEvent fires in the same browser tab, carrying requestId.

If Bob receives a collaboration packet, he processes it fully and publishes the response. The originating page receives responseText automatically.

---

## 12. Key Build Conventions

- All datetimes: NZ timezone (Pacific/Auckland). Supabase client sends X-Client-Timezone: Pacific/Auckland header.
- TypeScript config: noImplicitAny: false, strictNullChecks: false, skipLibCheck: true. Do NOT tighten these settings.
- Supabase client: always import from "@/lib/supabase".
- Database types: Database["public"]["Tables"]["table_name"]["Row"] from "@/types/database".
- Never re-implement shadcn/ui primitives — always import from "@/components/ui/".
- Feature components go in "@/components/features/".
- Build command: bun run build. Lint: bun run lint.
- Migrations naming: YYYYMMDDHHMMSS prefix, never duplicate timestamps.

---

## 13. Pending / Known Issues (April 2026)

- PTT offline: PTT_SERVER_URL not set in Supabase Edge Function secrets. Config fix needed by Don.
- AI offline: INFERENCE_SERVICE_URL not set. Bob's RunPod URL must be set in Supabase secrets.
- 65/72 edge functions use wildcard CORS (cors.ts vs withCors.ts) — security hardening in progress.
- USING (true) RLS policies on some sensitive tables — partial fix in migration, audit ongoing.
- Conversation history was not being sent to onspace-ai-chat (history field name mismatch: client sent "history", edge function reads "messages") — fixed by switching to Format A messages array.
- Officer portal completeness: ~70%. Noise control: 65%. Parking: 50%. Site Guard: 35%.
- CRM module: 20+ tables exist but 0% frontend usage — remove or complete.
- Officer welfare edge function: not yet wired to a cron schedule.

---

## 14. Current Build Metrics

Schema last verified: 2026-04-25 (migration 20260425000001)
Live row counts: observations 30,789 / canonical_vehicles 61,535 / zones 3,731 / breach_alerts 1,484 / user_profiles 7 / compliance_results 1,959
Build: 88 React pages, 72 edge functions, 180+ DB tables, 200+ migrations
`
