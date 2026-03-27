# FreedomCamp Manager — External Systems Sync Guide

> **Purpose**: Documents how FreedomCamp Manager's internal processes align with each
> referenced external system. Use this as the authoritative reference when building
> or modifying integration points.
>
> **Last updated**: 2026-05-01

---

## Overview: One Job, Five External Services

FreedomCamp Manager has one core job — **officers scan plates → admins review breaches →
councils enforce freedom camping rules**. Five external services support that job:

| Service | Role in the app | Connection method |
|---|---|---|
| **Plate Recognizer** | Extracts plate number + vehicle attributes from photos | REST API via edge function |
| **ParkPow** | Watchlist/exemption checks + formal violation records | REST API via edge function |
| **NZSCV** | Verifies self-contained vehicle certification | Proxy Server (Railway) |
| **MotorWeb** | Enriches vehicle details (make/model/year/owner) | Proxy Server (Railway) |
| **Inference Service** | Generates 384-D vehicle embedding, detects SCV sticker, compares movement | Railway microservice |

---

## 1. Plate Recognizer (ALPR)

**What PlatRecognizer does**: Turns a raw photo into a plate number + vehicle attributes in ~300 ms.

**How FCM uses it**: Every officer scan goes through `process-officer-scan`, which calls the
Plate Recognizer API as its first step.

### API call flow
```
POST https://api.platerecognizer.com/v1/plate-reader/
  Body: multipart/form-data { upload: <photo> }

Response:
{
  "results": [{
    "plate":   { "value": "ABC123", "confidence": 0.91 },
    "vehicle": { "type": "Van", "make": "Toyota", "model": "HiAce" },
    "box":     { "xmin": 120, "ymin": 40, "xmax": 440, "ymax": 240 }
  }]
}
```

### FCM alignment

| Plate Recognizer field | DB column | Notes |
|---|---|---|
| `results[0].plate.value` | `observations.plate_number` | Normalised to uppercase |
| `results[0].plate.confidence` | `observations.alpr_confidence` | Stored for audit |
| `results[0].vehicle.make` | `canonical_vehicles.vehicle_make` | Written on first seen |
| `results[0].vehicle.model` | `canonical_vehicles.vehicle_model` | Written on first seen |
| `results[0].vehicle.type` | Used for self-contained determination | Van/Motorhome = likely SCV candidate |

### Config
```
PLATERECOGNIZER_TOKEN  (Supabase secret)
ALPR_API_TOKEN         (same value, alternate name)
ALPR_API_URL           (https://api.platerecognizer.com/v1/plate-reader/)
```

---

## 2. ParkPow

**What ParkPow does**: Parking management & enforcement platform. Plate Recognizer is a
ParkPow subsidiary — they share the same API token.

ParkPow gives FCM three things:
- **Watchlists** (block list): flag a plate → all future scans return `is_flagged: true`
- **Permits** (allow list): exempt a plate → all future scans return `is_permitted: true`
- **Sessions**: record when a vehicle was in a zone (entry time → duration data)
- **Violations**: push formal breach records to ParkPow's enforcement dashboard

### How ParkPow organises data

ParkPow uses **lots** (= FCM zones). Each FCM zone must have a `parkpow_lot_id` before
sessions and violations can be created.

```
ParkPow lot  ←→  FCM zones.parkpow_lot_id
ParkPow session  ←→  FCM observations.parkpow_session_id
ParkPow violation  ←→  FCM observations.parkpow_violation_id
ParkPow watchlist entry  ←→  FCM canonical_vehicles.parkpow_vehicle_id
```

### Sync operations (run via `parkpow-sync` edge function)

| Action | When to run | What it does |
|---|---|---|
| `sync-lots` | Once after deployment | Creates a ParkPow lot for each FCM zone |
| `sync-watchlist` | On demand / nightly | Pushes flagged/exempt vehicles to ParkPow |
| `push-violations` | Nightly (via `cleanup-and-recalculate`) | Pushes unsynced breaches as ParkPow violations |

### Officer scan integration
When `process-officer-scan` fires, ParkPow is called in parallel with ALPR:
```
Step 3: ParkPow watchlist check
  → GET https://app.parkpow.com/api/v1/watchlist/?plate=ABC123
  → Returns: { is_flagged: true, is_permitted: false }

Step 4: ParkPow session creation
  → POST https://app.parkpow.com/api/v1/sessions/
  → Body: { lot: <parkpow_lot_id>, license_plate: "ABC123", entry: <timestamp> }
  → Stores: observations.parkpow_session_id
```

