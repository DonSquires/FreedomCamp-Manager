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
// Performance: this function only fetches candidate observations. The browser
// then invokes vehicle-ingest per observation so each reingest appears as a
// real vehicle-ingest invocation without risking a long-running batch timeout.
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

    const observations = (rows || []).map((obs) => ({
      observation_id: obs.observation_id,
      photo_url: obs.photo_url || obs.photo || null,
      photo_hash: obs.photo_hash ?? null,
      recorded_at: obs.recorded_at ?? null,
      zone_id: obs.zone_id ?? null,
      organization_id: obs.organization_id ?? null,
      gps_latitude: obs.gps_latitude ?? null,
      gps_longitude: obs.gps_longitude ?? null,
      gps_accuracy: obs.gps_accuracy ?? null,
      plate_number: obs.plate_number ?? null,
      officer_notes: obs.officer_notes ?? null,
    }));

    return new Response(
      JSON.stringify({
        processed: observations.length,
        observations,
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
