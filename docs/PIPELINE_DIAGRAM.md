# FieldOps Manager — Pipeline & Wiring Diagrams

> **How to read these diagrams**
> - `→` means data/request flows in this direction
> - `⟶` means an async/fire-and-forget call
> - `═►` means a database trigger fires automatically
> - `⏰` means triggered by a scheduled cron job
> - Boxes in `[...]` are database tables
> - Boxes in `{...}` are Supabase Edge Functions
> - Boxes in `(...)` are external services or Railway apps

---

## Diagram 1 — Physical Deployment Topology

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           OFFICER'S PHONE / BROWSER                         │
│                                                                             │
│   React SPA (Vite)  ──  PWA / Service Worker  ──  IndexedDB Offline Queue  │
└───────────────────────────────┬─────────────────────────────────────────────┘
                                │  HTTPS
                                ▼
┌───────────────────────────────────────────────────────────────────────────────┐
│                          SUPABASE (Managed Cloud)                             │
│                                                                               │
│  ┌─────────────────┐   ┌──────────────────┐   ┌────────────────────────────┐ │
│  │  PostgREST API  │   │  Auth (JWT)      │   │  Storage Buckets           │ │
│  │  (REST + RLS)   │   │  GoTrue          │   │  scans / evidence /        │ │
│  └────────┬────────┘   └──────────────────┘   │  incident-evidence /       │ │
│           │                                    │  credentials               │ │
│  ┌────────▼──────────────────────────────┐     └────────────────────────────┘ │
│  │         PostgreSQL 15                 │                                    │
│  │  + pgvector  + postgis  + pg_cron     │                                    │
│  │  + Row Level Security (all tables)    │                                    │
│  └────────────────────────────────────── ┘                                    │
│                                                                               │
│  ┌────────────────────────────────────────────────────────────────────────┐   │
│  │                   Supabase Edge Functions (Deno)                       │   │
│  │  47 functions — invoked by: browser JS, pg_cron HTTP, other functions  │   │
│  └──────────────────────────────────────────────────────────────────────── ┘  │
└──────────────┬──────────────────────────────────┬─────────────────────────────┘
               │  HTTPS + X-Proxy-Secret           │  HTTPS
               ▼                                   ▼
┌──────────────────────────┐          ┌────────────────────────────┐
│  proxy-server (Railway)  │          │  inference-service         │
│  Node / Express          │          │  (Railway)                 │
│                          │          │  Node / Express + ONNX     │
│  GET  /health            │          │                            │
│  POST /api/nzscv/…       │          │  POST /infer  (multipart)  │
│  GET  /motorweb/…        │          │  GET  /health              │
└──────────┬───────────────┘          └────────────┬───────────────┘
           │                                       │
     ┌─────▼────┐                         ┌────────▼────────┐
     │  NZSCV   │                         │  YOLOv8n (ONNX) │
     │  API     │                         │  MobileNetV3    │
     │  (NZ     │                         │  (ONNX)         │
     │  Govt)   │                         └─────────────────┘
     └──────────┘

           Other external services (called directly by Edge Functions):
           ┌─────────────────────┐  ┌─────────────────────┐  ┌──────────────┐
           │  Plate Recognizer   │  │  Expo Push API      │  │  ParkPow API │
           │  api.platerecognizer│  │  exp.host/api/v2/…  │  │  parkpow.io  │
           │  .com/v1/plate-reader│  └─────────────────────┘  └──────────────┘
           └─────────────────────┘
```

---

## Diagram 2 — ALPR Scan Pipeline (Core Workflow)

```
OFFICER (phone)
     │
     │  1. Taps "Open Scanner"
     │  2. Photo taken by CameraCapture component
     │
     ▼
[FieldOfficerPortal.tsx: handleCapture()]
     │
     ├─► GPS location (navigator.geolocation)
     ├─► Weather call ⟶ {get-weather} → OpenWeatherMap API → returns conditions
     │
     │  3. Upload photo to Supabase Storage
     ▼
(scans bucket)  ← file stored as {user_id}/{timestamp}-{hash}.jpg
     │
     │  returns public URL
     ▼
     │  4. If GPS is outside all zone geofences:
     │     ──► RPC ensure_other_location_zone(org_id)
     │         [zones] get-or-create "Other Location" zone
     │
     │  5. Insert observation (FAST SAVE — AI not yet run)
     ▼
