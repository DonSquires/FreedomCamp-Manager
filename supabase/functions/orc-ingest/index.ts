// orc-ingest — Unified vehicle observation ingest
// ============================================================================
// PLATE RECOGNITION PIPELINE (in priority order):
//
//   1. Plate Recognizer API  (PLATERECOGNIZER_TOKEN / ALPR_API_TOKEN — paid ✅)
//      https://api.platerecognizer.com/v1/plate-reader/
//      Returns: plate, confidence, region, make, model, colour, vehicle type
//      Regions: ["nz"], mmc=true, detection_rule=strict
//
//   2. Railway ORC/AI        (INFERENCE_SERVICE_URL is set — optional)
//      POST /infer → YOLOv8n detect + MobileNetV3 384D embed
//      + optional OpenAI Vision plate/make/model/colour (OPENAI_API_KEY on Railway)
//      Used ALSO for visual embedding regardless of which tier handles the plate.
//
//   3. OnSpace AI / manual   (client sends plate + vehicle metadata in body)
//      Used when both services above are unavailable or don't detect a plate.
//
// In all cases this function:
//   • Uploads photo to the `evidence` Storage bucket with SHA-256 integrity hash
//   • Upserts canonical_vehicles record (create or update last_seen + metadata)
//   • Inserts a row into `observations` including vector embedding when available
//   • Returns observation_id, plate, photo_url, embedding quality, source tier
//
// Required Supabase secrets:
//   PLATE_RECOGNIZER_TOKEN   Plate Recognizer API token  (highly recommended)
//   INFERENCE_SERVICE_URL    Railway inference service URL (optional but adds embeddings)
//
// Optional Supabase secrets:
//   PLATE_RECOGNIZER_API_URL Override API URL (default: https://api.platerecognizer.com/v1/plate-reader/)
//
// Request body (JSON):
//   image            string   base64 data URL              (required)
//   zoneId           string   UUID                         (required)
//   organizationId   string   UUID                         (required)
//   officerId        string   UUID                         (required)
//   idempotencyKey   string                                (required)
//   gpsLatitude      number                                (required)
//   gpsLongitude     number                                (required)
//   gpsAccuracy      number?
//   recordedAt       string?  ISO timestamp                (default: now)
//   officerNotes     string?
//   weatherConditions string?
//   regions          string[]? ALPR region codes           (default: ["nz"])
//   // OnSpace AI / manual fallback fields (used only when tiers 1+2 unavailable)
//   plate            string?
//   confidence       number?
//   vehicle_make     string?
//   vehicle_model    string?
//   vehicle_colour   string?
//   vehicle_year     number?
//   self_contained   boolean?
//
// Response (JSON):
//   success            boolean
//   observation_id     string
//   plate              string | null
//   plate_confidence   number | null
//   photo_url          string
//   photo_hash         string
//   vehicle_make/model/colour   string | null
//   embedding_quality  number | null
//   requires_manual_entry boolean
//   inference_source   "plate_recognizer" | "railway" | "onspace_fallback" | "no_plate"
//   duplicate          boolean?
// ============================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.7";
import {
  checkWatchlist,
  createSession,
  createViolation,
  isParkPowEnabled,
} from "../_shared/parkpow.ts";

// ── CORS ─────────────────────────────────────────────────────────────────────

const ALLOWED_LOCALHOST = new Set(["http://localhost:5173", "http://localhost:3000"]);

function getCorsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get("origin") ?? "";
  const allowed = ALLOWED_LOCALHOST.has(origin) || origin.endsWith(".onspace.build");
  return {
    ...(allowed ? { "Access-Control-Allow-Origin": origin } : {}),
    Vary: "Origin",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "authorization, apikey, x-client-info, content-type",
    "Access-Control-Max-Age": "3600",
  };
}

function jsonResp(cors: Record<string, string>, status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "content-type": "application/json" },
  });
}

// ── SHA-256 ──────────────────────────────────────────────────────────────────

async function sha256hex(data: Uint8Array): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("");
}

// ── Shared result shape ───────────────────────────────────────────────────────

