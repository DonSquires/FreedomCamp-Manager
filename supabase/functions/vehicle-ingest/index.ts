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

// ============================================================================
// DEPLOYMENT MODE FLAG
// ============================================================================
// Set to true for temporary Onspace AI fallback mode (ALPR/ORC handled by UI)
// Set to false to re-enable Railway inference service
const USE_ONSPACE_AI = true;
// ============================================================================

const PHOTO_FETCH_TIMEOUT_MS = Number(Deno.env.get("INGEST_PHOTO_FETCH_TIMEOUT_MS") ?? "8000");

function getCorsHeaders(_req?: Request) {
  return {
    "Access-Control-Allow-Origin": "*",
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

function bytesToBase64(data: Uint8Array): string {
  // Avoid spreading large arrays into String.fromCharCode(...arr), which can stall/crash.
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < data.length; i += chunkSize) {
    const chunk = data.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

function parseStorageLocation(raw: string): { bucket: string; path: string } | null {
  const input = String(raw || "").trim();
  if (!input) return null;

  if (/^https?:\/\//i.test(input)) {
    try {
      const url = new URL(input);
      const decodedPath = decodeURIComponent(url.pathname);
      const match = decodedPath.match(/\/storage\/v1\/object\/(?:public|sign|authenticated)\/([^/]+)\/(.+)$/);
      if (!match) return null;
      return { bucket: match[1], path: match[2].replace(/^\/+/, "") };
    } catch {
      return null;
    }
  }

  const cleaned = input.replace(/^\/+/, "");
  const idx = cleaned.indexOf("/");
  if (idx <= 0) return null;
  const bucket = cleaned.slice(0, idx);
  const path = cleaned.slice(idx + 1).replace(/^\/+/, "");
  if (!bucket || !path) return null;
  return { bucket, path };
}

function normalizePlateNumber(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const normalized = String(raw)
    .trim()
    .toUpperCase()
    .replace(/\s+/g, '')
    .replace(/[^A-Z0-9]/g, '');
  return normalized || null;
}

async function downloadPhotoBytes(
  supabase: ReturnType<typeof createClient>,
  photoRef: string,
): Promise<{ bytes: Uint8Array; source: string }> {
  const storageLocation = parseStorageLocation(photoRef);

  if (storageLocation) {
    const { data, error } = await supabase.storage
      .from(storageLocation.bucket)
      .download(storageLocation.path);

    if (!error && data) {
      return {
        bytes: new Uint8Array(await data.arrayBuffer()),
        source: `storage:${storageLocation.bucket}`,
      };
    }

    console.warn("⚠️ Storage download failed, falling back to HTTP fetch", {
      bucket: storageLocation.bucket,
      path: storageLocation.path,
      error: error?.message,
    });
  }

  const response = await fetch(photoRef, { signal: AbortSignal.timeout(PHOTO_FETCH_TIMEOUT_MS) });
  if (!response.ok) {
    throw new Error(`Photo URL download failed: HTTP ${response.status}`);
  }

  return {
    bytes: new Uint8Array(await response.arrayBuffer()),
    source: "http",
  };
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
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);
    const authClient = createClient(supabaseUrl, supabaseAnonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    // Resolve authenticated user from token and enforce server-side identity/org.
    const { data: authData, error: authError } = await authClient.auth.getUser(jwt);
    if (authError || !authData?.user) {
      return new Response(
        JSON.stringify({
          error: "Session expired or invalid. Please log out and log back in.",
          auth_error: "INVALID_AUTH_SESSION",
        }),
        {
          status: 401,
          headers: { ...getCorsHeaders(req), "content-type": "application/json" },
        }
      );
    }

    const authUserId = authData.user.id;

    const { data: profile, error: profileError } = await supabase
      .from("user_profiles")
      .select("id, role, organization_id")
      .eq("id", authUserId)
      .maybeSingle();

    if (profileError || !profile) {
      return new Response(
        JSON.stringify({
          error: "User profile not found. Please contact support.",
          auth_error: "PROFILE_NOT_FOUND",
        }),
        {
          status: 403,
          headers: { ...getCorsHeaders(req), "content-type": "application/json" },
        }
      );
    }

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
    let photoUrlInput: string | null = null;
    
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
      photoUrlInput = body.photo_url ?? body.photoUrl ?? null;
      
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
      photoUrlInput = (formData.get("photo_url") as string) || (formData.get("photoUrl") as string) || null;
      
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

    // Support ingest from existing photo URLs (storage-first) when raw image payload is absent.
    if (!imageBytes && !imageDataUrl && photoUrlInput) {
      try {
        const photoDownload = await downloadPhotoBytes(supabase, photoUrlInput);
        imageBytes = photoDownload.bytes;
        console.log("✅ Loaded photo from URL for ingest", {
          source: photoDownload.source,
          bytes: imageBytes.length,
        });
      } catch (photoErr: any) {
        console.error("❌ Failed to load photo_url input:", photoErr?.message || photoErr);
      }
    }

    // Validate required fields
    if (!imageBytes && !imageDataUrl) {
      console.error('❌ Missing image data. Received:', {
        hasImageBytes: !!imageBytes,
        hasImageDataUrl: !!imageDataUrl,
        imageDataUrlLength: imageDataUrl?.length,
        hasPhotoUrlInput: !!photoUrlInput,
      });
      return new Response(JSON.stringify({ error: "Missing image data" }), {
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

    // Enforce recorded_by from authenticated session (never trust client-provided officerId).
    officerId = profile.id;

    // Validate zone and derive its organization server-side.
    const { data: zoneRow, error: zoneError } = await supabase
      .from("zones")
      .select("id, organization_id")
      .eq("id", zoneId)
      .maybeSingle();

    if (zoneError || !zoneRow) {
      return new Response(JSON.stringify({ error: "Invalid zoneId" }), {
        status: 400,
        headers: { ...getCorsHeaders(req), "content-type": "application/json" },
      });
    }

    // Non-master users must only write observations in their own organization.
    if (profile.role !== "master") {
      if (!profile.organization_id) {
        return new Response(JSON.stringify({ error: "User profile is missing organization assignment" }), {
          status: 403,
          headers: { ...getCorsHeaders(req), "content-type": "application/json" },
        });
      }

      if (zoneRow.organization_id !== profile.organization_id) {
        return new Response(JSON.stringify({ error: "Zone does not belong to your organization" }), {
          status: 403,
          headers: { ...getCorsHeaders(req), "content-type": "application/json" },
        });
      }
    }

    // Canonical source of truth: observations.organization_id comes from zone ownership.
    organizationId = zoneRow.organization_id;

    console.log("📥 Received vehicle scan", {
      officerId,
      org: organizationId,
      zone: zoneId,
      idempotency: idempotencyKey,
      mode: USE_ONSPACE_AI ? "onspace_fallback" : "railway_inference",
      hasBytes: !!imageBytes,
      hasDataUrl: !!imageDataUrl,
      hasPhotoUrlInput: !!photoUrlInput,
    });

    // Check for duplicate (idempotency)
    const { data: existing } = await supabase
      .from("observations")
      .select("*")
      .eq("idempotency_key", idempotencyKey)
      .maybeSingle();

    if (existing) {
      const existingObservationId = (existing as any).observation_id ?? (existing as any).id;
      console.log("⚠️ Duplicate observation detected:", idempotencyKey);
      return new Response(
        JSON.stringify({
          success: true,
          duplicate: true,
          observation_id: existingObservationId,
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
    // ========================================================================
    let inferenceResult: {
      success: boolean;
      path: string;
      plate: string | null;
      requires_manual_entry: boolean;
      confidence: number | null;
      raw_candidates?: string[];
    };

    if (USE_ONSPACE_AI) {
      // Onspace AI mode - Accept pre-processed plate data from client
      console.log('📱 Using Onspace AI fallback mode');
      inferenceResult = {
        success: true,
        path: 'onspace_fallback',
        plate: clientPlate,
        requires_manual_entry: clientRequiresManualEntry,
        confidence: clientConfidence,
        raw_candidates: clientRawCandidates ?? undefined,
      };
      
      // Log for debugging
      console.log('Onspace inference result:', {
        plate: inferenceResult.plate,
        confidence: inferenceResult.confidence,
        requires_manual_entry: inferenceResult.requires_manual_entry,
      });
    } else {
      // Railway inference mode - Call standalone service
      console.log('🚂 Using Railway inference service');
      const inferenceUrl = Deno.env.get('INFERENCE_SERVICE_URL');
      const inferenceTimeoutMs = Number(Deno.env.get('INFERENCE_TIMEOUT_MS') ?? '8000');
      
      if (!inferenceUrl) {
        throw new Error('INFERENCE_SERVICE_URL not configured');
      }

      try {
        const imageBase64 = imageDataUrl?.split(',')[1] ?? (imageBytes ? bytesToBase64(imageBytes) : null);
        if (!imageBase64) {
          throw new Error('No image payload available for inference');
        }

        const inferenceResponse = await fetch(`${inferenceUrl}/infer`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            image_base64: imageBase64,
            mode: 'alpr_with_orc_fallback',
          }),
          signal: AbortSignal.timeout(inferenceTimeoutMs),
        });

        if (!inferenceResponse.ok) {
          throw new Error(`Inference service returned ${inferenceResponse.status}`);
        }

        const inferenceData = await inferenceResponse.json();
        inferenceResult = {
          success: true,
          path: 'railway_inference',
          plate: inferenceData.plate,
          requires_manual_entry: !inferenceData.plate,
          confidence: inferenceData.confidence,
        };
        
        console.log('🚂 Railway inference success:', {
          plate: inferenceResult.plate,
          confidence: inferenceResult.confidence,
        });
      } catch (error: any) {
        console.error('❌ Railway inference failed:', error.message);
        // Fallback to manual entry
        inferenceResult = {
          success: false,
          path: 'railway_failed',
          plate: null,
          requires_manual_entry: true,
          confidence: null,
        };
      }
    }
    // ========================================================================

    const plateNumber = normalizePlateNumber(inferenceResult.plate);
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

    const newObservationId = (observation as any).observation_id ?? (observation as any).id;
    console.log("✅ Observation created:", newObservationId);

    return new Response(
      JSON.stringify({
        success: true,
        observation_id: newObservationId,
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