[observations]
  plate_number = 'PROCESSING...'
  processing_status = 'pending'
  photo_url = <url>
  gps_latitude/longitude = <from GPS>
  zone_id = <from geofence or Other Location>
  recorded_by = officer.id
     │
     │  ════════════════════════════════════════════
     │  DATABASE TRIGGER: update_observations_updated_at
     │  ════════════════════════════════════════════
     │
     │  6. Fire-and-forget (officer sees success toast, can scan next vehicle)
     ⟶
     ▼
{alpr-process} Edge Function
     │
     │  Mode: UPDATE (observation_id provided)
     │
     ├─ Downloads photo_url
     │
     ├─ STAGE 1: Plate Recognizer API (primary)
     │      POST api.platerecognizer.com/v1/plate-reader/
     │      → plate_number, confidence, vehicle make/model/colour
     │      → On success: stage = 'platerecognizer'
     │
     ├─ STAGE 2: Railway Inference Service (always runs for embedding)
     │      POST inference-service /infer (multipart photo)
     │      → vehicle_embedding (384-D MobileNetV3 vector)
     │      → sticker_presence / sticker_color (NZSCV sticker detection)
     │      → movement_moved (vs previous_observation_id if provided)
     │      → If Plate Recognizer missed plate: use inference plate as fallback
     │      → embedding_quality, embedding_model_version
     │
     ├─ STAGE 3: MANUAL_REQUIRED fallback (if both APIs fail)
     │      plate_number = 'MANUAL_REQUIRED'
     │      processing_status = 'failed'
     │
     │  After pipeline completes:
     ├─ UPDATE [observations]
     │      plate_number = <extracted plate>
     │      vehicle_make / vehicle_model / vehicle_colour
     │      vehicle_embedding = <384-D vector>
     │      sticker_presence, sticker_color, sticker_bbox
     │      movement_moved, movement_decision
     │      processing_status = 'complete' (or 'failed')
     │
     ├─ UPSERT [canonical_vehicles]
     │      Create or update vehicle record for this plate
     │
     └─► (async) {check-nzscv-status}
              → proxy-server /api/nzscv/vehicle-info
              → NZSCV API (IP-whitelisted static IP)
              → returns CertificateStatus (Current/Expired/Revoked)
              → UPDATE [canonical_vehicles].is_self_contained
```

---

## Diagram 3 — Compliance Engine (Database Trigger Chain)

```
[observations] INSERT/UPDATE (plate_number populated, not 'PROCESSING...')
     │
     ═► TRIGGER: trigger_update_monthly_stays
     │      → UPSERT [vehicle_monthly_stays]
     │        Updates nights_stayed, consecutive_nights for plate+zone+month
     │
     ═► TRIGGER: trg_auto_evaluate_compliance
     │      → Writes compliance fields directly on [observations]
     │        {is_compliant, breach_type, breach_reason}
     │
     ═► TRIGGER: trigger_auto_create_compliance_result
     │      → Calls calculate_vehicle_compliance_v3(plate, zone_id, obs_id, date)
     │        ┌────────────────────────────────────────────────────────────┐
     │        │  calculate_vehicle_compliance_v3() — THE COMPLIANCE ENGINE │
     │        │                                                            │
     │        │  Reads:  [vehicle_monthly_stays]  (nights this month)     │
     │        │  Reads:  [zone_compliance_matrix] (current rules)         │
     │        │  Reads:  [canonical_vehicles]     (self_contained, exempt)│
     │        │                                                            │
     │        │  Checks:                                                   │
     │        │  1. nights_per_month limit exceeded?                      │
     │        │  2. max_consecutive_nights exceeded?                      │
     │        │  3. day_visit_only (no overnight)?                        │
     │        │  4. self_contained_required but vehicle not certified?    │
     │        │  5. after_hours (outside permitted_hours)?                │
     │        │  6. allowed_days (wrong day of week)?                     │
     │        │  7. homeless / fc_act_exempt? → override to COMPLIANT     │
     │        │                                                            │
           │        │  Writes: [observations]                                   │
           │        │    is_compliant, breach_type, breach_reason               │
           │        │    nights_stayed_this_month, consecutive_nights           │
           │        │    (compliance state stored on the observation row)        │
     │        └────────────────────────────────────────────────────────────┘
     │
           ═► TRIGGER/FUNCTION: breach evaluation path
           │      (fires from observations compliance state)
           │      → IF observations.is_compliant = false:
     │           INSERT [breach_alerts]
     │             breach_type = <violation type>
     │             status = 'pending'
     │             organization_id, zone_id, plate_number
     │             breach_details JSONB (nights, limits, enforcement_workflow)
