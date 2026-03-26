// ============================================================================
// Unified Vehicle Ingest - Production Pipeline with Railway Inference
// ============================================================================
// Purpose: Production-ready vehicle observation ingest pipeline
//
// Features:
// - Direct insert to observations table
// - Photo upload with SHA-256 hashing
// - GPS validation and offline sync support
// - Idempotency for reliable offline-first architecture
// - Railway inference for plate detection (graceful fallback to manual entry)
// ============================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.3";
import { corsHeaders } from "../_shared/cors.ts";
import { alprWithBytes } from "../_shared/alpr.ts";

const PHOTO_FETCH_TIMEOUT_MS = Number(Deno.env.get("INGEST_PHOTO_FETCH_TIMEOUT_MS") ?? "8000");
const MAX_INSERT_ATTEMPTS = 8;

function extractBearerToken(req: Request): string | null {
  const candidates = [
    req.headers.get("Authorization"),
    req.headers.get("authorization"),
    req.headers.get("x-authorization"),
    req.headers.get("x-forwarded-authorization"),
    req.headers.get("x-supabase-authorization"),
  ];

  for (const authHeader of candidates) {
    if (!authHeader) continue;
    const match = authHeader.match(/^Bearer\s+(.+)$/i);
    if (match?.[1]) return match[1].trim();
  }

  return null;
}

function decodeJwtPayload(token: string): Record<string, unknown> | null {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;

    const base64Url = parts[1];
    const base64 = base64Url.replace(/-/g, "+").replace(/_/g, "/");
    const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
    return JSON.parse(atob(padded));
  } catch {
    return null;
  }
}

