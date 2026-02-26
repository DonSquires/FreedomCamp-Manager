// ============================================================================
// process-field-scan
// ============================================================================
// Processes a completed field scan: upserts canonical_vehicles, inserts an
// observation record, and returns enriched vehicle + compliance data.
//
// Called by:
//   - src/components/features/PlateCapture.tsx  (live scanning)
//   - src/hooks/useOfflineQueue.ts               (offline sync)
//
// Request body (JSON):
//   plateNumber      string   Recognised plate number
//   zoneId           string   UUID of the current zone
//   organizationId   string   UUID of the organisation
//   imageUrl         string   Already-uploaded storage URL  OR  base64 data URL
//   gpsLocation      object   { lat, lng, accuracy }
//   vehicleDetails   object   { make, model, color, year }
//   detectionMethod  string   'alpr' | 'ocr' | 'manual'
//   confidence       number   0-1 recognition confidence
//   isSelfContained  boolean
//   hasGreenSticker  boolean
//   hasBlueSticker   boolean
//   notes            string?  Officer notes
//   timestamp        string?  ISO timestamp override
//
// Response (JSON):
//   vehicle_id               string   plate_number (canonical_vehicles PK)
//   observation_id           string   UUID
//   is_compliant             boolean
//   is_flagged               boolean
//   prior_observations_count number
//   vehicle_details          object   { make, model, color, year }
//
// Error (409):
//   { error: 'duplicate_scan', duplicate: true,
//     details: { minutes_ago: number, zone_name: string } }
// ============================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.7";
import { corsHeaders } from "../_shared/cors.ts";