```

---

## Diagram 4 — Enforcement Workflow (Three Modes)

```
[breach_alerts] status='pending'
         │
         │  enforcement_workflow comes from [organizations].enforcement_workflow
         │
         ├─ admin_first (DEFAULT)
         │    │
         │    ▼
         │  Breach alert stays 'pending' — admin reviews in Breach Alerts page
         │  Admin can:
         │    • Acknowledge  → status = 'acknowledged'
         │    • Assign to officer → assigned_to = officer.id
         │    • Start enforcement → status = 'enforcement_started'
         │       INSERT [enforcement_actions] action_type='warning'|'notice_to_vacate'
         │    • Resolve → status = 'resolved'
         │    • Dismiss → status = 'dismissed'
         │
         ├─ officer_direct
         │    │
         │    ▼
         │  Officer sees enforcement buttons immediately in FieldOfficerPortal
         │  (in "Recent Scans" section, for non-compliant observations)
         │  Officer can:
         │    • Issue Warning  → INSERT [enforcement_actions] action_type='warning'
         │    • Notice to Vacate → INSERT [enforcement_actions] action_type='notice_to_vacate'
         │                         ⟶ {generate-notice-to-vacate}
         │                              Reads [zone_legal_config] for template
         │                              Generates PDF notice
         │                              INSERT [notices_to_vacate]
         │
         └─ hybrid
              │
              ▼
            Officer can:
              • Issue Warning only → INSERT [enforcement_actions] action_type='warning'
            Admin still required for:
              • Notice to Vacate, escalation, resolution

For all workflows, after [enforcement_actions] INSERT:
     ═► TRIGGER: trigger_set_enforcement_plate
           → Populates plate_number on enforcement_actions from observation
     ═► TRIGGER: trigger_update_enforcement_tally
           → UPDATE [canonical_vehicles].enforcement_count + 1
           → UPDATE [canonical_vehicles].last_enforcement_type/at
```

---

## Diagram 5 — Zone Compliance Matrix (Version Control)

```
Admin creates/updates a zone in [zones]
     │
     ═► TRIGGER: trigger_sync_zone_to_matrix
           │
           │  (wrapped in EXCEPTION block — trigger errors are WARNINGs only,
           │   never abort the zone INSERT)
           │
           ▼
        INSERT [zone_compliance_matrix]
          version = previous_version + 1
          self_contained_required, nights_per_month, max_consecutive_nights,
          day_visit_only, allowed_days
          effective_from = NOW()
          effective_to = NULL (current version)
          change_reason = 'auto_created_with_zone' or 'auto_synced_from_zone_update'
          │
          ▼
        UPDATE previous matrix row → effective_to = NOW()
        (immutable history — old versions never deleted)

Compliance Engine always uses:
     SELECT * FROM zone_compliance_matrix
     WHERE zone_id = $1 AND effective_to IS NULL
     (the current/latest version)

Drift Events:
     Any change to matrix → INSERT [drift_events]
     Admin can see compliance history before/after rule changes
