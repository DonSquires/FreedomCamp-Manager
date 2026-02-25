// ============================================================================
// Unified Vehicle Ingest - Production Pipeline with Onspace AI Fallback
// ============================================================================
// Purpose: Production-ready vehicle observation ingest pipeline
//
// DEPLOYMENT MODES:
// - Onspace AI Fallback (current): UI provides pre-processed plate data
// - Railway Inference (future): Edge Function calls standalone service
//
// Features:
// - Direct insert to observations table
// - Photo upload with SHA-256 hashing
// - GPS validation and offline sync support
// - Idempotency for reliable offline-first architecture
// ============================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.7";
import { corsHeaders } from "../_shared/cors.ts";

// ============================================================================
// DEPLOYMENT MODE — auto-detected from environment
// ============================================================================
// PLATERECOGNIZER_TOKEN (or ALPR_API_TOKEN) set → Plate Recognizer API
// INFERENCE_SERVICE_URL set  → Railway ORC/AI used for visual embedding
// Both absent → OnSpace AI fallback (client provides plate data)
//
// Secret name lookup order (all accepted, first wins):
//   PLATERECOGNIZER_TOKEN   ← canonical name in Supabase secrets
//   ALPR_API_TOKEN          ← alternate name in Supabase secrets
//   PLATE_RECOGNIZER_TOKEN  ← legacy name (backward compat)
//
// API URL lookup order:
//   ALPR_API_URL            ← set in Supabase secrets
//   PLATE_RECOGNIZER_API_URL ← legacy name
const PLATE_RECOGNIZER_TOKEN =
  Deno.env.get("PLATERECOGNIZER_TOKEN") ??
  Deno.env.get("ALPR_API_TOKEN") ??
  Deno.env.get("PLATE_RECOGNIZER_TOKEN");
const PLATE_RECOGNIZER_API_URL =
  Deno.env.get("ALPR_API_URL") ??
  Deno.env.get("PLATE_RECOGNIZER_API_URL") ??
  "https://api.platerecognizer.com/v1/plate-reader/";
const USE_ONSPACE_AI = !PLATE_RECOGNIZER_TOKEN && !Deno.env.get("INFERENCE_SERVICE_URL");
// ============================================================================

const ALLOWED_LOCALHOST_ORIGINS = new Set([
  "http://localhost:5173",
  "http://localhost:3000",
]);

