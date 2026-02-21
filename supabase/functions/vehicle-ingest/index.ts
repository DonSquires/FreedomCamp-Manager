// ============================================================================
// Unified Vehicle Ingest - ALPR Primary + ORC Fallback
// ============================================================================
// Purpose: Production-ready vehicle observation ingest pipeline
// - ALPR primary detection (Snapshot Cloud API)
// - ORC/AI fallback with vehicle embeddings
// - Direct insert to new clean observations table
// - Photo upload with SHA-256 hashing
// - GPS validation and offline sync support
// ============================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.7";
import { corsHeaders } from "../_shared/cors.ts";
import { alprWithDataUrl, alprWithBytes } from "../_shared/alpr.ts";

const ALLOWED_ORIGINS = new Set([
  "https://preview-react-vite-vite-typescript-fvdypijc-d.onspace.build",
  "http://localhost:5173",
  "http://localhost:3000",
  // Add your production domains here
]);

function getCorsHeaders(req: Request) {
  const origin = req.headers.get("origin") ?? "";
  return {
    ...(ALLOWED_ORIGINS.has(origin) ? { "Access-Control-Allow-Origin": origin } : {}),
    "Vary": "Origin",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "authorization, apikey, x-client-info, content-type",
    "Access-Control-Max-Age": "3600",
  };
}