interface PlateResult {
  plate: string | null;
  plate_confidence: number | null;
  region: string | null;
  vehicle_make: string | null;
  vehicle_model: string | null;
  vehicle_colour: string | null;
  vehicle_type: string | null;
  vehicle_year: number | null;
  self_contained: boolean;
  embedding: number[] | null;
  embedding_quality: number | null;
  embedding_model_version: string | null;
  source: "plate_recognizer" | "railway" | "onspace_fallback" | "no_plate";
}

// ── Tier 1: Plate Recognizer API ─────────────────────────────────────────────
// https://docs.platerecognizer.com

async function callPlateRecognizer(
  imageBytes: Uint8Array,
  regions: string[],
): Promise<Omit<PlateResult, "embedding" | "embedding_quality" | "embedding_model_version" | "source"> | null> {
  // Accept all known secret name variants (most specific first)
  const token =
    Deno.env.get("PLATERECOGNIZER_TOKEN") ??
    Deno.env.get("ALPR_API_TOKEN") ??
    Deno.env.get("PLATE_RECOGNIZER_TOKEN"); // legacy — kept for backward compat
  if (!token) {
    console.warn("⚠️  No Plate Recognizer token set (PLATERECOGNIZER_TOKEN / ALPR_API_TOKEN) — skipping tier 1");
    return null;
  }

  const apiUrl =
    Deno.env.get("ALPR_API_URL") ??
    Deno.env.get("PLATE_RECOGNIZER_API_URL") ??
    "https://api.platerecognizer.com/v1/plate-reader/";

  try {
    const blob = new Blob([imageBytes], { type: "image/jpeg" });
    const form = new FormData();
    form.append("upload", blob, "scan.jpg");
    regions.forEach(r => form.append("regions", r));
    form.append("mmc", "true"); // Make / Model / Colour
    form.append(
      "config",
      JSON.stringify({ region: "strict", detection_rule: "strict" }),
    );

    const resp = await fetch(apiUrl, {
      method: "POST",
      headers: { Authorization: `Token ${token}` },
      body: form,
      signal: AbortSignal.timeout(15_000),
    });

    if (!resp.ok) {
      const errText = await resp.text();
      console.warn(`⚠️  Plate Recognizer HTTP ${resp.status}: ${errText.slice(0, 200)}`);
      return null;
    }

    const data = await resp.json();
    console.log("📊 Plate Recognizer response:", JSON.stringify(data));

    if (!data.results || data.results.length === 0) {
      console.log("ℹ️  Plate Recognizer: no plate detected in image");
      // Return explicit no-plate rather than null so we still log the API call
      return {
        plate: null, plate_confidence: null, region: null,
        vehicle_make: null, vehicle_model: null, vehicle_colour: null,
        vehicle_type: null, vehicle_year: null, self_contained: false,
      };
    }

    const r = data.results[0];
    const make  = r.model_make?.[0]?.make  ?? null;
    const model = r.model_make?.[0]?.model ?? null;
    const colour = r.color?.[0]?.color ?? null;
    const vtype  = r.vehicle?.type ?? null;

    console.log(`✅ Plate Recognizer: plate=${r.plate} conf=${r.score} make=${make}`);
    return {
      plate: r.plate?.toUpperCase() ?? null,
      plate_confidence: r.score ?? null,
      region: r.region?.code ?? null,
      vehicle_make: make,
      vehicle_model: model,
      vehicle_colour: colour,
      vehicle_type: vtype,
      vehicle_year: null, // Plate Recognizer doesn't return year
      self_contained: false, // determined separately if needed
    };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn("⚠️  Plate Recognizer call failed:", msg);
    return null;
  }
}

// ── Tier 2: Railway ORC/AI inference ─────────────────────────────────────────
// Used for the 384-D visual embedding regardless of which tier handled the plate.
// If OPENAI_API_KEY is set on Railway, it also returns plate+metadata as backup.

interface RailwayResult {
  plate: string | null;
  plate_confidence: number | null;
  vehicle_make: string | null;
  vehicle_model: string | null;
  vehicle_colour: string | null;
  vehicle_year: number | null;
  self_contained: boolean;
  embedding: number[] | null;
  embedding_quality: number | null;
  embedding_model_version: string | null;
}