```

---

## Diagram 6 — Scheduled / Background Jobs

```
pg_cron (PostgreSQL scheduler)
     │
     ├─ DAILY at 3:00am NZT  ─────────────────────────────────────────────────┐
     │   cron.schedule('daily-gps-zone-correction', ...)                       │
     │   → HTTP POST {zone-correction} Edge Function                           │
     │      Reads [observations] with GPS coords                               │
     │      Re-runs geofence matching for each                                 │
     │      If GPS now inside a different zone → UPDATE [observations].zone_id │
     │      If GPS outside all zones → assign to "Other Location" zone         │
     │                                                                         │
     └─────────────────────────────────────────────────────────────────────────┘
     │
     ├─ EVERY MINUTE  ────────────────────────────────────────────────────────┐
     │   cron.schedule('welfare-monitor', ...)                                 │
     │   → HTTP POST {monitor-officer-welfare}                                 │
     │      Reads [user_profiles] with active patrol sessions                  │
     │      Checks [officer_welfare_settings] per org                          │
     │                                                                         │
     │      ┌── Inactivity check (no scan for N minutes):                     │
     │      │     INSERT [officer_welfare_alerts] alert_type='inactivity'      │
     │      │     ⟶ {send-push-notification} → Expo Push API                 │
     │      │                                                                  │
     │      ├── Man-Down check (GPS stationary for man_down_stationary_mins):  │
     │      │     INSERT [officer_welfare_alerts] alert_type='man_down'        │
     │      │     ⟶ {send-push-notification} HIGH priority → Expo Push API   │
     │      │                                                                  │
     │      └── Escalation (alert unacknowledged for escalation_mins):        │
     │            UPDATE [officer_welfare_alerts] → escalated = true           │
     │            ⟶ {send-push-notification} → admin push                    │
     │                                                                         │
     └─────────────────────────────────────────────────────────────────────────┘

On-demand admin-triggered jobs (called from frontend via Edge Function):
     ├─ {recalculate-compliance}
     │     Loops through all observations in date range
     │     Re-runs calculate_vehicle_compliance_v3() for each
     │     Updates compliance fields on [observations] with fresh data
     │     Used when zone rules change retroactively
     │
     ├─ {scan-breaches}
     │     Sweeps recent observations for new violations
     │     Creates missing [breach_alerts] for any that slipped through
     │
     ├─ {check-almost-breaches}
     │     Finds vehicles at night N-1 of their monthly limit
     │     Inserts 'at_risk' markers → admins get early warning
     │
     └─ {correct-zone-assignments}
           Same as the daily cron but triggered on-demand by admin
```

---

## Diagram 7 — Document Generation Pipeline

```
Admin triggers from ReportsHub / BreachAlerts page
     │
     ├─ Generate Notice to Vacate
     │     {generate-notice-to-vacate}
     │       Reads [zone_legal_config] for legal template
     │       Reads [breach_alerts] + [observations] for violation data
     │       Reads [user_profiles] (issuing officer name/badge)
     │       Generates PDF notice with:
     │         - Zone name + land description
     │         - Plate number + vehicle details
     │         - Breach type + nights stayed + limit
     │         - Officer name + badge
     │         - Issue date + vacate-by date
     │         - Legal authority (bylaw reference)
     │       INSERT [notices_to_vacate]
     │       Returns: PDF blob / download URL
     │
     ├─ Generate Incident Report
     │     {generate-incident-pdf}
     │       Reads [incidents] + linked [observations] + [photo_metadata]
     │       Produces court-ready evidence PDF with photo attachments
     │       Respects [incidents].legal_hold = true (cannot delete)
     │
     ├─ Generate Vehicle Report
     │     {generate-vehicle-report}
     │       Full observation timeline for a plate
     │       Photo gallery, compliance history, enforcement actions
     │       NZSCV/MotorWeb data snapshot
     │
     ├─ Generate Leadership Pack
     │     {generate-leadership-pack}
     │       Reads [observations], [breach_alerts], [drift_events]
     │       Produces executive summary with:
     │         - Compliance rate by zone (%)
     │         - Daily breach trend chart
     │         - Top 10 repeat offenders
     │         - Zone drift events (rule changes + impact)
     │         - Matrix version history
     │
     └─ Generate Dashboard Report
           {generate-dashboard-report}
             KPI summary for date range
             CSV or PDF output