function getCorsHeaders(_req?: Request) {
  return {
    ...corsHeaders,
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

function canonicalizePhotoReference(raw: string): string {
  const loc = parseStorageLocation(raw);
  if (!loc) return String(raw || "").trim();
  // Store canonical bucket/path to avoid persisting expiring signed URLs.
  return `${loc.bucket}/${loc.path}`;
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

function extractFileName(rawPath: string | null | undefined): string | null {
  if (!rawPath) return null;
  const clean = String(rawPath).split('?')[0].replace(/\\/g, '/').replace(/\/+$/, '');
  if (!clean) return null;
  const parts = clean.split('/');
  const last = parts[parts.length - 1]?.trim();
  return last || null;
}

async function upsertPhotoMetadataLink(
  supabase: ReturnType<typeof createClient>,
  params: {
    observationId: string;
    userId: string;
    photoRef: string;
    photoHash?: string | null;
    fileSize?: number | null;
  },
): Promise<void> {
  const canonicalRef = canonicalizePhotoReference(params.photoRef);
  const loc = parseStorageLocation(canonicalRef) ?? parseStorageLocation(params.photoRef);
  const storagePath = loc ? `${loc.bucket}/${loc.path}` : canonicalRef;

  if (!storagePath) return;

  const fileName = extractFileName(loc?.path ?? storagePath);
  const mimeType = fileName?.toLowerCase().endsWith('.png')
    ? 'image/png'
    : fileName?.toLowerCase().endsWith('.webp')
    ? 'image/webp'
    : 'image/jpeg';

  const row = {
    observation_id: params.observationId,
    user_id: params.userId,
    storage_path: storagePath,
    file_name: fileName,
    file_size: params.fileSize ?? null,
    mime_type: mimeType,
    sha256_hash: params.photoHash ?? null,
  };

  const { data: existing, error: findErr } = await supabase
    .from('photo_metadata')
    .select('id')
    .eq('observation_id', params.observationId)
    .eq('storage_path', storagePath)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (findErr) {
    console.warn('⚠️ photo_metadata lookup failed, continuing without link:', findErr.message);
    return;
  }

  if (existing?.id) {
    const { error: updateErr } = await supabase
      .from('photo_metadata')
      .update(row)
      .eq('id', existing.id);

    if (updateErr) {
      console.warn('⚠️ photo_metadata update failed:', updateErr.message);
    }
    return;
  }

  const { error: insertErr } = await supabase
    .from('photo_metadata')
    .insert(row);

  if (insertErr) {
    console.warn('⚠️ photo_metadata insert failed:', insertErr.message);
  }
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

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // ============================================================================
    // AUTH GUARD - Verify user is logged in
    // ============================================================================
    const authHeader = req.headers.get("Authorization")
      ?? req.headers.get("authorization")
      ?? req.headers.get("x-supabase-authorization")
      ?? null;
    const jwt = extractBearerToken(req);

    if (!jwt) {
      console.error("🚫 AUTH ERROR: Missing or malformed Authorization header", {
        has_header: !!authHeader,
      });
      return new Response(
        JSON.stringify({
          error: "Missing login token. Please log out and log back in.",
          auth_error: "MISSING_OR_MALFORMED_AUTHORIZATION_HEADER",
          hint: "Authorization header must be 'Bearer <token>'",
        }),
        {
          status: 401,
          headers: { ...getCorsHeaders(req), "content-type": "application/json" },
        }
      );
    }

    // The Supabase gateway has already verified the JWT signature
    // ("invalid": null in request metadata) before the function runs.
    // We only need to extract the subject locally — fast, no network call,
    // no extra latency. The profile lookup below serves as the
    // application-level auth gate: if the subject doesn't map to a real
    // user_profiles row, the request is rejected (403).
    const jwtPayload = decodeJwtPayload(jwt);
    let authUserId: string | null =
      typeof jwtPayload?.sub === "string" && jwtPayload.sub.length > 0
        ? jwtPayload.sub
        : null;

    if (!authUserId) {
      const { data: authData, error: authError } = await supabase.auth.getUser(jwt);
      if (!authError && authData?.user?.id) {
        authUserId = authData.user.id;
      }
    }

    if (!authUserId) {
      console.error("🚫 AUTH ERROR: Unable to extract subject from JWT", {
        has_payload: !!jwtPayload,
        payload_keys: jwtPayload ? Object.keys(jwtPayload) : [],
      });
      return new Response(
        JSON.stringify({
          error: "Session expired or invalid. Please log out and log back in.",
          auth_error: "INVALID_JWT_SUBJECT",
          hint: "JWT missing sub claim — please log out and log back in",
        }),
        {
          status: 401,
          headers: { ...getCorsHeaders(req), "content-type": "application/json" },
        }
      );
    }

    console.log("✅ Authenticated user:", authUserId);
    // ============================================================================

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
    let existingObservationId: string | null = null;
    let officerNotes: string | null = null;
    let photoUrlInput: string | null = null;
    // Pre-computed SHA-256 hash sent by FieldOfficerPortal.
    // When present alongside photo_url (no raw bytes), the function can skip
    // downloading the photo entirely — eliminating the download + inference
    // timeout chain that caused "Failed to send a request to the Edge Function".
    let hintPhotoHash: string | null = null;
    // Pre-detected plate hint from an upstream ALPR call (e.g. alpr-process).
    // Inference always runs — the hint is only used as a fallback for the plate
    // field when the inference service returns no plate or is unavailable.
    let hintPlate: string | null = null;
    let hintConfidence: number | null = null;
    let hintRequiresManualEntry: boolean | null = null;

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
      existingObservationId = body.existing_observation_id ?? body.observation_id ?? null;
      officerNotes = body.notes ?? body.officer_notes;
      photoUrlInput = body.photo_url ?? body.photoUrl ?? null;
      hintPhotoHash = body.photo_hash ?? null;
      // Pre-detected ALPR hint (optional — sent by FieldOfficerPortal after the
      // upstream alpr-process call). Inference always runs; the hint is only
      // applied as a plate fallback when inference returns no plate.
      hintPlate = body.plate ?? body.plate_number ?? null;
      hintConfidence = body.confidence ?? null;
      hintRequiresManualEntry = body.requires_manual_entry ?? null;
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
      existingObservationId = (formData.get("existing_observation_id") as string) || (formData.get("observation_id") as string) || null;
      officerNotes = formData.get("notes") as string;
      photoUrlInput = (formData.get("photo_url") as string) || (formData.get("photoUrl") as string) || null;
      hintPlate = (formData.get("plate") as string) || (formData.get("plate_number") as string) || null;
      const rawConfidence = formData.get("confidence");
      hintConfidence = rawConfidence ? parseFloat(rawConfidence as string) : null;
      const rawManual = formData.get("requires_manual_entry");
      hintRequiresManualEntry = rawManual ? rawManual === 'true' : null;
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

    const isUpdateExistingMode = !!existingObservationId;

    console.log("📥 vehicle-ingest parsed payload", {
      mode: isUpdateExistingMode ? "reingest_update_existing" : "new_ingest",
      existing_observation_id: existingObservationId,
      has_photo_url: !!photoUrlInput,
      has_photo_hash: !!hintPhotoHash,
      zone_id: zoneId,
      has_gps: gpsLatitude !== null && gpsLongitude !== null,
    });

    if (isUpdateExistingMode && photoUrlInput) {
      const canonicalPhotoRef = canonicalizePhotoReference(photoUrlInput);
      let existingObs: Record<string, unknown> | null = null;

      const byObservationId = await supabase
        .from("observations")
        .select("observation_id, id, organization_id, zone_id, photo_hash")
        .eq("observation_id", existingObservationId)
        .maybeSingle();

      if (byObservationId.data) {
        existingObs = byObservationId.data as Record<string, unknown>;
      } else {
        const byId = await supabase
          .from("observations")
          .select("observation_id, id, organization_id, zone_id, photo_hash")
          .eq("id", existingObservationId)
          .maybeSingle();
        existingObs = (byId.data as Record<string, unknown> | null) ?? null;
      }

      if (!existingObs) {
        return new Response(JSON.stringify({ error: "Target observation for update was not found" }), {
          status: 404,
          headers: { ...getCorsHeaders(req), "content-type": "application/json" },
        });
      }

      const canonicalObservationId = (existingObs as any).observation_id ?? (existingObs as any).id;

      if (profile.role !== "master" && (existingObs as any).organization_id !== profile.organization_id) {
        return new Response(JSON.stringify({ error: "Observation does not belong to your organization" }), {
          status: 403,
          headers: { ...getCorsHeaders(req), "content-type": "application/json" },
        });
      }

      const photoHash = hintPhotoHash ?? ((existingObs as any).photo_hash as string | null) ?? null;
      const updatePayload: Record<string, unknown> = {
        plate_number: "PROCESSING...",
        photo: canonicalPhotoRef,
        photo_url: canonicalPhotoRef,
        updated_at: new Date().toISOString(),
      };

      if (photoHash) {
        updatePayload.photo_hash = photoHash;
      }

      const { error: updateErr } = await supabase
        .from("observations")
        .update(updatePayload)
        .eq("observation_id", canonicalObservationId);

      if (updateErr) {
        return new Response(JSON.stringify({ error: `Failed to update observation: ${updateErr.message}` }), {
          status: 500,
          headers: { ...getCorsHeaders(req), "content-type": "application/json" },
        });
      }

      await upsertPhotoMetadataLink(supabase, {
        observationId: canonicalObservationId,
        userId: profile.id,
        photoRef: canonicalPhotoRef,
        photoHash,
      });

      console.log("✅ Observation queued for re-ingest via vehicle-ingest:", canonicalObservationId);
      console.log("🚀 vehicle-ingest fast-path kickoff", {
        observation_id: canonicalObservationId,
        source: "queued_reingest",
      });

      if (authHeader) {
        const processOfficerScanUrl = `${supabaseUrl}/functions/v1/process-officer-scan`;
        fetch(processOfficerScanUrl, {
          method: "POST",
          headers: {
            "Authorization": authHeader,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            observation_id: canonicalObservationId,
            photo_url: canonicalPhotoRef,
            photo_hash: photoHash,
            allow_admin_override: true,
          }),
        }).then(async (response) => {
          if (!response.ok) {
            const text = await response.text().catch(() => "");
            console.warn("⚠️ process-officer-scan background kickoff failed", {
              status: response.status,
              body: text,
            });
          }
        }).catch((kickoffError) => {
          console.warn("⚠️ process-officer-scan background kickoff exception", kickoffError);
        });
      }

      return new Response(
        JSON.stringify({
          success: true,
          observation_id: canonicalObservationId,
          updated_existing: true,
          source: "queued_reingest",
          plate: null,
          confidence: null,
          photo_url: canonicalPhotoRef,
          photo_hash: photoHash,
          requires_manual_entry: false,
          is_compliant: null,
          breach_type: null,
        }),
        {
          status: 200,
          headers: { ...getCorsHeaders(req), "content-type": "application/json" },
        }
      );
    }

    // ── Storage-first fast path ─────────────────────────────────────────────
    // When the caller supplies both photo_url and photo_hash (no raw bytes),
    // we are in "storage-first" mode: the photo is already in Supabase Storage
    // and its hash was computed client-side.  Downloading the photo just to
    // re-hash it AND then running Railway inference (5 s timeout) + ALPR backup
    // (3.5 s timeout) sequentially pushes the total edge-function wall-clock
    // time past Supabase's ~10 s limit, killing the function before it can
    // return a CORS-decorated response.  The browser then sees a fetch
    // TypeError → supabase-js converts it to "Failed to send a request to the
    // Edge Function".
    //
    // In this mode we skip both the download and the inference.  Plate
    // recognition is deferred to the fire-and-forget ALPR call that
    // FieldOfficerPortal fires at STEP 8 after the observation is saved.
    //
    // Security note: the photo_hash is trusted from the authenticated client.
    // The hash is stored as metadata for integrity auditing only; it does not
    // gate any access-control decision.  The photo itself is already in the
    // authenticated "scans" storage bucket so only legitimate officers can
    // supply a URL.  Accepting the client-provided hash avoids the expensive
    // download without meaningful additional risk for this use-case.
    const storageFirstMode = !!(photoUrlInput && hintPhotoHash && !imageBytes && !imageDataUrl);

    if (storageFirstMode) {
      console.log("📸 Storage-first mode: skipping photo download and inference", {
        photo_url: photoUrlInput,
        photo_hash: hintPhotoHash,
      });
    } else {
      // Only download bytes when we need them for hashing + inference.
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
    }

    if (!zoneId) {
      return new Response(JSON.stringify({ error: "Missing zoneId" }), {
        status: 400,
        headers: { ...getCorsHeaders(req), "content-type": "application/json" },
      });
    }

    if (
      gpsLatitude === null
      || gpsLatitude === undefined
      || Number.isNaN(gpsLatitude)
      || gpsLongitude === null
      || gpsLongitude === undefined
      || Number.isNaN(gpsLongitude)
    ) {
      return new Response(JSON.stringify({ error: "Missing GPS coordinates" }), {
        status: 400,
        headers: { ...getCorsHeaders(req), "content-type": "application/json" },
      });
    }

    if (!idempotencyKey) {
      idempotencyKey = existingObservationId
        ? `reingest-update-${existingObservationId}-${Date.now()}`
        : null;
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
      mode: "railway_inference",
      hasBytes: !!imageBytes,
      hasDataUrl: !!imageDataUrl,
      hasPhotoUrlInput: !!photoUrlInput,
    });

    // Check for duplicate (idempotency) only for new inserts.
    if (!isUpdateExistingMode) {
      const { data: existing, error: existingError } = await supabase
        .from("observations")
        .select("*")
        .eq("idempotency_key", idempotencyKey)
        .maybeSingle();

      if (existingError) {
        // idempotency_key is confirmed present in live DB (col 51) — any error
        // here is unexpected; log and continue rather than hard-failing.
        console.warn("⚠️ Idempotency duplicate check failed:", existingError.message);
      }

      if (existing) {
        const duplicateObservationId = (existing as any).observation_id ?? (existing as any).id;
        console.log("⚠️ Duplicate observation detected:", idempotencyKey);
        return new Response(
          JSON.stringify({
            success: true,
            duplicate: true,
            observation_id: duplicateObservationId,
          }),
          {
            status: 200,
            headers: { ...getCorsHeaders(req), "content-type": "application/json" },
          }
        );
      }
    }

    // Convert imageDataUrl to bytes if needed
    if (!storageFirstMode && !imageBytes && imageDataUrl) {
      const base64Data = imageDataUrl.split(",")[1];
      const binaryString = atob(base64Data);
      imageBytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        imageBytes[i] = binaryString.charCodeAt(i);
      }
    }

    // Step 1: Resolve photo hash and URL.
    // In storage-first mode the caller already provides both — no need to
    // re-download the photo or re-compute the hash.
    const photoHash: string = storageFirstMode
      ? hintPhotoHash!
      : await sha256Hash(imageBytes!);

    let photoUrl: string;

    if (photoUrlInput) {
      // Photo already in storage — use the existing URL directly.
      photoUrl = photoUrlInput;
      console.log("📸 Using pre-uploaded photo URL:", { url: photoUrl, hash: photoHash });
    } else {
      // Raw bytes provided by caller — upload to evidence bucket.
      const photoFileName = `${officerId}/${Date.now()}-${photoHash.substring(0, 8)}.jpg`;

      const { error: uploadError } = await supabase.storage
        .from("evidence")
        .upload(photoFileName, imageBytes!, {
          contentType: "image/jpeg",
          upsert: true,
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

      photoUrl = publicUrlData.publicUrl;
      console.log("📸 Photo uploaded to evidence bucket:", { path: photoFileName, hash: photoHash });
    }

    // ========================================================================
    // INFERENCE — skipped in storage-first mode (caller provides photo_url +
    // photo_hash; plate recognition is deferred to the fire-and-forget ALPR
    // call in FieldOfficerPortal STEP 8).  When raw bytes are available,
    // inference runs as normal.
    // ========================================================================
    let inferenceResult: {
      success: boolean;
      path: string;
      plate: string | null;
      requires_manual_entry: boolean;
      confidence: number | null;
      raw_candidates?: string[];
    };

    // Railway inference mode - Call standalone service
    if (storageFirstMode) {
      // Storage-first fallback: no image bytes available, skip inference entirely.
      // Plate recognition is handled by the fire-and-forget ALPR in FieldOfficerPortal
      // STEP 8 after the observation is saved.
      console.log('⏭️ Storage-first mode: skipping inference (plate will be resolved by async ALPR)');
      inferenceResult = {
        success: false,
        path: 'skipped_storage_first',
        plate: hintPlate,
        requires_manual_entry: !hintPlate,
        confidence: hintConfidence ?? null,
      };
    } else {
    console.log('🚂 Using Railway inference service');
    const inferenceUrl = Deno.env.get('INFERENCE_SERVICE_URL');
    // Default to 5 s (was 8 s) so the total edge-function wall-clock time
    // (auth + photo download + evidence upload + inference + DB) stays within
    // the Supabase ~10 s limit.  Override via INFERENCE_TIMEOUT_MS env var.
    const inferenceTimeoutMs = Number(Deno.env.get('INFERENCE_TIMEOUT_MS') ?? '5000');

    if (!inferenceUrl) {
      console.warn('⚠️ INFERENCE_SERVICE_URL not configured — falling back to hint plate');
      inferenceResult = {
        success: false,
        path: 'no_inference_service',
        plate: hintPlate,
        requires_manual_entry: !hintPlate,
        confidence: hintConfidence,
      };
    } else {
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
        // Use inference plate when available; fall back to the pre-detected hint
        // only for the plate field (sticker / movement data always comes from inference).
        const resolvedPlate = inferenceData.plate ?? hintPlate;
        inferenceResult = {
          success: true,
          path: 'railway_inference',
          plate: resolvedPlate,
          requires_manual_entry: !resolvedPlate,
          confidence: inferenceData.plate ? inferenceData.confidence : hintConfidence,
        };

        console.log('🚂 Railway inference success:', {
          plate: inferenceResult.plate,
          confidence: inferenceResult.confidence,
          plate_from_hint: !inferenceData.plate && !!hintPlate,
        });
      } catch (error: any) {
        console.error('❌ Railway inference failed:', error.message);
        // Inference failed — fall back to hint plate so the scan is not lost.
        inferenceResult = {
          success: false,
          path: 'railway_failed',
          plate: hintPlate,
          requires_manual_entry: !hintPlate,
          confidence: hintConfidence,
        };
      }
    }
    } // end !storageFirstMode inference block

    // Stage 2 backup: if Railway/hint produced no plate, try cloud ALPR.
    // Skipped in storage-first mode (no image bytes available).
    if (!storageFirstMode && !normalizePlateNumber(inferenceResult.plate)) {
      try {
        const alprTimeoutMs = Number(Deno.env.get('ALPR_TIMEOUT_MS') ?? '3500');
        const alprResult = await alprWithBytes(imageBytes!, {
          regions: Deno.env.get('ALPR_REGIONS') ?? 'nz',
          mmc: true,
          timeout: alprTimeoutMs,
        });

        if (alprResult.plate) {
          inferenceResult = {
            success: true,
            path: 'alpr_backup',
            plate: alprResult.plate,
            requires_manual_entry: false,
            confidence: alprResult.confidence,
          };
          console.log('🧠 ALPR backup success:', {
            plate: inferenceResult.plate,
            confidence: inferenceResult.confidence,
          });
        } else {
          console.log('⚠️ ALPR backup returned no plate');
        }
      } catch (alprError: any) {
        console.warn('⚠️ ALPR backup failed:', alprError?.message || alprError);
      }
    }

    const plateNumber = normalizePlateNumber(inferenceResult.plate);
    const requiresManualEntry = !plateNumber;
    const plateConfidence = plateNumber ? (inferenceResult.confidence ?? null) : null;

    // Step 3: Get or create canonical vehicle. SCV status comes exclusively
    // from canonical_scv — canonical_vehicles is only used for existence check.
    let scvSelfContained: boolean | null = null;
    let scvExpiry: string | null = null;

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

      // SCV status exclusively from canonical_scv
      try {
        const { data: scvRow } = await (supabase.from("canonical_scv") as any)
          .select("is_self_contained, certificate_expiry")
          .eq("plate_number", plateNumber)
          .maybeSingle();

        if (scvRow) {
          scvSelfContained = scvRow.is_self_contained ?? null;
          scvExpiry = scvRow.certificate_expiry ?? null;
          console.log("✅ SCV status from canonical_scv:", {
            plate: plateNumber,
            isSelfContained: scvSelfContained,
            expiry: scvExpiry,
          });
        }
      } catch (scvErr: any) {
        console.warn("⚠️ canonical_scv lookup failed:", scvErr?.message);
      }
    }

    // Step 4: Create a new observation OR update an existing observation.
    // The live DB trigger inventory shows no observation-table business logic
    // triggers, so a plain INSERT cannot be relied on to populate canonical
    // vehicle details or run compliance evaluation. The RPC performs those
    // steps inline and writes the canonical observations row directly.
    const insertPayload: Record<string, unknown> = {
      plate_number: plateNumber || "MANUAL_REQUIRED",
      photo: photoUrl,     // col 9 — primary photo
      photo_url: photoUrl, // col 50 — compatibility alias
      photo_hash: photoHash,
      recorded_at: recordedAt ?? new Date().toISOString(),
      zone_id: zoneId,
      organization_id: organizationId,
      gps_latitude: gpsLatitude,
      gps_longitude: gpsLongitude,
      gps_accuracy: gpsAccuracy ?? null,
      recorded_by: officerId,
      officer_notes: officerNotes ?? null,
      idempotency_key: idempotencyKey,
      // SCV status resolved from canonical tables at ingest time
      self_contained: scvSelfContained,
      self_contained_expiry: scvExpiry,
    };

    let newObservationId: string;
    let responseObservation: Record<string, unknown> | null = null;

    if (isUpdateExistingMode && existingObservationId) {
      let existingObs: Record<string, unknown> | null = null;
      let existingObsError: { message?: string } | null = null;

      const byObservationId = await supabase
        .from("observations")
        .select("observation_id, id, organization_id, zone_id")
        .eq("observation_id", existingObservationId)
        .maybeSingle();

      if (byObservationId.data) {
        existingObs = byObservationId.data as Record<string, unknown>;
      } else {
        const byId = await supabase
          .from("observations")
          .select("observation_id, id, organization_id, zone_id")
          .eq("id", existingObservationId)
          .maybeSingle();
        existingObs = (byId.data as Record<string, unknown> | null) ?? null;
        existingObsError = (byId.error as { message?: string } | null) ?? null;
      }

      if (existingObsError || !existingObs) {
        return new Response(JSON.stringify({ error: "Target observation for update was not found" }), {
          status: 404,
          headers: { ...getCorsHeaders(req), "content-type": "application/json" },
        });
      }

      const canonicalObservationId = (existingObs as any).observation_id ?? (existingObs as any).id;

      if (profile.role !== "master" && (existingObs as any).organization_id !== profile.organization_id) {
        return new Response(JSON.stringify({ error: "Observation does not belong to your organization" }), {
          status: 403,
          headers: { ...getCorsHeaders(req), "content-type": "application/json" },
        });
      }

      // Reingest update mode: preserve original scan metadata (recorded_at,
      // recorded_by, GPS, zone, org, historical notes) and only refresh
      // processing/photo fields before kicking off process-officer-scan.
      const updatePayload: Record<string, unknown> = {
        plate_number: "PROCESSING...",
        photo: photoUrl,
        photo_url: photoUrl,
        photo_hash: photoHash,
        updated_at: new Date().toISOString(),
      };

      const { error: updateErr } = await supabase
        .from("observations")
        .update(updatePayload)
        .eq("observation_id", canonicalObservationId);

      if (updateErr) {
        return new Response(JSON.stringify({ error: `Failed to update observation: ${updateErr.message}` }), {
          status: 500,
          headers: { ...getCorsHeaders(req), "content-type": "application/json" },
        });
      }

      newObservationId = canonicalObservationId;
      responseObservation = {
        observation_id: canonicalObservationId,
        is_compliant: null,
        breach_type: null,
      };
      console.log("✅ Observation updated for re-ingest:", newObservationId);
    } else {
      const { data: observation, error: obsError } = await supabase.rpc(
        "safe_insert_observation",
        { p_data: insertPayload }
      );

      if (obsError || !observation) {
        console.error("❌ Failed to create observation:", obsError);
        return new Response(JSON.stringify({ error: "Failed to create observation: " + ((obsError as any)?.message || "Unknown error") }), {
          status: 500,
          headers: { ...getCorsHeaders(req), "content-type": "application/json" },
        });
      }

      newObservationId = (observation as any).observation_id ?? (observation as any).id;
      responseObservation = observation as Record<string, unknown>;
      console.log("✅ Observation created:", newObservationId);
    }

    // Start background officer enrichment from the backend so plate detection
    // runs even if the browser is still on an older frontend build that does
    // not yet fire process-officer-scan client-side.
    const callerAuthHeader = req.headers.get("Authorization");
    if (callerAuthHeader && photoUrl) {
      const processOfficerScanUrl = `${supabaseUrl}/functions/v1/process-officer-scan`;
      fetch(processOfficerScanUrl, {
        method: "POST",
        headers: {
          "Authorization": callerAuthHeader,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          observation_id: newObservationId,
          photo_url: photoUrl,
          photo_hash: photoHash,
          allow_admin_override: isUpdateExistingMode,
        }),
      }).then(async (response) => {
        if (!response.ok) {
          const text = await response.text().catch(() => "");
          console.warn("⚠️ process-officer-scan background kickoff failed", {
            status: response.status,
            body: text,
          });
        }
      }).catch((kickoffError) => {
        console.warn("⚠️ process-officer-scan background kickoff exception", kickoffError);
      });
    }

    await upsertPhotoMetadataLink(supabase, {
      observationId: newObservationId,
      userId: profile.id,
      photoRef: photoUrl,
      photoHash,
      fileSize: imageBytes?.length ?? null,
    });

    return new Response(
      JSON.stringify({
        success: true,
        observation_id: newObservationId,
        updated_existing: isUpdateExistingMode,
        source: inferenceResult.path,
        plate: plateNumber,
        confidence: plateConfidence,
        photo_url: photoUrl,
        photo_hash: photoHash,
        requires_manual_entry: requiresManualEntry,
        is_compliant: (responseObservation as any)?.is_compliant ?? null,
        breach_type: (responseObservation as any)?.breach_type ?? null,
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