### Config
```
PARKPOW_API_TOKEN  (Supabase secret — same as PLATERECOGNIZER_TOKEN)
```

---

## 3. NZSCV (New Zealand Self-Contained Vehicle Register)

**What NZSCV does**: National register of vehicles with valid self-contained certification
(water storage, grey/black water, toilet). A vehicle must be certified to freedom camp
in zones that require self-containment.

**Why a proxy server**: NZSCV requires IP whitelisting. Railway provides a static IP.
The frontend never calls NZSCV directly.

### Request/response shape

```
POST https://<proxy-server>/nzscv/check
  Body: { plate: "ABC123" }

Response:
{
  "plate_number":  "ABC123",
  "warrant_type":  "green",           // green | blue | null
  "warrant_number": "SC12345",
  "expires_on":    "2026-06-30",
  "is_valid":      true
}
```

### FCM alignment

| NZSCV field | DB column | Notes |
|---|---|---|
| `plate_number` | `canonical_scv.plate_number` | Primary key for lookup |
| `warrant_type` | `canonical_scv.warrant_type` | `green` = certified, `blue` = expired pending renewal |
| `warrant_number` | `canonical_scv.warrant_number` | For audit/display |
| `expires_on` | `canonical_scv.expires_on` | Used by compliance engine |
| `is_valid` | `observations.self_contained` | Derived: valid + not expired |

### Sync schedule
The `sync-scv-list` edge function downloads the full NZSCV register periodically.
For individual plate checks, `check-nzscv-status` calls the proxy in real-time.

### Config
```
PROXY_SERVER_URL  (Supabase secret — Railway proxy URL)
```

---

## 4. MotorWeb

**What MotorWeb does**: NZ vehicle information provider. Returns make, model, year,
colour, registration status, and registered owner details.

**Why a proxy server**: MotorWeb requires IP whitelisting (same static IP as NZSCV).

### Request/response shape

```
POST https://<proxy-server>/motorweb/enrich
  Body: { plate: "ABC123" }

Response:
{
  "plate_number":    "ABC123",
  "vehicle_make":    "Toyota",
  "vehicle_model":   "HiAce",
  "vehicle_year":    2018,
  "vehicle_colour":  "White",
  "registration_status": "current"
}
```

### FCM alignment

| MotorWeb field | DB column | Notes |
|---|---|---|
| `vehicle_make` | `canonical_vehicles.vehicle_make` | Updated by `enrich-from-motorweb` |
| `vehicle_model` | `canonical_vehicles.vehicle_model` | |
| `vehicle_year` | `canonical_vehicles.vehicle_year` | |
| `vehicle_colour` | `canonical_vehicles.vehicle_color` | Note: US spelling in DB |
| `registration_status` | `canonical_vehicles.registration_status` | |

### When enrichment runs
- **During scan**: if Plate Recognizer returns low confidence on vehicle type
- **Nightly**: `cleanup-and-recalculate` Phase 3 enriches vehicles with missing attributes
- **On demand**: `enrich-from-motorweb` edge function can be called directly

### Config
```
PROXY_SERVER_URL  (Supabase secret — shared with NZSCV proxy)
```

---

## 5. Inference Service (Railway)

**What it does**: Two essential things Supabase edge functions cannot do:
1. Load ONNX models (YOLOv8n + MobileNetV3) — native binaries, 30 MB
2. Generate 384-dimensional vehicle embeddings for photo fingerprinting

**Why a separate service**: Supabase Deno edge functions have no native binary support
and are limited to 150 MB. ONNX Runtime requires native compilation.

### Endpoints

#### `POST /infer` — Vehicle photo analysis (main endpoint)
```
Body: multipart/form-data { file: <photo> }

Response:
{
  "success": true,
  "data": {
    "embedding": [<384 floats>],           // Vehicle fingerprint
    "embedding_quality": 0.82,             // 0–1, confidence in embedding
    "detection": { "confidence": 0.91 },   // Vehicle detected in photo?

    "vehicle_make":   "Toyota",
    "vehicle_model":  "HiAce",
    "vehicle_colour": "White",

    "sticker": {
      "presence":   true,                  // SCV sticker found?
      "color":      "blue",                // blue | green | unknown
      "detection_confidence": 0.94,
      "color_confidence": 0.87
    },

    "movement": {
      "moved":    false,                   // vs previous photo of same vehicle
      "decision": "stationary"             // moved | stationary | inconclusive
    }
  }
}
```

