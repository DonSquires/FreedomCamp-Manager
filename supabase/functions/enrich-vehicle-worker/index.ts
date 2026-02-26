// ============================================================================
// enrich-vehicle-worker
// ============================================================================
// Batch-enriches canonical_vehicles records using MotorWeb (NZ vehicle
// registry) data by calling the enrich-from-motorweb Edge Function internally.
//
// Called by:
//   - src/pages/DatabaseTools.tsx      (admin manual trigger)
//   - src/pages/DatabaseMaintenance.tsx (batch maintenance)
//
// Request body (JSON):
//   batchSize  number?  Max vehicles to process (default: 50, max: 200)
//
// Response (JSON):
//   total_processed  number
//   enriched         number
//   failed           number
//   details          Array<{ plate_number, status, message }>
// ============================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.7";
import { corsHeaders } from "../_shared/cors.ts";

const MAX_BATCH = 200;
const DEFAULT_BATCH = 50;
// Minimum days between re-enrichment attempts
const REENRICH_DAYS = 30;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { status: 200, headers: corsHeaders });
  }

  // Auth guard
  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) {
    return new Response(
      JSON.stringify({ error: "Missing or malformed Authorization header" }),
      { status: 401, headers: { ...corsHeaders, "content-type": "application/json" } }
    );
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceKey) {
    return new Response(
      JSON.stringify({ error: "Server misconfiguration: missing required environment variables" }),
      { status: 500, headers: { ...corsHeaders, "content-type": "application/json" } }
    );
  }
  const db = createClient(supabaseUrl, serviceKey);

  // Verify JWT
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  const anonClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: { user }, error: userErr } = await anonClient.auth.getUser();
  if (userErr || !user) {
    return new Response(
      JSON.stringify({ error: "Unauthorized: invalid session" }),
      { status: 401, headers: { ...corsHeaders, "content-type": "application/json" } }
    );
  }

  try {
    const body = await req.json().catch(() => ({}));
    const batchSize = Math.min(
      parseInt(body.batchSize ?? DEFAULT_BATCH, 10) || DEFAULT_BATCH,
      MAX_BATCH
    );

    console.log(`🚀 enrich-vehicle-worker: batch_size=${batchSize}`);

    // ── Fetch vehicles that need enrichment ───────────────────────────────
    // Priority: vehicles with no make/model first, then vehicles not enriched
    // recently (using updated_at as a proxy for enrichment recency).
    const cutoffDate = new Date(
      Date.now() - REENRICH_DAYS * 24 * 60 * 60 * 1000
    ).toISOString();

    const { data: vehicles, error: fetchError } = await db
      .from("canonical_vehicles")
      .select("plate_number, vehicle_make, updated_at")
      .or(`vehicle_make.is.null,updated_at.lt.${cutoffDate}`)
      .order("vehicle_make", { ascending: true, nullsFirst: true })
      .order("last_seen_at", { ascending: false })
      .limit(batchSize);

    if (fetchError) {
      throw new Error("Failed to fetch vehicles: " + fetchError.message);
    }

    if (!vehicles || vehicles.length === 0) {
      return new Response(
        JSON.stringify({
          total_processed: 0,
          enriched: 0,
          failed: 0,
          details: [],
          message: "No vehicles require enrichment at this time",
        }),
        { status: 200, headers: { ...corsHeaders, "content-type": "application/json" } }
      );
    }

    console.log(`📋 Found ${vehicles.length} vehicles to enrich`);

    // ── Enrich each vehicle via enrich-from-motorweb ──────────────────────
    const details: Array<{ plate_number: string; status: string; message: string }> = [];
    let enriched = 0;
    let failed = 0;

    for (const vehicle of vehicles) {
      const plate = vehicle.plate_number;
      try {
        const enrichResp = await fetch(
          `${supabaseUrl}/functions/v1/enrich-from-motorweb`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${serviceKey}`,
            },
            body: JSON.stringify({
              plateNumber: plate,
              specificReason: "Freedom Camping Compliance Check",
            }),
            signal: AbortSignal.timeout(20_000),
          }
        );

        if (!enrichResp.ok) {
          const errText = await enrichResp.text().catch(() => enrichResp.statusText);
          throw new Error(`HTTP ${enrichResp.status}: ${errText}`);
        }

        const enrichData = await enrichResp.json();
        if (enrichData.error) {
          throw new Error(enrichData.error);
        }

        enriched++;
        details.push({ plate_number: plate, status: "enriched", message: "OK" });
        console.log(`✅ Enriched ${plate}`);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`⚠️ Failed to enrich ${plate}: ${msg}`);
        failed++;
        details.push({ plate_number: plate, status: "failed", message: msg });
      }
    }

    const total = vehicles.length;
    console.log(`📊 Done: total=${total} enriched=${enriched} failed=${failed}`);

    return new Response(
      JSON.stringify({ total_processed: total, enriched, failed, details }),
      { status: 200, headers: { ...corsHeaders, "content-type": "application/json" } }
    );
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("❌ enrich-vehicle-worker error:", msg);
    return new Response(
      JSON.stringify({ error: msg }),
      { status: 500, headers: { ...corsHeaders, "content-type": "application/json" } }
    );
  }
});
