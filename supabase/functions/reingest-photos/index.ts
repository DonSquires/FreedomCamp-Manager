// ============================================================================
// Reingest Photos — Batch reprocess existing observation photos
// ============================================================================
// Purpose: Query existing observations that have photos, and for each one
//          call the vehicle-ingest pipeline to create a NEW observation record.
//          Treats every photo as if it were freshly submitted by an officer.
//
// Supports batched pagination via get_total / offset / batch_size, following
// the same pattern used by recalculate-compliance-v3 and cleanup-and-recalculate.
// ============================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.7";
import { corsHeaders } from "../_shared/cors.ts";
import {
  adaptiveObservationInsert,
} from "../_shared/observationInsert.ts";

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

const MAX_INSERT_ATTEMPTS = 8;

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { status: 200, headers: getCorsHeaders(req) });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // ── Auth guard ──────────────────────────────────────────────────────────
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: "Missing Authorization header" }),
        { status: 401, headers: { ...getCorsHeaders(req), "content-type": "application/json" } },
      );
    }

    const jwt = authHeader.replace("Bearer ", "");
    const authClient = createClient(supabaseUrl, supabaseAnonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: authData, error: authError } = await authClient.auth.getUser(jwt);
    if (authError || !authData?.user) {
      return new Response(
        JSON.stringify({ error: "Session expired or invalid. Please log in again." }),
        { status: 401, headers: { ...getCorsHeaders(req), "content-type": "application/json" } },
      );
    }

    const authUserId = authData.user.id;

    // Verify user is admin or master
    const { data: profile, error: profileError } = await supabase
      .from("user_profiles")
      .select("id, role, organization_id")
      .eq("id", authUserId)
      .maybeSingle();

    if (profileError || !profile) {
      return new Response(
        JSON.stringify({ error: "User profile not found." }),
        { status: 403, headers: { ...getCorsHeaders(req), "content-type": "application/json" } },
      );
    }

    if (!["admin", "admin_officer", "master"].includes(profile.role)) {
      return new Response(
        JSON.stringify({ error: "Only admin users can run photo reingest." }),
        { status: 403, headers: { ...getCorsHeaders(req), "content-type": "application/json" } },
      );
    }

    // ── Parse request body ──────────────────────────────────────────────────
    const body = await req.json();
    const getTotal = body.get_total === true;
    const offset = Number(body.offset ?? 0);
    const batchSize = Math.min(Number(body.batch_size ?? 50), 100);
    const organizationId = body.organization_id ?? (profile.role !== "master" ? profile.organization_id : null);
    const dateFrom = body.date_from ?? null;
    const dateTo = body.date_to ?? null;

    // ── Build query for observations with photos ────────────────────────────
    function buildQuery(selectClause: string, count?: "exact") {
      let query = supabase
        .from("observations")
        .select(selectClause, count ? { count } : undefined)
        .or("photo.not.is.null,photo_url.not.is.null");

      if (organizationId) {
        query = query.eq("organization_id", organizationId);
      }
      if (dateFrom) {
        query = query.gte("recorded_at", dateFrom);
      }
      if (dateTo) {
        query = query.lte("recorded_at", dateTo);
      }

      return query;
    }

    // ── get_total mode: return count only ────────────────────────────────────
    if (getTotal) {
      const { count, error: countError } = await buildQuery("observation_id", "exact").range(0, 0);
      if (countError) {
        return new Response(
          JSON.stringify({ error: `Count query failed: ${countError.message}` }),
          { status: 500, headers: { ...getCorsHeaders(req), "content-type": "application/json" } },
        );
      }
      return new Response(
        JSON.stringify({ total: count ?? 0 }),
        { status: 200, headers: { ...getCorsHeaders(req), "content-type": "application/json" } },
      );
    }

    // ── Batch fetch observations ────────────────────────────────────────────
    const { data: rows, error: fetchError } = await buildQuery(
      "observation_id, plate_number, photo, photo_url, photo_hash, recorded_at, zone_id, organization_id, gps_latitude, gps_longitude, gps_accuracy, recorded_by, officer_notes",
    )
      .order("recorded_at", { ascending: false })
      .range(offset, offset + batchSize - 1);

    if (fetchError) {
      return new Response(
        JSON.stringify({ error: `Fetch failed: ${fetchError.message}` }),
        { status: 500, headers: { ...getCorsHeaders(req), "content-type": "application/json" } },
      );
    }

    const observations = rows || [];
    if (observations.length === 0) {
      return new Response(
        JSON.stringify({ processed: 0, created: 0, failed: 0, failures: [] }),
        { status: 200, headers: { ...getCorsHeaders(req), "content-type": "application/json" } },
      );
    }

    // ── Process each observation ────────────────────────────────────────────
    let created = 0;
    let failed = 0;
    const failures: Array<{ observation_id: string; reason: string }> = [];

    for (const obs of observations) {
      const observationId = obs.observation_id || "";
      const photoUrl = obs.photo || obs.photo_url || "";
      const photoHash = obs.photo_hash || null;

      if (!photoUrl) {
        failed++;
        failures.push({ observation_id: observationId, reason: "no_photo_url" });
        continue;
      }

      // Compute photo hash if not available from source observation
      let resolvedPhotoHash = photoHash;
      if (!resolvedPhotoHash) {
        try {
          const storageLocation = parseStorageLocation(photoUrl);
          if (storageLocation) {
            const { data: fileData, error: downloadError } = await supabase.storage
              .from(storageLocation.bucket)
              .download(storageLocation.path);
            if (!downloadError && fileData) {
              const bytes = new Uint8Array(await fileData.arrayBuffer());
              resolvedPhotoHash = await sha256Hash(bytes);
            }
          }
          if (!resolvedPhotoHash && /^https?:\/\//i.test(photoUrl)) {
            const resp = await fetch(photoUrl, { signal: AbortSignal.timeout(8000) });
            if (resp.ok) {
              const bytes = new Uint8Array(await resp.arrayBuffer());
              resolvedPhotoHash = await sha256Hash(bytes);
            }
          }
        } catch {
          // Continue without hash — it's not required for insert
        }
      }

      // Build new observation data — same photo, fresh record
      const newIdempotencyKey = `reingest-${observationId}-${Date.now()}`;
      const observationData: Record<string, unknown> = {
        plate_number: obs.plate_number || "MANUAL_REQUIRED",
        photo: photoUrl,
        photo_url: photoUrl,
        photo_hash: resolvedPhotoHash ?? null,
        recorded_at: obs.recorded_at ?? new Date().toISOString(),
        zone_id: obs.zone_id,
        organization_id: obs.organization_id,
        gps_latitude: obs.gps_latitude,
        gps_longitude: obs.gps_longitude,
        gps_accuracy: obs.gps_accuracy ?? null,
        recorded_by: obs.recorded_by ?? profile.id,
        officer_notes: obs.officer_notes
          ? `[Reingested] ${obs.officer_notes}`
          : `[Reingested from ${observationId}]`,
        vehicle_make: null,
        vehicle_model: null,
        vehicle_year: null,
        vehicle_color: null,
        self_contained: false,
        self_contained_expiry: null,
        is_compliant: true,
        breach_type: null,
        breach_reason: null,
        nights_stayed_this_month: 0,
        consecutive_nights: 0,
      };

      // Try to include idempotency_key — the adaptive insert will strip it
      // if the column doesn't exist.
      const insertPayload: Record<string, unknown> = {
        ...observationData,
        idempotency_key: newIdempotencyKey,
      };

      try {
        const { data: newObs, error: insertError } =
          await adaptiveObservationInsert(supabase, insertPayload, MAX_INSERT_ATTEMPTS);

        if (insertError || !newObs) {
          failed++;
          failures.push({
            observation_id: observationId,
            reason: (insertError as any)?.message || "insert_failed",
          });
          continue;
        }

        created++;
      } catch (err: any) {
        failed++;
        failures.push({
          observation_id: observationId,
          reason: err?.message || "exception",
        });
      }
    }

    return new Response(
      JSON.stringify({
        processed: observations.length,
        created,
        failed,
        failures: failures.slice(0, 20),
      }),
      { status: 200, headers: { ...getCorsHeaders(req), "content-type": "application/json" } },
    );
  } catch (error: any) {
    console.error("❌ Reingest photos error:", error.message);
    return new Response(
      JSON.stringify({ error: error.message || "Internal error" }),
      { status: 500, headers: { ...getCorsHeaders(req), "content-type": "application/json" } },
    );
  }
});
