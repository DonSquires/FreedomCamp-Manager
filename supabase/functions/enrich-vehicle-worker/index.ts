// enrich-vehicle-worker
// ============================================================================
// Batch enriches canonical_vehicles records that are missing vehicle metadata
// (make, model, year, colour) by:
//
//   1. Fetching the vehicle's best observation photo from the evidence bucket
//   2. Calling the inference service (INFERENCE_SERVICE_URL/infer) to extract
//      make, model, colour, year, and self_contained status
//   3. Updating canonical_vehicles with the enriched data
//
// This is the preferred enrichment path while the MotorWeb API is unavailable.
// Results are tagged with nzscv_source = 'inference_worker'.
//
// Request body (JSON) — three calling modes:
//
//   Mode A — count only (used by DatabaseMaintenance.tsx):
//     { get_total: true }
//     Response: { total: number }
//
//   Mode B — paginated batch (used by DatabaseMaintenance.tsx):
//     { get_total: false, offset: number, batch_size: number }
//     Response: { processed, enriched, failed }
//
//   Mode C — simple batch (used by DatabaseTools.tsx):
//     { batchSize: number }
//     Response: { total_processed, enriched, failed, details }
//
// Required Supabase secrets:
//   INFERENCE_SERVICE_URL    URL of the ORC/AI inference service
//                            (same service used by orc-ingest)
// ============================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.7";
import { corsHeaders } from "../_shared/cors.ts";

// ── Base64 encode helper (chunked to avoid stack overflow on large images) ───

function uint8ToBase64(bytes: Uint8Array): string {
  let binary = "";
  const CHUNK = 8192;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

// ── Enrich a single vehicle via the inference service ─────────────────────────

interface EnrichResult {
  plate_number: string;
  success: boolean;
  message?: string;
  error?: string;
}

async function enrichVehicle(
  db: ReturnType<typeof createClient>,
  plateNumber: string,
  inferenceUrl: string,
): Promise<EnrichResult> {
  // Find most recent observation photo for this vehicle
  const { data: obs } = await db
    .from("observations")
    .select("photo_url")
    .eq("plate_number", plateNumber)
    .not("photo_url", "is", null)
    .order("recorded_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!obs?.photo_url) {
    // No photo available — mark as attempted so we don't keep retrying
    await db.from("canonical_vehicles").update({
      nzscv_last_checked: new Date().toISOString(),
      nzscv_source: "inference_worker",
    }).eq("plate_number", plateNumber);
    return { plate_number: plateNumber, success: false, error: "No observation photo available" };
  }

  // Fetch photo from storage
  const photoResp = await fetch(obs.photo_url, {
    signal: AbortSignal.timeout(15_000),
  });
  if (!photoResp.ok) {
    throw new Error(`Photo fetch failed [${photoResp.status}]: ${obs.photo_url}`);
  }

  const photoBytes = new Uint8Array(await photoResp.arrayBuffer());
  const imageBase64 = uint8ToBase64(photoBytes);

  // Call inference service
  const inferResp = await fetch(`${inferenceUrl}/infer`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ image_base64: imageBase64 }),
    signal: AbortSignal.timeout(30_000),
  });

  if (inferResp.status === 503) {
    throw new Error("Inference service unavailable (models not loaded)");
  }
  if (!inferResp.ok) {
    throw new Error(`Inference service error [${inferResp.status}]`);
  }

  const inferData = await inferResp.json();
  if (!inferData.success) {
    throw new Error(inferData.error || "Inference failed");
  }

  // Build update payload — only overwrite fields that inference returned
  const update: Record<string, unknown> = {
    nzscv_last_checked: new Date().toISOString(),
    nzscv_source: "inference_worker",
  };
  if (inferData.vehicle_make)   update.vehicle_make  = inferData.vehicle_make;
  if (inferData.vehicle_model)  update.vehicle_model = inferData.vehicle_model;
  // Inference service uses British spelling (vehicle_colour); DB column is American (vehicle_color)
  if (inferData.vehicle_colour) update.vehicle_color = inferData.vehicle_colour;
  if (inferData.vehicle_year)   update.vehicle_year  = inferData.vehicle_year;
  if (typeof inferData.self_contained === "boolean") {
    update.self_contained = inferData.self_contained;
  }

  await db.from("canonical_vehicles").update(update).eq("plate_number", plateNumber);

  return {
    plate_number: plateNumber,
    success: true,
    message: `Enriched via inference (make=${inferData.vehicle_make ?? "?"} model=${inferData.vehicle_model ?? "?"})`,
  };
}

