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
const DEFAULT_SCAN_CHUNK_SIZE = 50;
const MAX_SCAN_ITERATIONS = 12;

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
    const rawBatchSize = Number(body.batch_size ?? DEFAULT_BATCH_SIZE);
    const batchSize = Number.isFinite(rawBatchSize)
      ? Math.max(1, Math.min(Math.floor(rawBatchSize), MAX_BATCH_SIZE))
      : DEFAULT_BATCH_SIZE;
    const beforeRecordedAt = typeof body.before_recorded_at === "string" && body.before_recorded_at.trim().length > 0
      ? body.before_recorded_at.trim()
      : null;
    const organizationId = body.organization_id ?? (profile.role !== "master" ? profile.organization_id : null);
    const dateFrom = body.date_from ?? null;
    const dateTo = body.date_to ?? null;

    console.log("📦 reingest-photos request", {
      user_id: authUserId,
      role: profile.role,
      organization_id: organizationId,
      date_from: dateFrom,
      date_to: dateTo,
      before_recorded_at: beforeRecordedAt,
      batch_size: batchSize,
      get_total: getTotal,
    });

    // ── Build query for observations ordered by recorded_at ─────────────────
    // We intentionally avoid filtering on photo/photo_url in SQL because that
    // path is timing out on the live table. The table has recorded_at/org/date
    // indexes, so we walk that index in chunks and filter photo presence in
    // memory until we collect a small batch.
    function buildQuery(selectClause: string, count?: "exact") {
      let query = supabase
        .from("observations")
        .select(selectClause, count ? { count } : undefined);

      if (organizationId) {
        query = query.eq("organization_id", organizationId);
      }
      if (dateFrom) {
        query = query.gte("recorded_at", dateFrom);
      }
      if (dateTo) {
        query = query.lte("recorded_at", dateTo);
      }
      if (beforeRecordedAt) {
        query = query.lt("recorded_at", beforeRecordedAt);
      }

      return query;
    }

    // ── get_total mode: return count only ────────────────────────────────────
    if (getTotal) {
      return new Response(
        JSON.stringify({ total: null, warning: "Count disabled for performance; batches stream until no more rows remain." }),
        { status: 200, headers: { ...getCorsHeaders(req), "content-type": "application/json" } },
      );
    }

    // ── Cursor scan observations, filter photo presence in memory ───────────
    const scanChunkSize = Math.max(DEFAULT_SCAN_CHUNK_SIZE, batchSize * 5);
    const observations: Array<Record<string, unknown>> = [];
    let scanCursor = beforeRecordedAt;
    let scannedRows = 0;
    let lastRowRecordedAt: string | null = beforeRecordedAt;

    for (let iteration = 0; iteration < MAX_SCAN_ITERATIONS && observations.length < batchSize; iteration++) {
      let query = supabase
        .from("observations")
        .select("observation_id, plate_number, photo, photo_url, photo_hash, recorded_at, zone_id, organization_id, gps_latitude, gps_longitude, gps_accuracy, recorded_by, officer_notes")
        .order("recorded_at", { ascending: false })
        .limit(scanChunkSize);

      if (organizationId) {
        query = query.eq("organization_id", organizationId);
      }
      if (dateFrom) {
        query = query.gte("recorded_at", dateFrom);
      }
      if (dateTo) {
        query = query.lte("recorded_at", dateTo);
      }
      if (scanCursor) {
        query = query.lt("recorded_at", scanCursor);
      }

      const { data: rows, error: fetchError } = await query;

      if (fetchError) {
        return new Response(
          JSON.stringify({ error: `Fetch failed: ${fetchError.message}` }),
          { status: 500, headers: { ...getCorsHeaders(req), "content-type": "application/json" } },
        );
      }

      const chunkRows = rows || [];
      if (chunkRows.length === 0) {
        lastRowRecordedAt = null;
        break;
      }

      scannedRows += chunkRows.length;
      const lastRow = chunkRows[chunkRows.length - 1];
      lastRowRecordedAt = lastRow?.recorded_at ?? null;
      scanCursor = lastRowRecordedAt;

      for (const row of chunkRows) {
        if (row.photo || row.photo_url) {
          observations.push({
            observation_id: row.observation_id,
            photo_url: row.photo_url || row.photo || null,
            photo_hash: row.photo_hash ?? null,
            recorded_at: row.recorded_at ?? null,
            zone_id: row.zone_id ?? null,
            organization_id: row.organization_id ?? null,
            gps_latitude: row.gps_latitude ?? null,
            gps_longitude: row.gps_longitude ?? null,
            gps_accuracy: row.gps_accuracy ?? null,
            plate_number: row.plate_number ?? null,
            officer_notes: row.officer_notes ?? null,
          });
        }

        if (observations.length >= batchSize) {
          break;
        }
      }

      if (chunkRows.length < scanChunkSize) {
        break;
      }
    }

    const serializedObservations = observations.map((obs) => ({
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

    console.log("📦 reingest-photos batch ready", {
      before_recorded_at: beforeRecordedAt,
      batch_size: batchSize,
      matched: serializedObservations.length,
      scanned_rows: scannedRows,
      next_before_recorded_at: lastRowRecordedAt,
    });

    return new Response(
      JSON.stringify({
        processed: serializedObservations.length,
        scanned_rows: scannedRows,
        next_before_recorded_at: lastRowRecordedAt,
        observations: serializedObservations,
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