```

---

## Diagram 8 — Vehicle Enrichment Pipeline

```
plate_number known (from ALPR stage 1 or 2)
     │
     ├─ NZSCV Lookup (self-contained certification)
     │     {check-nzscv-status}
     │     → proxy-server /api/nzscv/vehicle-info
     │     → NZSCV API (IP-whitelisted)
     │     → Returns: CertificateStatus (Current/Expired/Revoked)
     │     → UPDATE [canonical_vehicles]
     │           is_self_contained = (status == 'Current')
     │           self_contained_expiry = CertificateExpiryDate
     │           motorweb_data (if combined call)
     │
     ├─ MotorWeb Lookup (ownership + WOF + registration)
     │     {enrich-from-motorweb}
     │     → proxy-server /motorweb/currentOwnerCheck
     │     → MotorWeb NZ API (XML response)
     │     → Parses: make, model, year, colour, body_type, owner name, WOF expiry
     │     → UPDATE [canonical_vehicles].motorweb_data (JSONB cache)
     │     → Privacy-redacted fields handled by [privacy_curtain_settings]
     │
     ├─ Vehicle Photo Scrape (background enrichment)
     │     {scrape-vehicle-photos}
     │     → Searches for vehicle make/model images
     │     → Stores candidates in [photo_metadata]
     │
     └─ Best Photo Selection
           {select-best-vehicle-photo}
           Reads [photo_metadata] quality scores
           UPDATE [canonical_vehicles].profile_photo_url (if not .profile_photo_sticky)
```

---

## Diagram 9 — ParkPow Integration Pipeline

```
Admin triggers {parkpow-sync} (on-demand)
     │
     ├─ action: "sync-lots"
     │     Read [zones] WHERE parkpow_lot_id IS NULL
     │     POST ParkPow API → create lot for each unmapped zone
     │     UPDATE [zones].parkpow_lot_id
     │
     ├─ action: "sync-watchlist"
     │     Read [canonical_vehicles] WHERE is_flagged OR is_exempt
     │     PUT ParkPow API → update watchlist / exempt list
     │     UPDATE [canonical_vehicles].parkpow_vehicle_id
     │
     └─ action: "push-violations"
           Read [breach_alerts] WHERE parkpow_violation_id IS NULL
           POST ParkPow API violations endpoint
           UPDATE [breach_alerts].parkpow_violation_id
```

---

## Diagram 10 — Privacy Curtain Pipeline

```
Admin enables Privacy Act 2020 compliance in [privacy_curtain_settings]:
     auto_redact_enabled = true
     redact_owner_name = true
     redact_owner_address = true
     require_reason_for_unredact = true
     unredact_roles = ['admin', 'master']

When frontend reads MotorWeb / NZSCV owner data:
     src/lib/privacyCurtain.ts
     │
     ├─ Reads [privacy_curtain_settings] for org
     ├─ If auto_redact_enabled:
     │     Redacts owner_name, owner_address, phone_number fields
     │     Shows "█████████" in UI
     │
     └─ Officer/admin clicks "Reveal"
           If require_reason_for_unredact:
             Modal prompts for access reason
           INSERT [privacy_access_log]:
             actor, target_table, target_record_id
             field_accessed, access_reason, ip_address, accessed_at

Nightly cleanup (manual or pg_cron):
     {nightly-privacy-cleanup}
     → Purges [privacy_access_log] entries older than retention policy
     → Redacts expired data from [canonical_vehicles].motorweb_data
```

---

## Diagram 11 — Patrol Checkpoint (Lone Worker Protocol)

```
Physical checkpoint in the field:
     QR code placard OR NFC tag mounted at checkpoint location

Officer on patrol:
     │
     │  Taps "Checkpoint" in FieldOfficerPortal
     ▼
QRCheckpointScanner component
     │
     ├─ Opens camera to scan QR code
     │     QR payload = checkpoint UUID
     │
     ├─ Calculates GPS distance from checkpoint location
     │
     └─ INSERT [checkpoint_visits]
           checkpoint_id = scanned UUID
           officer_id, patrol_id
           scan_method = 'qr_camera' | 'nfc' | 'manual_code'
           gps_latitude, gps_longitude, gps_distance_from_checkpoint
           within_radius = (distance <= check_in_radius_metres)
           visited_at = NOW()

Admin monitors in PatrolCheckpointManagement page:
     Reads [checkpoint_visits] JOIN [patrol_checkpoints]
     Shows: which checkpoints visited, when, GPS accuracy, in/out of radius

