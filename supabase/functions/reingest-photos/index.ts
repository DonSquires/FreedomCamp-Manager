// ============================================================================
// Reingest Photos — Batch reprocess existing observation photos
// ============================================================================
// Purpose: Query existing observations that have photos, and for each one
//          create a NEW observation record and run compliance evaluation.
//          Treats every photo as if it were freshly submitted by an officer.
//
// Supports batched pagination via get_total / offset / batch_size, following
// the same pattern used by recalculate-compliance-v3 and cleanup-and-recalculate.
//
// Performance: Photo hash is reused from the source observation (no photo
// download).  Compliance evaluation is invoked via the
// auto_evaluate_compliance_and_create_breach RPC after each insert.
//
// Improved: Safe body parsing with error handling for empty/invalid JSON bodies.
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

const MAX_INSERT_ATTEMPTS = 8;

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { status: 200, headers: getCorsHeaders(req) });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
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

    // ── Process each observation ────────────────────────────────────────────
    let created = 0;
    let failed = 0;
    const failures: Array<{ observation_id: string; reason: string }> = [];

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

      // Build new observation data — same photo, fresh record
      const newIdempotencyKey = `reingest-${observationId}-${Date.now()}`;
      const observationData: Record<string, unknown> = {
        plate_number: obs.plate_number || "MANUAL_REQUIRED",
        photo: photoUrl,
        photo_url: photoUrl,
        photo_hash: resolvedPhotoHash,
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

        const newObservationId = (newObs as any).observation_id ?? (newObs as any).id;

        // Trigger compliance evaluation for the new observation
        if (newObservationId) {
          try {
            await supabase.rpc("auto_evaluate_compliance_and_create_breach", {
              p_observation_id: newObservationId,
            });
          } catch (compErr: any) {
            // Compliance evaluation failure is non-fatal — the observation was
            // still created.  Log it so the admin can investigate.
            console.warn(
              `⚠️ Compliance evaluation failed for reingested observation ${newObservationId}:`,
              compErr?.message || compErr,
            );
          }
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