**Critical rule**: when `sticker.presence` is `null`, `sticker.color` MUST be `"unknown"`.
These observations must be flagged for mandatory human review before a compliance decision.

#### `POST /infer/face` — Face detection (authenticated)
Used by `process-face-scan` edge function for facial recognition in enforcement context.

#### `GET /health` — Health check
Used by `cleanup-and-recalculate` to verify service is available before nightly run.

### FCM alignment

| Inference field | DB column | Notes |
|---|---|---|
| `data.embedding` | `observations.embedding` | pgvector; enables similarity search |
| `data.embedding_quality` | `observations.embedding_quality` | |
| `data.sticker.presence` | `observations.scv_sticker_detected` | |
| `data.sticker.color` | `observations.scv_sticker_color` | |
| `data.movement.moved` | `observations.vehicle_moved` | |
| `data.vehicle_make` | `observations.vehicle_make` | Supplements canonical |
| `data.vehicle_colour` | `observations.vehicle_color` | |

### Config
```
INFERENCE_SERVICE_URL  (Supabase secret — Railway inference service URL)
INFERENCE_API_KEY      (Supabase secret — shared secret for service-to-service auth)
```

---

## 6. Core Scan Pipeline (How All Services Connect)

The `process-officer-scan` edge function orchestrates all five services in a single call:

```
Officer taps "Scan" on phone
         │
         ▼
1. Upload photo → Supabase Storage (bucket: scans)
         │
         ▼
2. Resolve zone from GPS
   → Geofence lookup against zones table (PostGIS)
   → Child-zone priority: most specific zone wins
         │
    ┌────┴─────────────────┐
    │                       │
    ▼                       ▼
3. Plate Recognizer API   Inference Service /infer
   → plate_number           → embedding (384-D)
   → vehicle_make           → sticker.presence / color
   → alpr_confidence        → vehicle_make / colour
    │                       │
    └────────┬──────────────┘
             │
             ▼
4. Canonical lookups (DB, no external call)
   → canonical_vehicles (make/model/year/colour)
   → canonical_scv       (SCV certification)
   → canonical_homeless  (homeless/flagged status)
             │
             ▼
5. ParkPow watchlist check
   → is_flagged?    (on block list)
   → is_permitted?  (on allow list / exempt)
             │
             ▼
6. ParkPow session creation
   → records "vehicle in zone at time T"
             │
             ▼
7. calculate_vehicle_compliance_v3() RPC
   → Evaluates 4 rules against zone_compliance_matrix
   → Returns: is_compliant, breach_type, nights_stayed
             │
             ▼
8. INSERT INTO observations
   → All triggers fire (canonical update, monthly stays, breach_alerts)
             │
             ▼
9. Return verdict to officer
   ✅ "Vehicle compliant"  OR  ❌ "Breach: [type]"
   Response time target: < 5 seconds
```

---

## 7. Nightly Batch Process (cleanup-and-recalculate)

Runs at 3:00 AM NZT via pg_cron. Keeps data accurate and synced.

```
Phase 1: Zone GPS correction
  → Re-run geofence check for recent observations
  → Correct any observations assigned to wrong zone

Phase 2: Duplicate detection
  → Find same plate + same zone + same day observations
  → Merge duplicates, keep earliest

Phase 3: Vehicle attribute refresh
  → Call MotorWeb for vehicles with incomplete attributes
  → Update canonical_vehicles

Phase 4: SCV list sync
  → Download latest NZSCV register
  → Update canonical_scv for changed/expired certificates

Phase 5: Overnight breach detection
  → Find vehicles approaching monthly/consecutive limits
  → Create predictive breach_alert (type: at_risk)

Phase 6: Compliance recalculation
  → Re-run calculate_vehicle_compliance_v3() for zone-corrected observations
  → Update breach_alerts for changed compliance states

Phase 7: ParkPow violation sync
  → Push unsynced breaches to ParkPow as formal violations
  → Update observations.parkpow_violation_id

Phase 8: Photo maintenance
  → Reconcile photo records
  → Re-ingest failed photos
  → Select best profile photo for each vehicle

Phase 9: Privacy cleanup
  → Purge observations older than retention_policies.max_days
  → Respect retention_hold flag (skip observations on legal hold)
```