If required checkpoint NOT visited within expected window:
     monitor-officer-welfare (cron) detects gap
     → INSERT [officer_welfare_alerts] alert_type='investigation_overdue'
     → {send-push-notification} → patrol manager
```

---

## Diagram 12 — Push Notification Pipeline

```
Trigger events → {send-push-notification} Edge Function
                                │
                  Reads [user_profiles].expo_push_token
                                │
                  POST https://exp.host/--/api/v2/push/send
                  {
                    to: "<ExponentPushToken[...]>",
                    title: "...",
                    body: "...",
                    data: { route, id },
                    priority: "high"
                  }
                                │
                  Expo routes to: iOS APNs / Android FCM
                                │
                  Officer's phone receives push notification
                  Taps → deep-links to relevant page in SPA

Notification triggers:
     ├─ Breach detected (scan-breaches)
     ├─ Enforcement action assigned (to officer)
     ├─ Welfare check (monitor-officer-welfare cron)
     ├─ Man-Down alert (monitor-officer-welfare cron)
     ├─ Patrol assignment created (trigger_notify_patrol_assignment)
     └─ Investigation job assigned
```

---

## Diagram 13 — Frontend Data Flow (React → Supabase)

```
REACT SPA
    │
    ├─ src/stores/authStore.ts (Zustand + localStorage)
    │     supabase.auth.signInWithPassword()
    │     → JWT stored in Supabase session
    │     → user_profiles fetched → role, org_id cached
    │
    ├─ src/stores/globalFiltersStore.ts (Zustand)
    │     organizationId, zoneId, dateFrom, dateTo
    │     → Used in every query as scoping filters
    │
    ├─ TanStack Query (cache layer)
    │     staleTime: 5 minutes
    │     Automatic background refetch on window focus: OFF
    │     Keys: ['observations', orgId, zoneId, dateFrom, dateTo]
    │
    ├─ src/lib/supabase.ts
    │     createClient<Database>()
    │     X-Client-Timezone: Pacific/Auckland (on every request)
    │
    └─ Page components call:
          supabase.from('table').select(...)    → PostgREST (RLS enforced)
          supabase.storage.from('bucket').…     → Storage API
          supabase.functions.invoke('name', {}) → Edge Function HTTPS

KEY PAGE → DATA RELATIONSHIPS:
     FieldOfficerPortal   → observations (INSERT), zones (RPC), scans bucket
     ObservationsView     → observations + zones (SELECT, paginated)
     BreachAlerts         → breach_alerts + observations (SELECT + UPDATE)
     ComplianceDashboard  → observations, breach_alerts, patrols (COUNT)
     HotspotsMap          → observations (GROUP BY zone_id)
     VehicleManagement    → canonical_vehicles + observations (SELECT)
     ZoneManagement       → zones + zone_compliance_matrix (CRUD)
     LivePatrolMonitor    → patrols + user_profiles (SELECT, realtime)
     PatrolCheckpoints    → patrol_checkpoints + checkpoint_visits (CRUD)
     ReportsHub           → generate-leadership-pack, generate-dashboard-report
     EnforcementActions   → enforcement_actions (SELECT + INSERT + UPDATE)
```

---

## Diagram 14 — RLS (Row-Level Security) Scoping

```
Every Supabase query is filtered by RLS policies automatically:

user.role = 'master'
     └─ Can read/write ALL rows across ALL organizations

user.role = 'admin' | 'admin_officer'
     └─ Can read/write rows WHERE organization_id IN (
            SELECT organization_id FROM user_profiles WHERE id = auth.uid()
            UNION
            SELECT id FROM organizations WHERE id = ANY(
              SELECT unnest(authorized_work_locations) FROM user_profiles WHERE id = auth.uid()
            )
          )

user.role = 'officer'
     ├─ observations: Can INSERT (own org) + SELECT (own org, limited fields)
     ├─ checkpoint_visits: Can INSERT (own) + SELECT (own)
     ├─ breach_alerts: Can SELECT (own org, pending/acknowledged)
     ├─ enforcement_actions: Can SELECT assigned to self + UPDATE assigned to self
     └─ zones: SELECT only (no INSERT — use ensure_other_location_zone() RPC)