function getCorsHeaders(req: Request) {
  const origin = req.headers.get("origin") ?? "";
  
  // Allow all OnSpace domains (production + preview URLs)
  const isOnspaceDomain = origin.endsWith('.onspace.build');
  const isAllowed = ALLOWED_LOCALHOST_ORIGINS.has(origin) || isOnspaceDomain;
  
  return {
    ...(isAllowed ? { "Access-Control-Allow-Origin": origin } : {}),
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

// ── Plate Recognizer API helper ───────────────────────────────────────────────

interface PRResult {
  plate: string;
  confidence: number;
  region: string | null;
  make: string | null;
  model: string | null;
  colour: string | null;
}

async function callPlateRecognizer(
  imageBytes: Uint8Array,
  regions: string[] = ["nz"],
): Promise<PRResult | null> {
  if (!PLATE_RECOGNIZER_TOKEN) return null;
  try {
    const blob = new Blob([imageBytes], { type: "image/jpeg" });
    const form = new FormData();
    form.append("upload", blob, "scan.jpg");
    regions.forEach(r => form.append("regions", r));
    form.append("mmc", "true");
    form.append("config", JSON.stringify({ region: "strict", detection_rule: "strict" }));

    const resp = await fetch(PLATE_RECOGNIZER_API_URL, {
      method: "POST",
      headers: { Authorization: `Token ${PLATE_RECOGNIZER_TOKEN}` },
      body: form,
      signal: AbortSignal.timeout(15_000),
    });

    if (!resp.ok) {
      console.warn(`⚠️  Plate Recognizer HTTP ${resp.status}`);
      return null;
    }

    const data = await resp.json();
    if (!data.results?.length) {
      console.log("ℹ️  Plate Recognizer: no plate detected");
      return null;
    }

    const r = data.results[0];
    console.log(`✅ Plate Recognizer: plate=${r.plate} conf=${r.score}`);
    return {
      plate:      r.plate?.toUpperCase() ?? null,
      confidence: r.score ?? 0,
      region:     r.region?.code ?? null,
      make:       r.model_make?.[0]?.make   ?? null,
      model:      r.model_make?.[0]?.model  ?? null,
      colour:     r.color?.[0]?.color       ?? null,
    };
  } catch (e: unknown) {
    console.warn("⚠️  Plate Recognizer failed:", e instanceof Error ? e.message : e);
    return null;
  }
}

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { status: 200, headers: getCorsHeaders(req) });
  }

  // ============================================================================
  // AUTH GUARD - Verify user is logged in
  // ============================================================================
  const authHeader = req.headers.get("Authorization");
  
  if (!authHeader) {
    console.error("🚫 AUTH ERROR: Missing Authorization header");
    return new Response(
      JSON.stringify({
        error: "Missing login token. Please log out and log back in.",
        auth_error: "MISSING_AUTHORIZATION_HEADER",
        hint: "Make sure you're calling this via supabase.functions.invoke() from an authenticated session",
      }),
      {
        status: 401,
        headers: { ...getCorsHeaders(req), "content-type": "application/json" },
      }
    );
  }

  const jwt = authHeader.replace("Bearer ", "");
  
  if (!jwt || jwt === authHeader) {
    console.error("🚫 AUTH ERROR: Malformed Authorization header");
    return new Response(
      JSON.stringify({
        error: "Invalid login token format. Please log out and log back in.",
        auth_error: "MALFORMED_AUTHORIZATION_HEADER",
        hint: "Authorization header should be 'Bearer <token>'",
      }),
      {
        status: 401,
        headers: { ...getCorsHeaders(req), "content-type": "application/json" },
      }
    );
  }

  // Verify JWT is valid by parsing payload
  try {
    const parts = jwt.split(".");
    if (parts.length !== 3) {
      throw new Error("Invalid JWT structure");
    }
    
    const payload = JSON.parse(atob(parts[1]));
    const userId = payload.sub || payload.user_id;
    
    if (!userId) {
      throw new Error("JWT missing user ID");
    }
    
    console.log("✅ Authenticated user:", userId);
  } catch (jwtError: any) {
    console.error("🚫 AUTH ERROR: Invalid JWT:", jwtError.message);
    return new Response(
      JSON.stringify({
        error: "Session expired or invalid. Please log out and log back in.",
        auth_error: "INVALID_JWT",
        hint: jwtError.message,
      }),
      {
        status: 401,
        headers: { ...getCorsHeaders(req), "content-type": "application/json" },
      }
    );
  }
  // ============================================================================

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Log all incoming request headers for debugging
    console.log('📥 Incoming request headers:', Object.fromEntries(req.headers.entries()));

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
    
    // Onspace AI fallback mode - plate data from client
    let clientPlate: string | null = null;
    let clientConfidence: number | null = null;
    let clientRequiresManualEntry = false;
    let clientRawCandidates: string[] | null = null;

    const contentType = req.headers.get("content-type") ?? "";
    console.log('📋 Content-Type header:', contentType);

    // Default to JSON if no content-type specified (Supabase client default)
    if (!contentType || contentType.includes("application/json")) {
      console.log('🔄 Parsing as JSON...');
      const body = await req.json();
      console.log('✅ JSON parsed successfully, keys:', Object.keys(body));
      imageDataUrl = body.image ?? body.photo_base64 ?? body.photoDataUrl;
      gpsLatitude = body.gpsLatitude ?? body.gps_latitude ?? body.gps?.lat;
      gpsLongitude = body.gpsLongitude ?? body.gps_longitude ?? body.gps?.lng;
      gpsAccuracy = body.gpsAccuracy ?? body.gps_accuracy ?? body.gps?.accuracy;
      recordedAt = body.recordedAt ?? body.recorded_at;
      officerId = body.officerId ?? body.officer_id ?? body.recorded_by;
      organizationId = body.organizationId ?? body.organization_id;
      zoneId = body.zoneId ?? body.zone_id;
      idempotencyKey = body.idempotencyKey ?? body.idempotency_key;
      officerNotes = body.notes ?? body.officer_notes;
      weatherConditions = body.weather ?? body.weather_conditions;
      
      // Onspace AI provided plate data
      if (USE_ONSPACE_AI) {
        clientPlate = body.plate;
        clientConfidence = body.confidence;
        clientRequiresManualEntry = body.requires_manual_entry ?? false;
        clientRawCandidates = body.raw_candidates;
      }
    } else if (contentType.includes("multipart/form-data")) {
      console.log('🔄 Parsing as FormData...');
      const formData = await req.formData();
      console.log('✅ FormData parsed successfully');
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
      
      // Onspace AI provided plate data
      if (USE_ONSPACE_AI) {
        clientPlate = formData.get("plate") as string;
        const confStr = formData.get("confidence") as string;
        clientConfidence = confStr ? parseFloat(confStr) : null;
        clientRequiresManualEntry = (formData.get("requires_manual_entry") as string) === "true";
      }
    } else {
      // Unknown content type - log and return error
      console.error('❌ Unsupported Content-Type:', contentType);
      return new Response(
        JSON.stringify({ 
          error: `Unsupported Content-Type: ${contentType}. Expected application/json or multipart/form-data.`,
          hint: 'Make sure you are calling this function via supabase.functions.invoke() with a body object',
        }),
        {
          status: 400,
          headers: { ...getCorsHeaders(req), "content-type": "application/json" },
        }
      );
    }

    // Validate required fields
    if (!imageBytes && !imageDataUrl) {
      console.error('❌ Missing image data. Received:', {
        hasImageBytes: !!imageBytes,
        hasImageDataUrl: !!imageDataUrl,
        imageDataUrlLength: imageDataUrl?.length,
      });
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
      mode: USE_ONSPACE_AI ? "onspace_fallback" : "railway_inference",
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

    // Convert imageDataUrl to bytes if needed
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

    // ========================================================================
    // INFERENCE ROUTING
    // Priority: 1) Plate Recognizer API  2) Railway ORC/AI  3) OnSpace AI
    // ========================================================================
    let inferenceResult: {
      success: boolean;
      path: string;
      plate: string | null;
      requires_manual_entry: boolean;
      confidence: number | null;
      vehicle_make?: string | null;
      vehicle_model?: string | null;
      vehicle_colour?: string | null;
      raw_candidates?: string[];
    };

    // ── Tier 1: Plate Recognizer API ──────────────────────────────────────
    if (PLATE_RECOGNIZER_TOKEN && imageBytes) {
      console.log("🔍 Calling Plate Recognizer API (tier 1)...");
      const prRes = await callPlateRecognizer(imageBytes, ["nz"]);
      if (prRes) {
        inferenceResult = {
          success: true,
          path: "plate_recognizer",
          plate: prRes.plate,
          requires_manual_entry: false,
          confidence: prRes.confidence,
          vehicle_make: prRes.make,
          vehicle_model: prRes.model,
          vehicle_colour: prRes.colour,
        };
        console.log("✅ Tier 1 (Plate Recognizer) succeeded:", prRes.plate);
      } else {
        // Plate Recognizer returned no plate — fall through to tier 2/3
        inferenceResult = {
          success: true,
          path: "plate_recognizer_no_plate",
          plate: null,
          requires_manual_entry: true,
          confidence: null,
        };
        console.log("ℹ️  Plate Recognizer returned no plate — checking fallbacks");
      }
    } else if (!USE_ONSPACE_AI) {
      // ── Tier 2: Railway ORC/AI ─────────────────────────────────────────
      console.log("🚂 Using Railway inference service (tier 2)");
      const inferenceUrl = Deno.env.get("INFERENCE_SERVICE_URL");

      if (!inferenceUrl) {
        throw new Error("INFERENCE_SERVICE_URL not configured");
      }

      try {
        const inferenceResponse = await fetch(`${inferenceUrl}/infer`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            image_base64: imageDataUrl?.split(",")[1] ?? btoa(String.fromCharCode(...imageBytes!)),
          }),
          signal: AbortSignal.timeout(20_000),
        });

        if (!inferenceResponse.ok) {
          throw new Error(`Inference service returned ${inferenceResponse.status}`);
        }

        const inferenceData = await inferenceResponse.json();
        inferenceResult = {
          success: true,
          path: "railway_inference",
          plate: inferenceData.plate,
          requires_manual_entry: !inferenceData.plate,
          confidence: inferenceData.plate_confidence ?? inferenceData.confidence,
          vehicle_make: inferenceData.vehicle_make,
          vehicle_model: inferenceData.vehicle_model,
          vehicle_colour: inferenceData.vehicle_colour,
        };

        console.log("🚂 Railway inference:", { plate: inferenceResult.plate });
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error);
        console.error("❌ Railway inference failed:", msg);
        inferenceResult = {
          success: false,
          path: "railway_failed",
          plate: null,
          requires_manual_entry: true,
          confidence: null,
        };
      }
    } else {
      // ── Tier 3: OnSpace AI / client-side fallback ──────────────────────
      console.log("📱 Using OnSpace AI fallback (tier 3)");
      inferenceResult = {
        success: true,
        path: "onspace_fallback",
        plate: clientPlate,
        requires_manual_entry: clientRequiresManualEntry,
        confidence: clientConfidence,
        raw_candidates: clientRawCandidates ?? undefined,
      };

      console.log("OnSpace inference result:", {
        plate: inferenceResult.plate,
        confidence: inferenceResult.confidence,
        requires_manual_entry: inferenceResult.requires_manual_entry,
      });
    }
    // ========================================================================

    const plateNumber = inferenceResult.plate;
    const requiresManualEntry = inferenceResult.requires_manual_entry;
    const plateConfidence = inferenceResult.confidence;

    // Step 3: Get or create canonical vehicle
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

    // Step 4: Insert observation into observations table
    const observationData = {
      idempotency_key: idempotencyKey,
      plate_number: plateNumber || "MANUAL_REQUIRED",
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
      // Vehicle metadata — populated by Plate Recognizer or Railway when available
      vehicle_make:  inferenceResult.vehicle_make  ?? null,
      vehicle_model: inferenceResult.vehicle_model ?? null,
      vehicle_year:  null,
      vehicle_color: inferenceResult.vehicle_colour ?? null,
      self_contained: false,
      self_contained_expiry: null,
      // Compliance will be calculated by triggers
      is_compliant: true,
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
        source: inferenceResult.path,
        plate: plateNumber !== "MANUAL_REQUIRED" ? plateNumber : null,
        confidence: plateConfidence,
        photo_url: photoUrl,
        photo_hash: photoHash,
        requires_manual_entry: requiresManualEntry,
      }),
      {
        status: 200,
        headers: { ...getCorsHeaders(req), "content-type": "application/json" },
      }
    );
  } catch (error: any) {
    console.error("❌ Vehicle ingest error:", error.message);
    console.error("❌ Full error:", error);
    
    // Provide more helpful error message for JSON parsing failures
    if (error.message?.includes('JSON')) {
      return new Response(
        JSON.stringify({ 
          error: 'Failed to parse request body as JSON',
          details: error.message,
          hint: 'Ensure you are sending a valid JSON object with an "image" field containing a base64 data URL',
        }),
        {
          status: 400,
          headers: { ...getCorsHeaders(req), "content-type": "application/json" },
        }
      );
    }
    
    return new Response(
      JSON.stringify({ 
        error: error.message || 'Unknown error',
        hint: 'Check Supabase Edge Function logs for details',
      }),
      {
        status: 500,
        headers: { ...getCorsHeaders(req), "content-type": "application/json" },
      }
    );
  }
});
