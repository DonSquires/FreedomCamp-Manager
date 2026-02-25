// orc-ingest — Unified vehicle observation ingest with ORC/AI embedding
// ============================================================================
// PIPELINE (priority order):
//   1. Railway ORC/AI  (INFERENCE_SERVICE_URL is set and healthy)
//      POST /infer → YOLOv8n detect + MobileNetV3 384D embed
//      + optional OpenAI Vision plate/make/model/colour (if OPENAI_API_KEY set
//        on the Railway service).
//   2. OnSpace AI fallback  (Railway unavailable or not configured)
//      Accepts client-side plate + vehicle metadata from request body.
//
// Stores result in `observations` table (correct schema, not vehicle_observations_v2).
// Adds vector embedding columns when available (migration 20260225_orc_ai).
// ============================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.7";

const ALLOWED_LOCALHOST = new Set(["http://localhost:5173", "http://localhost:3000"]);

function getCorsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get("origin") ?? "";
  const ok = ALLOWED_LOCALHOST.has(origin) || origin.endsWith(".onspace.build");
  return {
    ...(ok ? { "Access-Control-Allow-Origin": origin } : {}),
    Vary: "Origin",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "authorization, apikey, x-client-info, content-type",
    "Access-Control-Max-Age": "3600",
  };
}

function json(cors: Record<string, string>, status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "content-type": "application/json" },
  });
}

async function sha256hex(data: Uint8Array): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("");
}

interface InferenceResult {
  plate: string | null;
  plate_confidence: number | null;
  embedding: number[] | null;
  embedding_quality: number | null;
  embedding_model_version: string | null;
  vehicle_make: string | null;
  vehicle_model: string | null;
  vehicle_colour: string | null;
  vehicle_year: number | null;
  self_contained: boolean;
  source: "railway" | "onspace_fallback" | "no_plate";
}