async function sha256Hash(data: Uint8Array): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Compute SHA-256 of a UTF-8 string (used when only a URL is available). */
async function sha256String(str: string): Promise<string> {
  const enc = new TextEncoder();
  return sha256Hash(enc.encode(str));
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { status: 200, headers: corsHeaders });
  }

  // Auth guard
  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) {
    return new Response(
      JSON.stringify({ error: "Missing or malformed Authorization header" }),
      { status: 401, headers: { ...corsHeaders, "content-type": "application/json" } }
    );
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceKey) {
    return new Response(
      JSON.stringify({ error: "Server misconfiguration: missing required environment variables" }),
      { status: 500, headers: { ...corsHeaders, "content-type": "application/json" } }
    );
  }
  const db = createClient(supabaseUrl, serviceKey);

  // Resolve officer UUID from JWT using the anon client so RLS applies
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  const anonClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: { user }, error: userErr } = await anonClient.auth.getUser();
  if (userErr || !user) {
    return new Response(
      JSON.stringify({ error: "Unauthorized: invalid session" }),
      { status: 401, headers: { ...corsHeaders, "content-type": "application/json" } }
    );
  }

  // Look up user_profiles record (id is referenced by observations.recorded_by)
  const { data: profile } = await db
    .from("user_profiles")
    .select("id")
    .eq("user_id", user.id)
    .maybeSingle();

  const officerProfileId = profile?.id ?? user.id;

  try {
    const body = await req.json();

    const {
      plateNumber,
      zoneId,
      organizationId,
      imageUrl,
      gpsLocation,
      vehicleDetails = {},
      detectionMethod = "alpr",
      confidence = null,
      isSelfContained = false,
      hasGreenSticker = false,
      hasBlueSticker = false,
      notes = null,
      timestamp = null,
    } = body;

    // ── Validate required fields ──────────────────────────────────────────
    if (!plateNumber) {
      return new Response(
        JSON.stringify({ error: "plateNumber is required" }),
        { status: 400, headers: { ...corsHeaders, "content-type": "application/json" } }
      );
    }
    if (!zoneId || !organizationId) {
      return new Response(
        JSON.stringify({ error: "zoneId and organizationId are required" }),
        { status: 400, headers: { ...corsHeaders, "content-type": "application/json" } }
      );
    }
    if (!gpsLocation?.lat || !gpsLocation?.lng) {
      return new Response(
        JSON.stringify({ error: "gpsLocation with lat/lng is required" }),
        { status: 400, headers: { ...corsHeaders, "content-type": "application/json" } }
      );
    }

    const recordedAt = timestamp ?? new Date().toISOString();
    const plate = (plateNumber as string).toUpperCase().trim();

    // ── Duplicate detection (same plate + zone within 30 minutes) ─────────
    const thirtyMinutesAgo = new Date(Date.now() - 30 * 60 * 1000).toISOString();
    const { data: recentObs } = await db
      .from("observations")
      .select("id, recorded_at, zones(name)")
      .eq("plate_number", plate)
      .eq("zone_id", zoneId)
      .gte("recorded_at", thirtyMinutesAgo)
      .is("deleted_at", null)
      .order("recorded_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (recentObs) {
      const minutesAgo = Math.round(
        (Date.now() - new Date(recentObs.recorded_at).getTime()) / 60_000
      );
      const zoneName = (recentObs.zones as { name?: string } | null)?.name ?? "this zone";
      return new Response(
        JSON.stringify({
          error: "duplicate_scan",
          duplicate: true,
          details: { minutes_ago: minutesAgo, zone_name: zoneName },
        }),
        { status: 409, headers: { ...corsHeaders, "content-type": "application/json" } }
      );
    }

    // ── Photo handling ─────────────────────────────────────────────────────
    let photoUrl: string;
    let photoHash: string;

    if (imageUrl && (imageUrl as string).startsWith("data:")) {
      // Base64 data URL → decode, hash, upload
      const base64Data = (imageUrl as string).split(",")[1];
      const binaryString = atob(base64Data);
      const imageBytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        imageBytes[i] = binaryString.charCodeAt(i);
      }
      photoHash = await sha256Hash(imageBytes);
      const fileName = `${officerProfileId}/${Date.now()}-${photoHash.substring(0, 8)}.jpg`;
      const { error: uploadError } = await db.storage
        .from("evidence")
        .upload(fileName, imageBytes, { contentType: "image/jpeg", upsert: false });
      if (uploadError) {
        console.warn("⚠️ Photo upload failed:", uploadError.message);
        photoHash = await sha256String(imageUrl as string);
        photoUrl  = imageUrl as string;
      } else {
        const { data: urlData } = db.storage.from("evidence").getPublicUrl(fileName);
        photoUrl = urlData.publicUrl;
      }
    } else if (imageUrl) {
      // Already-uploaded HTTP URL
      photoUrl  = imageUrl as string;
      photoHash = await sha256String(imageUrl as string);
    } else {
      return new Response(
        JSON.stringify({ error: "imageUrl is required" }),
        { status: 400, headers: { ...corsHeaders, "content-type": "application/json" } }
      );
    }

    // ── Upsert canonical_vehicles ─────────────────────────────────────────
    const { data: existingVehicle } = await db
      .from("canonical_vehicles")
      .select("plate_number, vehicle_make, vehicle_model, vehicle_color, vehicle_year, is_flagged, total_observations")
      .eq("plate_number", plate)
      .maybeSingle();

    if (!existingVehicle) {
      await db.from("canonical_vehicles").insert({
        plate_number:  plate,
        vehicle_make:  vehicleDetails.make  ?? null,
        vehicle_model: vehicleDetails.model ?? null,
        vehicle_color: vehicleDetails.color ?? null,
        vehicle_year:  vehicleDetails.year ? parseInt(vehicleDetails.year) : null,
        self_contained: isSelfContained || hasGreenSticker || hasBlueSticker,
        first_seen_at:  recordedAt,
        last_seen_at:   recordedAt,
        total_observations: 1,
      });
    } else {
      await db.from("canonical_vehicles").update({
        vehicle_make:  vehicleDetails.make  ?? existingVehicle.vehicle_make,
        vehicle_model: vehicleDetails.model ?? existingVehicle.vehicle_model,
        vehicle_color: vehicleDetails.color ?? existingVehicle.vehicle_color,
        vehicle_year:  vehicleDetails.year
          ? parseInt(vehicleDetails.year)
          : existingVehicle.vehicle_year,
        self_contained: isSelfContained || hasGreenSticker || hasBlueSticker,
        last_seen_at:   recordedAt,
        total_observations: (existingVehicle.total_observations ?? 0) + 1,
        updated_at: new Date().toISOString(),
      }).eq("plate_number", plate);
    }

    // ── Insert observation ─────────────────────────────────────────────────
    const idempotencyKey = `${officerProfileId}:${plate}:${zoneId}:${Date.now()}`;

    const { data: observation, error: obsError } = await db
      .from("observations")
      .insert({
        idempotency_key:   idempotencyKey,
        plate_number:      plate,
        photo_url:         photoUrl,
        photo_hash:        photoHash,
        recorded_at:       recordedAt,
        zone_id:           zoneId,
        organization_id:   organizationId,
        gps_latitude:      gpsLocation.lat,
        gps_longitude:     gpsLocation.lng,
        gps_accuracy:      gpsLocation.accuracy ?? null,
        recorded_by:       officerProfileId,
        officer_notes:     notes ?? null,
        vehicle_make:      vehicleDetails.make  ?? null,
        vehicle_model:     vehicleDetails.model ?? null,
        vehicle_color:     vehicleDetails.color ?? null,
        vehicle_year:      vehicleDetails.year ? parseInt(vehicleDetails.year) : null,
        self_contained:    isSelfContained || hasGreenSticker || hasBlueSticker,
        is_compliant:      true, // will be updated by DB triggers
      })
      .select()
      .single();

    if (obsError) {
      console.error("❌ Failed to create observation:", obsError.message);
      return new Response(
        JSON.stringify({ error: "Failed to create observation: " + obsError.message }),
        { status: 500, headers: { ...corsHeaders, "content-type": "application/json" } }
      );
    }

    // ── Fetch updated canonical vehicle data ──────────────────────────────
    const { data: vehicle } = await db
      .from("canonical_vehicles")
      .select("vehicle_make, vehicle_model, vehicle_color, vehicle_year, is_flagged, total_observations")
      .eq("plate_number", plate)
      .maybeSingle();

    // ── Count prior observations (excluding the one just created) ─────────
    const priorCount = Math.max(0, (vehicle?.total_observations ?? 1) - 1);

    console.log(`✅ Field scan processed: plate=${plate} obs=${observation.id}`);

    return new Response(
      JSON.stringify({
        success:                  true,
        vehicle_id:               plate,
        observation_id:           observation.id,
        is_compliant:             observation.is_compliant ?? true,
        is_flagged:               vehicle?.is_flagged ?? false,
        prior_observations_count: priorCount,
        vehicle_details: {
          make:  vehicle?.vehicle_make  ?? vehicleDetails.make  ?? null,
          model: vehicle?.vehicle_model ?? vehicleDetails.model ?? null,
          color: vehicle?.vehicle_color ?? vehicleDetails.color ?? null,
          year:  vehicle?.vehicle_year  ?? (vehicleDetails.year ? parseInt(vehicleDetails.year) : null),
        },
      }),
      { status: 200, headers: { ...corsHeaders, "content-type": "application/json" } }
    );
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("❌ process-field-scan error:", msg);
    return new Response(
      JSON.stringify({ error: msg }),
      { status: 500, headers: { ...corsHeaders, "content-type": "application/json" } }
    );
  }
});