async function callRailway(imageBase64: string): Promise<RailwayResult | null> {
  const url = Deno.env.get("INFERENCE_SERVICE_URL");
  if (!url) return null;
  try {
    const resp = await fetch(`${url}/infer`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ image_base64: imageBase64 }),
      signal: AbortSignal.timeout(20_000),
    });
    if (resp.status === 503) { console.warn("⚠️  Railway degraded (503)"); return null; }
    if (!resp.ok) { console.warn(`⚠️  Railway HTTP ${resp.status}`); return null; }
    const d = await resp.json();
    if (!d.success) return null;
    console.log(`✅ Railway ORC/AI: embed_quality=${d.embedding_quality} plate=${d.plate ?? "(none)"}`);
    return {
      plate: d.plate ?? null,
      plate_confidence: d.plate_confidence ?? null,
      vehicle_make: d.vehicle_make ?? null,
      vehicle_model: d.vehicle_model ?? null,
      vehicle_colour: d.vehicle_colour ?? null,
      vehicle_year: d.vehicle_year ?? null,
      self_contained: d.self_contained ?? false,
      embedding: d.embedding ?? null,
      embedding_quality: d.embedding_quality ?? null,
      embedding_model_version: d.embedding_model_version ?? null,
    };
  } catch (e: unknown) {
    console.warn("⚠️  Railway failed:", e instanceof Error ? e.message : e);
    return null;
  }
}

