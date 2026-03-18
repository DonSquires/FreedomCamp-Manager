// ============================================================================
// Reingest Photos — Batch reprocess existing observation photos
// ============================================================================
// Purpose: Query existing observations that have photos, and for each one
//          re-run ingest/enrichment against the EXISTING observation row.
//          Treats every photo as if it were freshly submitted by an officer.
//
// Supports batched pagination via get_total / offset / batch_size, following
// the same pattern used by recalculate-compliance-v3 and cleanup-and-recalculate.
//
// Performance: Photo hash is reused from the source observation (no photo
// download). Each source photo is forwarded to vehicle-ingest so reingest uses
// the same end-to-end ingest pipeline as live officer scans.
//
// Improved: Safe body parsing with error handling for empty/invalid JSON bodies.
// ============================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.7";
import { corsHeaders } from "../_shared/cors.ts";

function getCorsHeaders(_req?: Request) {
  return {
    ...corsHeaders,
    "Access-Control-Max-Age": "3600",
  };
}

const DEFAULT_BATCH_SIZE = 10;
const MAX_BATCH_SIZE = 20;
const VEHICLE_INGEST_TIMEOUT_MS = Number(Deno.env.get("REINGEST_VEHICLE_INGEST_TIMEOUT_MS") ?? "25000");

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { status: 200, headers: getCorsHeaders(req) });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const supabase = createClient(supabaseUrl, supabaseKey);
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";

    // ── Auth guard ──────────────────────────────────────────────────────────
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: "Missing Authorization header" }),
        { status: 401, headers: { ...getCorsHeaders(req), "content-type": "application/json" } },
      );
    }

    const jwt = authHeader.replace("Bearer ", "");
    const { data: authData, error: authError } = await supabase.auth.getUser(jwt);
    if (authError || !authData?.user) {
      console.error("🚫 AUTH ERROR: Reingest session verification failed", authError?.message ?? "unknown");
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
    let body: Record<string, unknown> = {};
    try {
      const text = await req.text();
      if (text && text.trim().length > 0) {
        body = JSON.parse(text);
      }
    } catch {
      return new Response(
        JSON.stringify({ error: "Invalid JSON in request body" }),
        { status: 400, headers: { ...getCorsHeaders(req), "content-type": "application/json" } },
      );
    }
    const getTotal = body.get_total === true;
    const rawOffset = Number(body.offset ?? 0);
    const offset = Number.isFinite(rawOffset) ? Math.max(0, Math.floor(rawOffset)) : 0;
    const rawBatchSize = Number(body.batch_size ?? DEFAULT_BATCH_SIZE);
    const batchSize = Number.isFinite(rawBatchSize)
      ? Math.max(1, Math.min(Math.floor(rawBatchSize), MAX_BATCH_SIZE))
      : DEFAULT_BATCH_SIZE;
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
      const { count, error: countError } = await buildQuery("observation_id", "exact")
        .limit(0);
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

    // ── Process each observation via vehicle-ingest pipeline ───────────────
    let updated = 0;
    let failed = 0;
    const failures: Array<{ observation_id: string; reason: string }> = [];

    async function invokeVehicleIngest(payload: Record<string, unknown>) {
      const response = await fetch(`${supabaseUrl}/functions/v1/vehicle-ingest`, {
        method: "POST",
        headers: {
          "Authorization": authHeader,
          "Content-Type": "application/json",
          "apikey": req.headers.get("apikey") || supabaseAnonKey,
          "x-client-info": req.headers.get("x-client-info") || "reingest-photos/1.0",
          "x-client-timezone": req.headers.get("x-client-timezone") || "Pacific/Auckland",
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(VEHICLE_INGEST_TIMEOUT_MS),
      });

      const responseText = await response.text();
      let parsed: Record<string, unknown> | null = null;
      if (responseText) {
        try {
          parsed = JSON.parse(responseText);
        } catch {
          // Non-JSON response body; keep raw text handling below.
        }
      }

      if (!response.ok) {
        const message = String(
          parsed?.error ??
          parsed?.message ??
          responseText ??
          `vehicle-ingest upstream error HTTP ${response.status}`,
        );
        throw new Error(`[vehicle-ingest ${response.status}] ${message}`);
      }

      return parsed;
    }

    for (const obs of observations) {
      const observationId = obs.observation_id || "";
      const photoUrl = obs.photo || obs.photo_url || "";

      if (!photoUrl) {
        failed++;
        failures.push({ observation_id: observationId, reason: "no_photo_url" });
        continue;
      }

      // Reuse existing photo hash — no need to download the photo again.
      // The hash is only used for dedup and is optional.
      const resolvedPhotoHash = obs.photo_hash || null;
      const zoneId = obs.zone_id || null;

      if (!zoneId) {
        failed++;
        failures.push({ observation_id: observationId, reason: "missing_zone_id" });
        continue;
      }

      // Build vehicle-ingest payload using source observation metadata.
      const newIdempotencyKey = `reingest-update-${observationId}-${Date.now()}`;
      const ingestPayload: Record<string, unknown> = {
        existing_observation_id: observationId,
        photo_url: photoUrl,
        photo_hash: resolvedPhotoHash,
        recorded_at: obs.recorded_at ?? new Date().toISOString(),
        zone_id: zoneId,
        zoneId,
        organization_id: obs.organization_id,
        organizationId: obs.organization_id,
        gps_latitude: obs.gps_latitude,
        gps_longitude: obs.gps_longitude,
        gps_accuracy: obs.gps_accuracy ?? null,
        plate_number: obs.plate_number || null,
        plate: obs.plate_number || null,
        officer_notes: obs.officer_notes
          ? `[Reingested from ${observationId}; original_officer=${obs.recorded_by ?? "unknown"}] ${obs.officer_notes}`
          : `[Reingested from ${observationId}; original_officer=${obs.recorded_by ?? "unknown"}]`,
        notes: obs.officer_notes
          ? `[Reingested from ${observationId}; original_officer=${obs.recorded_by ?? "unknown"}] ${obs.officer_notes}`
          : `[Reingested from ${observationId}; original_officer=${obs.recorded_by ?? "unknown"}]`,
        idempotencyKey: newIdempotencyKey,
        idempotency_key: newIdempotencyKey,
      };

      try {
        await invokeVehicleIngest(ingestPayload);
        updated++;
      } catch (err: any) {
        failed++;
        failures.push({
          observation_id: observationId,
          reason: err?.message || "vehicle_ingest_failed",
        });
      }
    }

    return new Response(
      JSON.stringify({
        processed: observations.length,
        updated,
        created: updated,
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
