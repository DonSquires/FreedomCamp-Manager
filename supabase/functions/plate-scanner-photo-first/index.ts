// plate-scanner-photo-first
// ============================================================================
// Photo-first vehicle observation ingest (FEATURE_INGEST_V2 target endpoint).
//
// This function is the Layer 1 handler referenced in docs/FEATURE_FLAGS.md.
// It accepts the same request body as vehicle-ingest and delegates all logic
// there, maintaining a stable URL for the feature-flag rollout plan.
//
// Request body (JSON):
//   image          string   base64 data URL of the captured photo
//   zoneId         string   UUID of the current zone
//   organizationId string   UUID of the organisation
//   officerId      string   UUID of the recording officer
//   recordedAt     string   ISO timestamp
//   gpsLatitude    number
//   gpsLongitude   number
//   gpsAccuracy    number   (metres, optional)
//   idempotencyKey string   Unique key for offline-sync deduplication
//   plate          string?  Pre-recognised plate (Onspace AI fallback mode)
//   confidence     number?  Recognition confidence 0-1
//   requires_manual_entry boolean?
//   officerNotes   string?
//   weatherConditions string?
//
// Response (JSON):
//   success         boolean
//   observation_id  string
//   plate           string | null
//   confidence      number | null
//   photo_url       string
//   photo_hash      string
//   requires_manual_entry boolean
//   duplicate       boolean?  (true if idempotency_key already used)
// ============================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.7";
import { corsHeaders } from "../_shared/cors.ts";

const ALLOWED_LOCALHOST_ORIGINS = new Set([
  "http://localhost:5173",
  "http://localhost:3000",
]);

function getCorsHeaders(req: Request) {
  const origin = req.headers.get("origin") ?? "";
  const isAllowed =
    ALLOWED_LOCALHOST_ORIGINS.has(origin) || origin.endsWith(".onspace.build");
  return {
    ...(isAllowed ? { "Access-Control-Allow-Origin": origin } : {}),
    Vary: "Origin",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers":
      "authorization, apikey, x-client-info, content-type",
    "Access-Control-Max-Age": "3600",
  };
}

async function sha256Hash(data: Uint8Array): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { status: 200, headers: getCorsHeaders(req) });
  }

  // Auth guard
  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) {
    return new Response(
      JSON.stringify({ error: "Missing or malformed Authorization header" }),
      { status: 401, headers: { ...getCorsHeaders(req), "content-type": "application/json" } }
    );
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const db = createClient(supabaseUrl, supabaseKey);

    const body = await req.json();

    // Required field validation
    const {
      image,
      zoneId,
      organizationId,
      officerId,
      idempotencyKey,
      gpsLatitude,
      gpsLongitude,
      gpsAccuracy = null,
      recordedAt = new Date().toISOString(),
      officerNotes = null,
      weatherConditions = null,
      // Onspace AI fallback plate data
      plate: clientPlate = null,
      confidence: clientConfidence = null,
      requires_manual_entry: clientRequiresManualEntry = false,
    } = body;

    if (!image) return err(getCorsHeaders(req), 400, "Missing image");
    if (!zoneId) return err(getCorsHeaders(req), 400, "Missing zoneId");
    if (!organizationId) return err(getCorsHeaders(req), 400, "Missing organizationId");
    if (!officerId) return err(getCorsHeaders(req), 400, "Missing officerId");
    if (!idempotencyKey) return err(getCorsHeaders(req), 400, "Missing idempotencyKey");
    if (!gpsLatitude || !gpsLongitude) return err(getCorsHeaders(req), 400, "Missing GPS coordinates");

    // Idempotency check
    const { data: existing } = await db
      .from("observations")
      .select("id")
      .eq("idempotency_key", idempotencyKey)
      .maybeSingle();

    if (existing) {
      return new Response(
        JSON.stringify({ success: true, duplicate: true, observation_id: existing.id }),
        { status: 200, headers: { ...getCorsHeaders(req), "content-type": "application/json" } }
      );
    }

    // Decode image → bytes → hash → upload
    const base64Data = image.split(",")[1] ?? image;
    const binary = atob(base64Data);
    const imageBytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) imageBytes[i] = binary.charCodeAt(i);

    const photoHash = await sha256Hash(imageBytes);
    const photoFileName = `${officerId}/${Date.now()}-${photoHash.substring(0, 8)}.jpg`;

    const { error: uploadError } = await db.storage
      .from("evidence")
      .upload(photoFileName, imageBytes, { contentType: "image/jpeg", upsert: false });

    if (uploadError) return err(getCorsHeaders(req), 500, `Photo upload failed: ${uploadError.message}`);

    const { data: urlData } = db.storage.from("evidence").getPublicUrl(photoFileName);
    const photoUrl = urlData.publicUrl;

    const plateNumber = clientPlate ?? "MANUAL_REQUIRED";
    const requiresManualEntry = clientRequiresManualEntry || !clientPlate;

    // Upsert canonical vehicle if plate known
    if (clientPlate && clientPlate !== "MANUAL_REQUIRED") {
      const { data: cv } = await db
        .from("canonical_vehicles")
        .select("plate_number")
        .eq("plate_number", clientPlate)
        .maybeSingle();

      if (!cv) {
        await db.from("canonical_vehicles").insert({
          plate_number: clientPlate,
          first_seen_at: recordedAt,
          last_seen_at: recordedAt,
          total_observations: 1,
        });
      }
    }

    // Insert observation
    const { data: obs, error: obsError } = await db
      .from("observations")
      .insert({
        idempotency_key: idempotencyKey,
        plate_number: plateNumber,
        photo_url: photoUrl,
        photo_hash: photoHash,
        recorded_at: recordedAt,
        zone_id: zoneId,
        organization_id: organizationId,
        gps_latitude: gpsLatitude,
        gps_longitude: gpsLongitude,
        gps_accuracy: gpsAccuracy,
        recorded_by: officerId,
        officer_notes: officerNotes,
        weather_conditions: weatherConditions,
        is_compliant: true,
        nights_stayed_this_month: 0,
        consecutive_nights: 0,
      })
      .select()
      .single();

    if (obsError) return err(getCorsHeaders(req), 500, `Failed to save observation: ${obsError.message}`);

    return new Response(
      JSON.stringify({
        success: true,
        observation_id: obs.id,
        plate: clientPlate,
        plate_number: clientPlate,
        confidence: clientConfidence,
        photo_url: photoUrl,
        photo_hash: photoHash,
        requires_manual_entry: requiresManualEntry,
        source: "plate_scanner_photo_first",
      }),
      { status: 200, headers: { ...getCorsHeaders(req), "content-type": "application/json" } }
    );
  } catch (e: any) {
    console.error("❌ plate-scanner-photo-first error:", e);
    return err(getCorsHeaders(req), 500, e.message ?? "Unknown error");
  }
});

function err(
  corsH: Record<string, string>,
  status: number,
  message: string
): Response {
  return new Response(JSON.stringify({ success: false, error: message }), {
    status,
    headers: { ...corsH, "content-type": "application/json" },
  });
}