async function callRailway(imageBase64: string): Promise<InferenceResult | null> {
  const url = Deno.env.get("INFERENCE_SERVICE_URL");
  if (!url) return null;
  try {
    const resp = await fetch(`${url}/infer`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ image_base64: imageBase64 }),
      signal: AbortSignal.timeout(20_000),
    });
    if (resp.status === 503) { console.warn("Railway degraded (503)"); return null; }
    if (!resp.ok) { console.warn(`Railway HTTP ${resp.status}`); return null; }
    const d = await resp.json();
    if (!d.success) return null;
    return {
      plate: d.plate ?? null,
      plate_confidence: d.plate_confidence ?? null,
      embedding: d.embedding ?? null,
      embedding_quality: d.embedding_quality ?? null,
      embedding_model_version: d.embedding_model_version ?? null,
      vehicle_make: d.vehicle_make ?? null,
      vehicle_model: d.vehicle_model ?? null,
      vehicle_colour: d.vehicle_colour ?? null,
      vehicle_year: d.vehicle_year ?? null,
      self_contained: d.self_contained ?? false,
      source: "railway",
    };
  } catch (e) {
    console.warn("Railway failed:", e instanceof Error ? e.message : e);
    return null;
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { status: 200, headers: getCorsHeaders(req) });

  const cors = getCorsHeaders(req);
  const auth = req.headers.get("Authorization") ?? "";
  if (!auth.startsWith("Bearer ")) return json(cors, 401, { success: false, error: "Missing Authorization header" });

  try {
    const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const body = await req.json();

    const {
      image, zoneId, organizationId, officerId, idempotencyKey,
      gpsLatitude, gpsLongitude, gpsAccuracy = null,
      recordedAt = new Date().toISOString(),
      officerNotes = null, weatherConditions = null,
      plate: clientPlate = null, confidence: clientConfidence = null,
      requires_manual_entry: _clientManual = false,
      vehicle_make: clientMake = null, vehicle_model: clientModel = null,
      vehicle_colour: clientColour = null, vehicle_year: clientYear = null,
      self_contained: clientSC = false,
    } = body;

    if (!image)          return json(cors, 400, { success: false, error: "Missing image" });
    if (!zoneId)         return json(cors, 400, { success: false, error: "Missing zoneId" });
    if (!organizationId) return json(cors, 400, { success: false, error: "Missing organizationId" });
    if (!officerId)      return json(cors, 400, { success: false, error: "Missing officerId" });
    if (!idempotencyKey) return json(cors, 400, { success: false, error: "Missing idempotencyKey" });
    if (!gpsLatitude || !gpsLongitude) return json(cors, 400, { success: false, error: "Missing GPS" });

    // Idempotency
    const { data: existing } = await db.from("observations").select("id").eq("idempotency_key", idempotencyKey).maybeSingle();
    if (existing) return json(cors, 200, { success: true, duplicate: true, observation_id: existing.id });

    // Decode & upload photo
    const b64 = image.includes(",") ? image.split(",")[1] : image;
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);

    const hash = await sha256hex(bytes);
    const path = `${officerId}/${Date.now()}-${hash.slice(0, 8)}.jpg`;
    const { error: upErr } = await db.storage.from("evidence").upload(path, bytes, { contentType: "image/jpeg", upsert: false });
    if (upErr) return json(cors, 500, { success: false, error: `Upload failed: ${upErr.message}` });
    const { data: urlData } = db.storage.from("evidence").getPublicUrl(path);

    // Inference routing
    const railway = await callRailway(b64);
    const inf: InferenceResult = railway ?? {
      plate: clientPlate, plate_confidence: clientConfidence,
      embedding: null, embedding_quality: null, embedding_model_version: null,
      vehicle_make: clientMake, vehicle_model: clientModel,
      vehicle_colour: clientColour, vehicle_year: clientYear,
      self_contained: clientSC,
      source: clientPlate ? "onspace_fallback" : "no_plate",
    };

    const plate = inf.plate ?? "MANUAL_REQUIRED";

    // Upsert canonical vehicle
    if (inf.plate && inf.plate !== "MANUAL_REQUIRED") {
      const { data: cv } = await db.from("canonical_vehicles").select("plate_number").eq("plate_number", inf.plate).maybeSingle();
      if (!cv) {
        await db.from("canonical_vehicles").insert({
          plate_number: inf.plate, vehicle_make: inf.vehicle_make,
          vehicle_model: inf.vehicle_model, vehicle_color: inf.vehicle_colour,
          first_seen_at: recordedAt, last_seen_at: recordedAt, total_observations: 1,
        });
      } else {
        await db.from("canonical_vehicles").update({
          last_seen_at: recordedAt,
          ...(inf.vehicle_make  ? { vehicle_make: inf.vehicle_make }   : {}),
          ...(inf.vehicle_model ? { vehicle_model: inf.vehicle_model } : {}),
          ...(inf.vehicle_colour? { vehicle_color: inf.vehicle_colour }: {}),
        }).eq("plate_number", inf.plate);
      }
    }

    // Build observation row
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const row: Record<string, any> = {
      idempotency_key: idempotencyKey, plate_number: plate,
      photo_url: urlData.publicUrl, photo_hash: hash,
      recorded_at: recordedAt, zone_id: zoneId, organization_id: organizationId,
      gps_latitude: gpsLatitude, gps_longitude: gpsLongitude, gps_accuracy: gpsAccuracy,
      recorded_by: officerId, officer_notes: officerNotes, weather_conditions: weatherConditions,
      vehicle_make: inf.vehicle_make, vehicle_model: inf.vehicle_model,
      vehicle_color: inf.vehicle_colour, vehicle_year: inf.vehicle_year,
      self_contained: inf.self_contained,
      is_compliant: true, nights_stayed_this_month: 0, consecutive_nights: 0,
    };

    // Vector embedding — only if migration 20260225_orc_ai has run
    if (inf.embedding) {
      row.vehicle_embedding    = `[${inf.embedding.join(",")}]`;
      row.embedding_quality    = inf.embedding_quality;
      row.embedding_model_version = inf.embedding_model_version;
      row.embedding_created_at = new Date().toISOString();
    }

    const { data: obs, error: obsErr } = await db.from("observations").insert(row).select().single();
    if (obsErr) return json(cors, 500, { success: false, error: `Observation insert failed: ${obsErr.message}` });

    return json(cors, 200, {
      success: true,
      observation_id: obs.id,
      plate: inf.plate,
      plate_number: inf.plate,
      plate_confidence: inf.plate_confidence,
      photo_url: urlData.publicUrl,
      photo_hash: hash,
      embedding_quality: inf.embedding_quality,
      requires_manual_entry: !inf.plate,
      inference_source: inf.source,
      vehicle_make: inf.vehicle_make,
      vehicle_model: inf.vehicle_model,
      vehicle_colour: inf.vehicle_colour,
    });

  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("orc-ingest error:", msg);
    return json(cors, 500, { success: false, error: msg });
  }
});
