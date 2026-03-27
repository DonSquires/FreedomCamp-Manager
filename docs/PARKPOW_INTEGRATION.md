# ParkPow Enforcement Integration

## What is ParkPow?

**ParkPow** (https://parkpow.com) is a full **Parking Management & Enforcement** platform. Plate Recognizer is actually a *subsidiary* of ParkPow — they share the same account and API token infrastructure.

ParkPow turns raw plate-recognition scans into a complete **enforcement workflow**:

| ParkPow Feature | What it does for FreedomCamp Manager |
|---|---|
| **Watchlists (block list)** | Flag a vehicle's plate → every future scan instantly returns `is_flagged: true`. No need to manually check a separate database. |
| **Permit management (allow list)** | Mark an exempt vehicle → every future scan returns `is_permitted: true`, so the officer knows not to issue a notice. |
| **Session tracking** | Records exactly when a vehicle was observed in a zone (entry timestamp). Gives you *duration* data for overstay calculations. |
| **Violation records** | When a breach is detected, push a formal violation to ParkPow. This triggers ParkPow's enforcement workflow: dashboards, reports, email/SMS alerts. |
| **Webhooks** | ParkPow can push real-time events back to FreedomCamp when plates are detected by CCTV or fixed cameras. |

---

## How the Integration Works (Step by Step)

When an officer scans a plate, the canonical ingest path (`vehicle-ingest` + background enrichment) runs this pipeline:

```
📷 Photo captured
      ↓
1. Plate Recognizer API    (PLATERECOGNIZER_TOKEN ✅)
   → plate number, make, model, colour, confidence
      ↓
2. Railway ORC/AI           (INFERENCE_SERVICE_URL — optional)
   → 384-D visual embedding for vehicle fingerprinting
      ↓
3. ParkPow watchlist check  (PARKPOW_API_TOKEN ✅)
   → is_flagged?    plate is on the block list
   → is_permitted?  plate is on the allow list (exempt)
      ↓
4. ParkPow session creation (same token)
   → records "vehicle entered zone X at time T"
   → stores parkpow_session_id in observations row
      ↓
5. If flagged → ParkPow violation created immediately
   → stores parkpow_violation_id in observations row
   → ParkPow enforcement workflow activates
      ↓
6. Database: insert observation row with all data
```

Compliance breaches that are *not* immediately flagged are pushed later via:
```bash
# Run manually or on a schedule:
POST /functions/v1/parkpow-sync
{ "action": "push-violations" }
```

---

## Secrets Already Configured ✅

All required ParkPow secrets are already set in your Supabase project:

| Secret Name | Purpose |
|---|---|
| `PARKPOW_API_TOKEN` | ParkPow API authentication |
| `PLATERECOGNIZER_TOKEN` | Plate Recognizer API (same subscription) |
| `ALPR_API_TOKEN` | Alternate name, same value |
| `ALPR_API_URL` | API endpoint URL |

To verify:
```bash
supabase secrets list
```

---

## One-Time Setup: Sync Zones to ParkPow Lots

ParkPow organises vehicles by **"lot"** (equivalent to a FreedomCamp zone). Before sessions and violations can be created, each zone needs a `parkpow_lot_id`.

Run once after deployment:
```bash
curl -X POST \
  https://<your-project>.supabase.co/functions/v1/parkpow-sync \
  -H "Authorization: Bearer <SERVICE_ROLE_KEY>" \
  -H "Content-Type: application/json" \
  -d '{"action": "sync-lots"}'
```

This creates a ParkPow lot for each zone (idempotent — safe to run multiple times).

---

## Syncing Watchlists

To push all currently-flagged or exempt vehicles from `canonical_vehicles` to ParkPow:
```bash
curl -X POST \
  https://<your-project>.supabase.co/functions/v1/parkpow-sync \
  -H "Authorization: Bearer <SERVICE_ROLE_KEY>" \
  -H "Content-Type: application/json" \
  -d '{"action": "sync-watchlist"}'
```

After this runs, every future scan will return the block/allow status without a separate DB lookup.

---

## Pushing Violations

To push all unsynced compliance breaches to ParkPow as formal violations:
```bash
curl -X POST \
  https://<your-project>.supabase.co/functions/v1/parkpow-sync \
  -H "Authorization: Bearer <SERVICE_ROLE_KEY>" \
  -H "Content-Type: application/json" \
  -d '{"action": "push-violations"}'
```

This can be run on a schedule (e.g., nightly cron via Supabase pg_cron).

---

## Database Columns Added

The migration `20260225_parkpow_integration.sql` adds:

| Table | Column | Purpose |
|---|---|---|
| `zones` | `parkpow_lot_id` | Links zone to ParkPow lot |
| `canonical_vehicles` | `parkpow_vehicle_id` | Links vehicle to ParkPow watchlist entry |
| `canonical_vehicles` | `is_exempt` | True when vehicle is on ParkPow allow list |
| `observations` | `parkpow_session_id` | ParkPow session ID for this observation |
| `observations` | `parkpow_violation_id` | ParkPow violation ID (set when breach is pushed) |

---

## Response Fields in Canonical Ingest

After integration, canonical ingest responses include:

```json
{
  "success": true,
  "observation_id": "...",
  "plate": "ABC123",
  "parkpow_flagged": true,
  "parkpow_permitted": false,
  "parkpow_session_id": 12345
}
```

- `parkpow_flagged: true` → show red alert in officer app
- `parkpow_permitted: true` → show green "exempt" badge
- `parkpow_session_id` → session created; violation will be pushed if breach detected

---

## Summary: What You Get

Without ParkPow integration:
- Officer scans plate → we *only* know what's in our local database

With ParkPow integration:
- Officer scans plate → we *instantly* know:
  - ✅ Is this vehicle blocked by enforcement across all zones?
  - ✅ Does this vehicle have a valid exemption permit?
  - ✅ How long has this vehicle been present (session duration)?
  - ✅ Is there an active formal violation against this plate?
- Compliance breaches are automatically escalated to ParkPow's enforcement workflow
- Zone managers get violations in the ParkPow dashboard without manual data entry