// ── Main handler ─────────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const db = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const body = await req.json();
    const {
      get_total = false,
      offset = 0,
      batch_size,
      batchSize,
    } = body;

    const limit: number = batch_size ?? batchSize ?? 50;

    // ── Filter: vehicles with any missing metadata ─────────────────────────
    // A vehicle needs enrichment when make OR model is absent.
    // We also re-attempt vehicles that were previously attempted by the
    // inference worker but still lack data (in case new photos exist).
    const needsEnrichmentFilter = "vehicle_make.is.null,vehicle_model.is.null";

    // ── Mode A: count only ─────────────────────────────────────────────────
    if (get_total) {
      const { count, error } = await db
        .from("canonical_vehicles")
        .select("id", { count: "exact", head: true })
        .or(needsEnrichmentFilter);

      if (error) throw error;

      return new Response(
        JSON.stringify({ total: count ?? 0 }),
        { status: 200, headers: { ...corsHeaders, "content-type": "application/json" } },
      );
    }

    // ── Fetch batch ────────────────────────────────────────────────────────
    const { data: vehicles, error: fetchError } = await db
      .from("canonical_vehicles")
      .select("id, plate_number")
      .or(needsEnrichmentFilter)
      .range(offset, offset + limit - 1)
      .order("first_seen_at", { ascending: true });

    if (fetchError) throw fetchError;

    const inferenceUrl = Deno.env.get("INFERENCE_SERVICE_URL");

    let enriched = 0;
    let failed = 0;
    const details: EnrichResult[] = [];

    // Validate inference URL early — no point fetching vehicles if the service
    // is not configured. Still return a clean result rather than an error so
    // callers can display a meaningful message.
    if (!inferenceUrl) {
      // Mark all batch vehicles as attempted so the count converges
      for (const vehicle of vehicles ?? []) {
        await db.from("canonical_vehicles").update({
          nzscv_last_checked: new Date().toISOString(),
          nzscv_source: "inference_worker",
        }).eq("plate_number", vehicle.plate_number);
        details.push({
          plate_number: vehicle.plate_number,
          success: false,
          error: "INFERENCE_SERVICE_URL not configured",
        });
        failed++;
      }
      return new Response(
        JSON.stringify({
          success: true,
          processed: (vehicles ?? []).length,
          total_processed: (vehicles ?? []).length,
          enriched: 0,
          failed,
          details,
        }),
        { status: 200, headers: { ...corsHeaders, "content-type": "application/json" } },
      );
    }

    for (const vehicle of vehicles ?? []) {
      try {
        const result = await enrichVehicle(db, vehicle.plate_number, inferenceUrl);
        details.push(result);
        if (result.success) enriched++; else failed++;
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        console.warn(`⚠️  Enrichment failed for ${vehicle.plate_number}:`, msg);
        details.push({ plate_number: vehicle.plate_number, success: false, error: msg });
        failed++;
      }
    }

    const processed = (vehicles ?? []).length;

    console.log(`✅ enrich-vehicle-worker: processed=${processed} enriched=${enriched} failed=${failed}`);

    return new Response(
      JSON.stringify({
        success: true,
        processed,
        total_processed: processed, // alias for DatabaseTools.tsx
        enriched,
        failed,
        details,
      }),
      { status: 200, headers: { ...corsHeaders, "content-type": "application/json" } },
    );
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("❌ enrich-vehicle-worker error:", msg);
    return new Response(
      JSON.stringify({ error: msg }),
      { status: 500, headers: { ...corsHeaders, "content-type": "application/json" } },
    );
  }
});