---

## 8. Database Type Sync

The Supabase-generated `src/types/database.ts` must stay in sync with the live schema.
When migrations add new tables or columns, update `database.ts` in the same PR.

### Tables added post-generation (now in database.ts)
| Table | Migration | Purpose |
|---|---|---|
| `patrol_checkpoints` | `20260302000003_patrol_checkpoints.sql` | QR/NFC lone-worker checkpoints |
| `checkpoint_visits` | `20260302000003_patrol_checkpoints.sql` | Officer scan events at checkpoints |

### Columns added post-generation (now in database.ts)
| Table | Column | Migration | Purpose |
|---|---|---|---|
| `incidents` | `retention_hold` | `20260224000003_incident_evidence_system.sql` | Legal hold flag |
| `incidents` | `retention_until` | same | Legal hold expiry date |
| `user_profiles` | `push_token` | `20260501000002_add_push_token_to_user_profiles.sql` | Device push notification token |
| `user_profiles` | `push_token_updated_at` | same | Token registration timestamp |

### Rule: Never use `as any` to bypass missing types
If a column or table is missing from `database.ts`, the correct fix is:
1. Add it to `database.ts` (if it exists in a migration)
2. Create a migration (if the column is new)
3. NOT to cast `supabase.from('table') as any`

The only acceptable `as any` usage is for:
- `as unknown as X` when casting a fully-typed DB result to a local interface shape
- `let query: any` when a long Supabase query chain causes TS2589 (deep type instantiation)

---

## 9. Role-to-Service Access Matrix

| Role | Plate Recognizer | ParkPow | NZSCV | MotorWeb | Inference |
|---|---|---|---|---|---|
| `officer` | ✅ via scan | Read only | ✅ via scan | Read only | ✅ via scan |
| `admin` | ❌ direct | ✅ full | ✅ via admin | ✅ via admin | ❌ direct |
| `master` | ❌ direct | ✅ full | ✅ via admin | ✅ via admin | ❌ direct |
| `grand_master` | ❌ direct | ✅ full | ✅ full | ✅ full | ❌ direct |

All service calls go through **Supabase Edge Functions** — the frontend never calls
external services directly.

---

## 10. Environment Variables Reference

### Supabase Secrets (edge functions)
```bash
PLATERECOGNIZER_TOKEN   # Plate Recognizer API key
ALPR_API_TOKEN          # Same value (alternate name used by legacy functions)
ALPR_API_URL            # https://api.platerecognizer.com/v1/plate-reader/
PARKPOW_API_TOKEN       # ParkPow API key (same subscription as PLATERECOGNIZER)
PROXY_SERVER_URL        # Railway proxy server URL (for NZSCV + MotorWeb)
INFERENCE_SERVICE_URL   # Railway inference service URL
INFERENCE_API_KEY       # Shared secret for inference service authentication
SUPABASE_URL            # Auto-set by Supabase
SUPABASE_ANON_KEY       # Auto-set by Supabase
SUPABASE_SERVICE_ROLE_KEY  # Auto-set by Supabase
```

### Frontend Environment (`.env`)
```bash
VITE_SUPABASE_URL       # Supabase project URL
VITE_SUPABASE_ANON_KEY  # Supabase anonymous key
```

The frontend never needs ALPR, ParkPow, NZSCV, MotorWeb or Inference credentials.

---

## Quick Reference: Which Edge Function Calls What

| Edge Function | Plate Recognizer | ParkPow | NZSCV | MotorWeb | Inference |
|---|---|---|---|---|---|
| `process-officer-scan` | ✅ | ✅ | ✅ | ❌ | ✅ |
| `cleanup-and-recalculate` | ❌ | ✅ (violations) | ✅ (sync) | ✅ (enrich) | ❌ |
| `sync-scv-list` | ❌ | ❌ | ✅ | ❌ | ❌ |
| `enrich-from-motorweb` | ❌ | ❌ | ❌ | ✅ | ❌ |
| `parkpow-sync` | ❌ | ✅ | ❌ | ❌ | ❌ |
| `process-face-scan` | ❌ | ❌ | ❌ | ❌ | ✅ |