SECURITY DEFINER RPCs (bypass RLS for specific operations):
     ensure_other_location_zone(p_organization_id)
          → Gets/creates "Other Location" zone
          → Officers can't INSERT into zones directly
     check_location_in_org(org_id, lat, lon)
          → Checks if GPS is inside org's active zones
          → Returns zone_id + zone_name for geofence assignment
```

---

## Diagram 15 — Complete Data Lineage (one scan, start to finish)

```
OFFICER taps "Scan"                                    t=0ms
     │
     GPS acquired                                      t~500ms
     │
     Weather fetched                                   t~1s
     │
     Photo uploaded → scans bucket                     t~2s
     │
     Observation created (status=pending)              t~2.5s
     │    [observations] id=X, plate='PROCESSING...'
     │    ═► trigger_update_monthly_stays              ← fires immediately (no-op, pending)
     │
     Officer sees "Evidence Secured ✅" toast          t~2.5s
     Officer can immediately scan next vehicle         ←────────── FAST PATH COMPLETE
     │
     ⟶ alpr-process Edge Function starts              t~3s (async)
          │
          ├─ PlateRecognizer API                       t~4s
          ├─ Railway /infer (ONNX)                     t~5s
          ├─ check-nzscv-status                        t~6s
          │
          UPDATE observations:                         t~7s
            plate_number = 'ABC123'
            vehicle_embedding = [...]
            sticker_presence = true
            processing_status = 'complete'
          │
          ═► trigger_update_monthly_stays              ← UPSERT vehicle_monthly_stays
            ═► trg_auto_evaluate_compliance              ← writes compliance fields directly
            │     └─ UPDATE observations
            │           is_compliant = false
            │           breach_type = 'consecutive_nights'
            │           breach_reason = '<computed reason>'
              │
              ═► breach-alert creation path                ← reads observations.is_compliant
          │     └─ INSERT breach_alerts
          │           status = 'pending'
          │           breach_type = 'consecutive_nights'
          │           enforcement_workflow = 'officer_direct' (from org)

RESULT at t~8s:
     [observations] complete + plate identified
     [vehicle_monthly_stays] updated
     [observations] compliance fields updated with per-rule breakdown
     [breach_alerts] created (status=pending)
     Officer's "Recent Scans" section auto-refreshes (TanStack Query)
     Officer sees: ABC123 — 🔴 IN BREACH — consecutive_nights

     IF enforcement_workflow = 'officer_direct':
          Officer sees: [Issue Warning] [Notice to Vacate] buttons
     IF enforcement_workflow = 'hybrid':
          Officer sees: [Issue Warning] button only
     IF enforcement_workflow = 'admin_first':
          Officer sees: "Reported to admin" badge
          Admin sees new alert in BreachAlerts dashboard
```

---

## Summary — All External Service Dependencies

| Service | Protocol | Auth | Called From | Purpose |
|---|---|---|---|---|
| Plate Recognizer API | HTTPS REST | `PLATERECOGNIZER_TOKEN` header | `alpr-process` | Plate extraction (primary) |
| inference-service (Railway) | HTTPS REST | IP allowlist + origin | `alpr-process` | ONNX vehicle analysis, embeddings |
| NZSCV API | HTTPS REST | IP whitelist (via proxy) | proxy-server | Self-contained cert lookup |
| proxy-server (Railway) | HTTPS REST | `X-Proxy-Secret` | `check-nzscv-status`, `enrich-from-motorweb` | Static IP gateway to NZSCV + MotorWeb |
| MotorWeb NZ | HTTPS XML | Credentials on proxy | proxy-server | Vehicle ownership + WOF data |
| ParkPow API | HTTPS REST | `PARKPOW_API_TOKEN` | `parkpow-sync` | Parking enforcement platform sync |
| Expo Push API | HTTPS REST | None (public) | `send-push-notification` | iOS/Android push notifications |
| OpenStreetMap | HTTPS tiles | None (public) | Browser (Leaflet) | Map tile rendering |
| OpenWeatherMap | HTTPS REST | `OPENWEATHER_API_KEY` | `get-weather` | Conditions at scan time |
| Supabase Auth (GoTrue) | HTTPS | JWT | Browser SDK | Login / session management |
