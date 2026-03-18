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

const DEFAULT_BATCH_SIZE = 10;
const MAX_BATCH_SIZE = 20;

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

    // ── Auth guard (local JWT decode — no network round-trip) ─────────────
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: "Missing Authorization header" }),
        { status: 401, headers: { ...getCorsHeaders(req), "content-type": "application/json" } },
      );
    }

    const jwt = authHeader.replace(/^Bearer\s+/i, "").trim();
    const jwtPayload = decodeJwtPayload(jwt);
    const authUserId: string | null =
      typeof jwtPayload?.sub === "string" && jwtPayload.sub.length > 0
        ? jwtPayload.sub
        : null;

    if (!authUserId) {
      return new Response(
        JSON.stringify({ error: "Session expired or invalid. Please log in again." }),
        { status: 401, headers: { ...getCorsHeaders(req), "content-type": "application/json" } },
      );
    }

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

    // ── Process each observation: reset plate + fire process-officer-scan ──
    // Strategy: instead of calling vehicle-ingest (expensive, synchronous),
    // we directly reset plate_number = "PROCESSING..." in the DB (fast, service
    // role), then fire process-officer-scan as fire-and-forget. This avoids
    // function-to-function HTTP round-trips that exhaust the 60 s wall clock.
    let updated = 0;
    let failed = 0;
    const failures: Array<{ observation_id: string; reason: string }> = [];
    const processOfficerScanUrl = `${supabaseUrl}/functions/v1/process-officer-scan`;
    const forwardHeaders = {
      "Authorization": authHeader!,
      "Content-Type": "application/json",
      "apikey": req.headers.get("apikey") || supabaseAnonKey,
    };

    for (const obs of observations) {
      const observationId = obs.observation_id || "";
      const photoUrl = (obs.photo_url || obs.photo || "").trim();

      if (!photoUrl) {
        failed++;
        failures.push({ observation_id: observationId, reason: "no_photo_url" });
        continue;
      }

      try {
        // Step 1: Reset plate to PROCESSING... so process-officer-scan does
        // not hit the already_enriched fast-exit.
        const { error: resetErr } = await supabase
          .from("observations")
          .update({ plate_number: "PROCESSING...", updated_at: new Date().toISOString() })
          .eq("observation_id", observationId);

        if (resetErr) {
          throw new Error(`plate reset failed: ${resetErr.message}`);
        }

        // Step 2: Fire process-officer-scan (fire-and-forget — do NOT await).
        // process-officer-scan handles ALPR, NZSCV, compliance, breach alerts.
        fetch(processOfficerScanUrl, {
          method: "POST",
          headers: forwardHeaders,
          body: JSON.stringify({
            observation_id: observationId,
            photo_url: photoUrl,
            allow_admin_override: true,
          }),
        }).catch((err) => {
          console.warn(`⚠️ process-officer-scan fire failed for ${observationId}:`, err?.message);
        });

        updated++;
      } catch (err: any) {
        failed++;
        failures.push({
          observation_id: observationId,
          reason: err?.message || "reset_failed",
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