// ── Main handler ─────────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { status: 200, headers: getCorsHeaders(req) });
  }

  const cors = getCorsHeaders(req);
  const auth = req.headers.get("Authorization") ?? "";
  if (!auth.startsWith("Bearer ")) {
    return jsonResp(cors, 401, { success: false, error: "Missing Authorization header" });
  }

  try {
    const db = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const body = await req.json();
    const {
      image, zoneId, organizationId, officerId, idempotencyKey,
      gpsLatitude, gpsLongitude, gpsAccuracy = null,
      recordedAt = new Date().toISOString(),
      officerNotes = null, weatherConditions = null,
      regions = ["nz"],
      // OnSpace AI / manual fallback
      plate: clientPlate = null,
      confidence: clientConfidence = null,
      vehicle_make: clientMake = null,
      vehicle_model: clientModel = null,
      vehicle_colour: clientColour = null,
      vehicle_year: clientYear = null,
      self_contained: clientSC = false,
    } = body;

    if (!image)          return jsonResp(cors, 400, { success: false, error: "Missing image" });
    if (!zoneId)         return jsonResp(cors, 400, { success: false, error: "Missing zoneId" });
    if (!organizationId) return jsonResp(cors, 400, { success: false, error: "Missing organizationId" });
    if (!officerId)      return jsonResp(cors, 400, { success: false, error: "Missing officerId" });
    if (!idempotencyKey) return jsonResp(cors, 400, { success: false, error: "Missing idempotencyKey" });
    if (!gpsLatitude || !gpsLongitude) {
      return jsonResp(cors, 400, { success: false, error: "Missing GPS coordinates" });
    }

    // ── Idempotency ────────────────────────────────────────────────────────
    const { data: existing } = await db
      .from("observations")
      .select("id")
      .eq("idempotency_key", idempotencyKey)
      .maybeSingle();
    if (existing) {
      return jsonResp(cors, 200, { success: true, duplicate: true, observation_id: existing.id });
    }

    // ── Decode image ───────────────────────────────────────────────────────
    const b64 = image.includes(",") ? image.split(",")[1] : image;
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);

    // ── Upload photo ───────────────────────────────────────────────────────
    const hash = await sha256hex(bytes);
    const storagePath = `${officerId}/${Date.now()}-${hash.slice(0, 8)}.jpg`;
    const { error: upErr } = await db.storage
      .from("evidence")
      .upload(storagePath, bytes, { contentType: "image/jpeg", upsert: false });
    if (upErr) {
      return jsonResp(cors, 500, { success: false, error: `Photo upload failed: ${upErr.message}` });
    }
    const { data: urlData } = db.storage.from("evidence").getPublicUrl(storagePath);
    const photoUrl = urlData.publicUrl;

    // ── Run inference tiers in parallel for speed ─────────────────────────
    // Plate Recognizer and Railway are independent; fire both simultaneously.
    const [prResult, railwayResult] = await Promise.all([
      callPlateRecognizer(bytes, regions),
      callRailway(b64),
    ]);

    // ── Merge results: plate from best source, embedding from Railway ─────
    const result: PlateResult = {
      // Plate: tier 1 (Plate Recognizer) wins, then tier 2 (Railway OpenAI Vision),
      // then tier 3 (client OnSpace AI data)
      plate: prResult?.plate ?? railwayResult?.plate ?? clientPlate,
      plate_confidence:
        prResult?.plate_confidence ?? railwayResult?.plate_confidence ?? clientConfidence,
      region: prResult?.region ?? null,

      // Vehicle metadata: Plate Recognizer wins, Railway fills gaps, client as last resort
      vehicle_make:   prResult?.vehicle_make   ?? railwayResult?.vehicle_make   ?? clientMake,
      vehicle_model:  prResult?.vehicle_model  ?? railwayResult?.vehicle_model  ?? clientModel,
      vehicle_colour: prResult?.vehicle_colour ?? railwayResult?.vehicle_colour ?? clientColour,
      vehicle_type:   prResult?.vehicle_type   ?? null,
      vehicle_year:   railwayResult?.vehicle_year ?? clientYear,
      self_contained: railwayResult?.self_contained ?? clientSC,

      // Visual embedding always from Railway (separate from plate recognition)
      embedding:               railwayResult?.embedding ?? null,
      embedding_quality:       railwayResult?.embedding_quality ?? null,
      embedding_model_version: railwayResult?.embedding_model_version ?? null,

      // Source label for audit trail
      source: prResult?.plate
        ? "plate_recognizer"
        : railwayResult?.plate
          ? "railway"
          : clientPlate
            ? "onspace_fallback"
            : "no_plate",
    };

    const plateNumber = result.plate ?? "MANUAL_REQUIRED";
    console.log(`📌 Final: plate=${result.plate} source=${result.source} embed=${!!result.embedding}`);

    // ── Upsert canonical vehicle ───────────────────────────────────────────
    if (result.plate && result.plate !== "MANUAL_REQUIRED") {
      const { data: cv } = await db
        .from("canonical_vehicles")
        .select("plate_number")
        .eq("plate_number", result.plate)
        .maybeSingle();

      if (!cv) {
        await db.from("canonical_vehicles").insert({
          plate_number: result.plate,
          vehicle_make:  result.vehicle_make,
          vehicle_model: result.vehicle_model,
          vehicle_color: result.vehicle_colour,
          first_seen_at: recordedAt,
          last_seen_at:  recordedAt,
          total_observations: 1,
        });
      } else {
        await db.from("canonical_vehicles")
          .update({
            last_seen_at: recordedAt,
            ...(result.vehicle_make   ? { vehicle_make:  result.vehicle_make  } : {}),
            ...(result.vehicle_model  ? { vehicle_model: result.vehicle_model } : {}),
            ...(result.vehicle_colour ? { vehicle_color: result.vehicle_colour } : {}),
          })
          .eq("plate_number", result.plate);
      }
    }

    // ── Insert observation ─────────────────────────────────────────────────
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const row: Record<string, any> = {
      idempotency_key:   idempotencyKey,
      plate_number:      plateNumber,
      photo_url:         photoUrl,
      photo_hash:        hash,
      recorded_at:       recordedAt,
      zone_id:           zoneId,
      organization_id:   organizationId,
      gps_latitude:      gpsLatitude,
      gps_longitude:     gpsLongitude,
      gps_accuracy:      gpsAccuracy,
      recorded_by:       officerId,
      officer_notes:     officerNotes,
      weather_conditions: weatherConditions,
      vehicle_make:      result.vehicle_make,
      vehicle_model:     result.vehicle_model,
      vehicle_color:     result.vehicle_colour,
      vehicle_year:      result.vehicle_year,
      self_contained:    result.self_contained,
      is_compliant:      true,
      nights_stayed_this_month: 0,
      consecutive_nights: 0,
    };

    // Vector embedding — only populated when Railway inference is available
    if (result.embedding) {
      row.vehicle_embedding          = `[${result.embedding.join(",")}]`;
      row.embedding_quality          = result.embedding_quality;
      row.embedding_model_version    = result.embedding_model_version;
      row.embedding_created_at       = new Date().toISOString();
    }

    const { data: obs, error: obsErr } = await db
      .from("observations")
      .insert(row)
      .select()
      .single();
    if (obsErr) {
      return jsonResp(cors, 500, { success: false, error: `Observation insert failed: ${obsErr.message}` });
    }

    console.log(`✅ Observation ${obs.id} saved (source=${result.source})`);

    // ── ParkPow post-recognition pipeline ─────────────────────────────────
    // Runs asynchronously after the observation is saved so it never blocks
    // the response to the officer app. Failures are logged but non-fatal.
    let parkpow_watchlist: { is_flagged: boolean; is_permitted: boolean } | null = null;
    let parkpow_session_id: number | null = null;

    if (isParkPowEnabled() && result.plate && result.plate !== "MANUAL_REQUIRED") {
      try {
        // Step 4: Watchlist check — is this plate flagged or exempt?
        parkpow_watchlist = await checkWatchlist(result.plate);

        if (parkpow_watchlist.is_flagged || parkpow_watchlist.is_permitted) {
          // Reflect ParkPow status back into canonical_vehicles
          await db.from("canonical_vehicles").update({
            ...(parkpow_watchlist.is_flagged   ? { is_flagged: true }  : {}),
            ...(parkpow_watchlist.is_permitted ? { is_exempt: true }   : {}),
          }).eq("plate_number", result.plate);
          console.log(`🚩 ParkPow: plate=${result.plate} flagged=${parkpow_watchlist.is_flagged} permitted=${parkpow_watchlist.is_permitted}`);
        }

        // Step 5: Create ParkPow session (vehicle entered zone)
        // Requires the zone to have a parkpow_lot_id — set via parkpow-sync?action=sync-lots
        const { data: zone } = await db
          .from("zones")
          .select("parkpow_lot_id")
          .eq("id", zoneId)
          .maybeSingle();

        if (zone?.parkpow_lot_id) {
          const session = await createSession({
            lot_id:     zone.parkpow_lot_id,
            plate:      result.plate,
            entry_time: recordedAt,
            camera_id:  zoneId,
          });
          parkpow_session_id = session.id;

          // Store session ID on the observation for later violation push
          await db.from("observations")
            .update({ parkpow_session_id: session.id })
            .eq("id", obs.id);

          console.log(`📋 ParkPow session ${session.id} created for ${result.plate} in lot ${zone.parkpow_lot_id}`);

          // If the vehicle is flagged, immediately create a violation in ParkPow
          if (parkpow_watchlist.is_flagged) {
            const violation = await createViolation({
              session_id: session.id,
              reason: "Vehicle on ParkPow block list — enforcement target",
            });
            await db.from("observations")
              .update({ parkpow_violation_id: violation.id })
              .eq("id", obs.id);
            console.log(`⚠️  ParkPow violation ${violation.id} created for flagged vehicle ${result.plate}`);
          }
        } else {
          console.log(`ℹ️  Zone ${zoneId} has no parkpow_lot_id — run parkpow-sync?action=sync-lots to link zones`);
        }
      } catch (ppErr) {
        // ParkPow steps are always non-fatal — officer app must not be blocked
        console.warn("⚠️  ParkPow pipeline failed (non-fatal):", ppErr);
      }
    }

    return jsonResp(cors, 200, {
      success: true,
      observation_id:   obs.id,
      plate:            result.plate,
      plate_number:     result.plate,       // alias for PlateScanner.tsx
      plate_confidence: result.plate_confidence,
      photo_url:        photoUrl,
      photo_hash:       hash,
      vehicle_make:     result.vehicle_make,
      vehicle_model:    result.vehicle_model,
      vehicle_colour:   result.vehicle_colour,
      embedding_quality: result.embedding_quality,
      requires_manual_entry: !result.plate,
      inference_source: result.source,
      // ParkPow results (null when PARKPOW_API_TOKEN not set or no lot linked yet)
      parkpow_flagged:   parkpow_watchlist?.is_flagged   ?? null,
      parkpow_permitted: parkpow_watchlist?.is_permitted ?? null,
      parkpow_session_id,
    });

  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("❌ orc-ingest error:", msg);
    return jsonResp(cors, 500, { success: false, error: msg });
  }
});
