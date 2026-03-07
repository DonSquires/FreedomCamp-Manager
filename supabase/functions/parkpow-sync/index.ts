/**
 * ParkPow Sync Edge Function
 *
 * Provides three synchronisation operations, invoked manually or on schedule:
 *
 *   action: "sync-lots"       — Create/update ParkPow lots for each FreedomCamp zone
 *   action: "sync-watchlist"  — Push flagged/exempt canonical_vehicles to ParkPow
 *   action: "push-violations" — Push unsynced compliance breaches to ParkPow violations
 *
 * POST /functions/v1/parkpow-sync
 * Body: { "action": "sync-lots" | "sync-watchlist" | "push-violations" }
 *
 * Requires: PARKPOW_API_TOKEN in Supabase secrets (already configured ✅)
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.7";
import { corsHeaders } from "../_shared/cors.ts";
import {
  checkWatchlist,
  createLot,
  createViolation,
  isParkPowEnabled,
  listLots,
  blockVehicle,
  permitVehicle,
} from "../_shared/parkpow.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (!isParkPowEnabled()) {
    return json({ success: false, error: "PARKPOW_API_TOKEN not configured in Supabase secrets" }, 503);
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  try {
    const { action } = await req.json();

    switch (action) {
      case "sync-lots":     return json(await syncLots(supabase));
      case "sync-watchlist": return json(await syncWatchlist(supabase));
      case "push-violations": return json(await pushViolations(supabase));
      default:
        return json({
          success: false,
          error: `Unknown action "${action}". Valid: sync-lots | sync-watchlist | push-violations`,
        }, 400);
    }
  } catch (err: any) {
    console.error("❌ parkpow-sync error:", err);
    return json({ success: false, error: err.message }, 500);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// sync-lots: ensure every FreedomCamp zone has a corresponding ParkPow lot
// ─────────────────────────────────────────────────────────────────────────────
async function syncLots(supabase: ReturnType<typeof createClient>) {
  const { data: zones, error } = await supabase
    .from("zones")
    .select("id, name, parkpow_lot_id");

  if (error) throw error;

  const existingLots = await listLots();
  // Build lookup: external_id (our zone UUID) → ParkPow lot id
  const lotByExternalId = new Map(
    existingLots
      .filter((l) => l.external_id)
      .map((l) => [l.external_id!, l.id]),
  );

  const results: Array<{ zone_id: string; action: string; lot_id?: number }> = [];

  for (const zone of zones ?? []) {
    if (zone.parkpow_lot_id) {
      results.push({ zone_id: zone.id, action: "already-synced", lot_id: zone.parkpow_lot_id });
      continue;
    }

    // Check if a lot already exists with our zone UUID as external_id
    const existingLotId = lotByExternalId.get(zone.id);
    if (existingLotId) {
      await supabase.from("zones").update({ parkpow_lot_id: existingLotId }).eq("id", zone.id);
      results.push({ zone_id: zone.id, action: "linked-existing", lot_id: existingLotId });
      continue;
    }

    // Create new lot
    const lot = await createLot({ name: zone.name, external_id: zone.id });
    await supabase.from("zones").update({ parkpow_lot_id: lot.id }).eq("id", zone.id);
    results.push({ zone_id: zone.id, action: "created", lot_id: lot.id });
  }

  console.log(`✅ sync-lots: processed ${results.length} zones`);
  return { success: true, synced: results.length, details: results };
}

// ─────────────────────────────────────────────────────────────────────────────
// sync-watchlist: push flagged/exempt vehicles to ParkPow
// ─────────────────────────────────────────────────────────────────────────────
async function syncWatchlist(supabase: ReturnType<typeof createClient>) {
  // Fetch vehicles that are flagged or exempt but not yet synced to ParkPow
  const { data: vehicles, error } = await supabase
    .from("canonical_vehicles")
    .select("id, plate_number, is_flagged, is_exempt, parkpow_vehicle_id")
    .or("is_flagged.eq.true,is_exempt.eq.true")
    .is("parkpow_vehicle_id", null);

  if (error) throw error;

  let blocked = 0;
  let permitted = 0;
  let failed = 0;

  for (const v of vehicles ?? []) {
    try {
      if (v.is_flagged) {
        const pv = await blockVehicle(v.plate_number, "Flagged in FreedomCamp Manager");
        await supabase.from("canonical_vehicles").update({ parkpow_vehicle_id: pv.id }).eq("id", v.id);
        blocked++;
      } else if (v.is_exempt) {
        const pv = await permitVehicle(v.plate_number, "Exempt in FreedomCamp Manager");
        await supabase.from("canonical_vehicles").update({ parkpow_vehicle_id: pv.id }).eq("id", v.id);
        permitted++;
      }
    } catch (err) {
      console.warn(`⚠️  Failed to sync vehicle ${v.plate_number}:`, err);
      failed++;
    }
  }

  console.log(`✅ sync-watchlist: blocked=${blocked} permitted=${permitted} failed=${failed}`);
  return { success: true, blocked, permitted, failed };
}

// ─────────────────────────────────────────────────────────────────────────────
// push-violations: push compliance breaches to ParkPow as formal violations
// ─────────────────────────────────────────────────────────────────────────────
async function pushViolations(supabase: ReturnType<typeof createClient>) {
  // Fetch observations that are breaches and have a ParkPow session but no violation yet
  const { data: breaches, error } = await supabase
    .from("observations")
    .select("*, zones(parkpow_lot_id)")
    .eq("is_compliant", false)
    .not("parkpow_session_id", "is", null)
    .is("parkpow_violation_id", null)
    .limit(100);

  if (error) throw error;

  let pushed = 0;
  let failed = 0;

  for (const obs of breaches ?? []) {
    const obsId = (obs as any).observation_id ?? (obs as any).id;
    try {
      const reason = [obs.breach_type, obs.breach_reason].filter(Boolean).join(": ")
        || "Compliance breach";

      const violation = await createViolation({
        session_id: obs.parkpow_session_id,
        reason,
      });

      await supabase
        .from("observations")
        .update({ parkpow_violation_id: violation.id })
        .eq((obs as any).observation_id ? 'observation_id' : 'id', obsId);

      pushed++;
    } catch (err) {
      console.warn(`⚠️  Failed to push violation for observation ${obsId}:`, err);
      failed++;
    }
  }

  console.log(`✅ push-violations: pushed=${pushed} failed=${failed}`);
  return { success: true, pushed, failed };
}

// ─────────────────────────────────────────────────────────────────────────────
function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