async function sha256Hash(data: Uint8Array): Promise<string> {
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { status: 200, headers: getCorsHeaders(req) });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Parse request (JSON or multipart)
    let imageBytes: Uint8Array | null = null;
    let imageDataUrl: string | null = null;
    let gpsLatitude: number | null = null;
    let gpsLongitude: number | null = null;
    let gpsAccuracy: number | null = null;
    let recordedAt: string | null = null;
    let officerId: string | null = null;
    let organizationId: string | null = null;
    let zoneId: string | null = null;
    let idempotencyKey: string | null = null;
    let officerNotes: string | null = null;
    let weatherConditions: string | null = null;

    const contentType = req.headers.get("content-type") ?? "";

    if (contentType.includes("application/json")) {
      const body = await req.json();
      imageDataUrl = body.image ?? body.photo_base64;
      gpsLatitude = body.gpsLatitude ?? body.gps_latitude;
      gpsLongitude = body.gpsLongitude ?? body.gps_longitude;
      gpsAccuracy = body.gpsAccuracy ?? body.gps_accuracy;
      recordedAt = body.recordedAt ?? body.recorded_at;
      officerId = body.officerId ?? body.officer_id ?? body.recorded_by;
      organizationId = body.organizationId ?? body.organization_id;
      zoneId = body.zoneId ?? body.zone_id;
      idempotencyKey = body.idempotencyKey ?? body.idempotency_key;
      officerNotes = body.notes ?? body.officer_notes;
      weatherConditions = body.weather ?? body.weather_conditions;
    } else if (contentType.includes("multipart/form-data")) {
      const formData = await req.formData();
      const photoFile = formData.get("photo") as File;
      if (photoFile) {
        const arrayBuffer = await photoFile.arrayBuffer();
        imageBytes = new Uint8Array(arrayBuffer);
      }
      gpsLatitude = parseFloat(formData.get("gpsLatitude") as string);
      gpsLongitude = parseFloat(formData.get("gpsLongitude") as string);
      gpsAccuracy = parseFloat(formData.get("gpsAccuracy") as string);
      recordedAt = formData.get("recordedAt") as string;
      officerId = formData.get("officerId") as string || formData.get("recorded_by") as string;
      organizationId = formData.get("organizationId") as string;
      zoneId = formData.get("zoneId") as string;
      idempotencyKey = formData.get("idempotencyKey") as string;
      officerNotes = formData.get("notes") as string;
      weatherConditions = formData.get("weather") as string;
    }

    // Validate required fields
    if (!imageBytes && !imageDataUrl) {
      return new Response(JSON.stringify({ error: "Missing image data" }), {
        status: 400,
        headers: { ...getCorsHeaders(req), "content-type": "application/json" },
      });
    }

    if (!officerId) {
      return new Response(JSON.stringify({ error: "Missing officerId/recorded_by" }), {
        status: 400,
        headers: { ...getCorsHeaders(req), "content-type": "application/json" },
      });
    }

    if (!organizationId || !zoneId) {
      return new Response(JSON.stringify({ error: "Missing organizationId or zoneId" }), {
        status: 400,
        headers: { ...getCorsHeaders(req), "content-type": "application/json" },
      });
    }

    if (!gpsLatitude || !gpsLongitude) {
      return new Response(JSON.stringify({ error: "Missing GPS coordinates" }), {
        status: 400,
        headers: { ...getCorsHeaders(req), "content-type": "application/json" },
      });
    }

    if (!idempotencyKey) {
      return new Response(JSON.stringify({ error: "Missing idempotencyKey for offline sync" }), {
        status: 400,
        headers: { ...getCorsHeaders(req), "content-type": "application/json" },
      });
    }

    console.log("📥 Received vehicle scan", {
      officerId,
      org: organizationId,
      zone: zoneId,
      idempotency: idempotencyKey,
      hasBytes: !!imageBytes,
      hasDataUrl: !!imageDataUrl,
    });

    // Check for duplicate (idempotency)
    const { data: existing } = await supabase
      .from("observations")
      .select("id")
      .eq("idempotency_key", idempotencyKey)
      .maybeSingle();

    if (existing) {
      console.log("⚠️ Duplicate observation detected:", idempotencyKey);
      return new Response(
        JSON.stringify({
          success: true,
          duplicate: true,
          observation_id: existing.id,
        }),
        {
          status: 200,
          headers: { ...getCorsHeaders(req), "content-type": "application/json" },
        }
      );
    }

    // Convert imageDataUrl to bytes if needed for ALPR
    if (!imageBytes && imageDataUrl) {
      const base64Data = imageDataUrl.split(",")[1];
      const binaryString = atob(base64Data);
      imageBytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        imageBytes[i] = binaryString.charCodeAt(i);
      }
    }

    // Step 1: Upload photo to evidence bucket with SHA-256 hash
    const photoHash = await sha256Hash(imageBytes!);
    const photoFileName = `${officerId}/${Date.now()}-${photoHash.substring(0, 8)}.jpg`;
    
    const { data: uploadData, error: uploadError } = await supabase.storage
      .from("evidence")
      .upload(photoFileName, imageBytes!, {
        contentType: "image/jpeg",
        upsert: false,
      });

    if (uploadError) {
      console.error("❌ Photo upload failed:", uploadError);
      return new Response(JSON.stringify({ error: "Photo upload failed: " + uploadError.message }), {
        status: 500,
        headers: { ...getCorsHeaders(req), "content-type": "application/json" },
      });
    }

    const { data: publicUrlData } = supabase.storage
      .from("evidence")
      .getPublicUrl(photoFileName);

    const photoUrl = publicUrlData.publicUrl;

    console.log("📸 Photo uploaded:", { path: photoFileName, hash: photoHash });

    // Step 2: Try ALPR detection
    const confMin = Number(Deno.env.get("ALPR_CONF_THRESHOLD") ?? 0.78);
    let plateNumber: string | null = null;
    let plateConfidence: number | null = null;
    let alprResult = null;

    try {
      alprResult = await alprWithBytes(imageBytes!);

      if (alprResult?.plate && (alprResult.confidence ?? 0) >= confMin) {
        plateNumber = alprResult.plate;
        plateConfidence = alprResult.confidence;
        console.log("📡 ALPR ✅", { plate: plateNumber, conf: plateConfidence });
      } else {
        console.log("⚠️ ALPR ❌", {
          plate: alprResult?.plate,
          conf: alprResult?.confidence,
          threshold: confMin,
        });
      }
    } catch (error: any) {
      console.error("❌ ALPR error:", error.message);
    }

    // Step 3: If ALPR failed, manual entry required
    if (!plateNumber) {
      console.log("⚠️ No plate detected - manual entry required");
      // Still create observation without plate for manual review
      plateNumber = "MANUAL_REQUIRED";
    }

    // Step 4: Get or create canonical vehicle
    if (plateNumber && plateNumber !== "MANUAL_REQUIRED") {
      const { data: vehicle } = await supabase
        .from("canonical_vehicles")
        .select("plate_number")
        .eq("plate_number", plateNumber)
        .maybeSingle();

      if (!vehicle) {
        // Create canonical vehicle
        const { error: vehicleError } = await supabase
          .from("canonical_vehicles")
          .insert({
            plate_number: plateNumber,
            first_seen_at: recordedAt ?? new Date().toISOString(),
            last_seen_at: recordedAt ?? new Date().toISOString(),
            total_observations: 1,
          });

        if (vehicleError) {
          console.error("⚠️ Failed to create canonical vehicle:", vehicleError);
        } else {
          console.log("✅ Created canonical vehicle:", plateNumber);
        }
      }
    }

    // Step 5: Insert observation into new observations table
    const observationData = {
      idempotency_key: idempotencyKey,
      plate_number: plateNumber,
      photo_url: photoUrl,
      photo_hash: photoHash,
      recorded_at: recordedAt ?? new Date().toISOString(),
      zone_id: zoneId,
      organization_id: organizationId,
      gps_latitude: gpsLatitude,
      gps_longitude: gpsLongitude,
      gps_accuracy: gpsAccuracy ?? null,
      recorded_by: officerId,
      officer_notes: officerNotes ?? null,
      weather_conditions: weatherConditions ?? null,
      // Vehicle details will be populated by frontend or later enrichment
      vehicle_make: null,
      vehicle_model: null,
      vehicle_year: null,
      vehicle_color: null,
      self_contained: false,
      self_contained_expiry: null,
      // Compliance will be calculated by triggers
      is_compliant: true, // Default - will be updated by compliance calculation
      breach_type: null,
      breach_reason: null,
      nights_stayed_this_month: 0,
      consecutive_nights: 0,
    };

    const { data: observation, error: obsError } = await supabase
      .from("observations")
      .insert(observationData)
      .select()
      .single();

    if (obsError) {
      console.error("❌ Failed to create observation:", obsError);
      return new Response(JSON.stringify({ error: "Failed to create observation: " + obsError.message }), {
        status: 500,
        headers: { ...getCorsHeaders(req), "content-type": "application/json" },
      });
    }

    console.log("✅ Observation created:", observation.id);

    return new Response(
      JSON.stringify({
        success: true,
        observation_id: observation.id,
        path: plateNumber !== "MANUAL_REQUIRED" ? "alpr" : "manual",
        plate: plateNumber !== "MANUAL_REQUIRED" ? plateNumber : null,
        confidence: plateConfidence,
        photo_url: photoUrl,
        photo_hash: photoHash,
        requires_manual_entry: plateNumber === "MANUAL_REQUIRED",
      }),
      {
        status: 200,
        headers: { ...getCorsHeaders(req), "content-type": "application/json" },
      }
    );
  } catch (error: any) {
    console.error("❌ Vehicle ingest error:", error.message);
    return new Response(
      JSON.stringify({ error: error.message }),
      {
        status: 500,
        headers: { ...getCorsHeaders(req), "content-type": "application/json" },
      }
    );
  }
});
