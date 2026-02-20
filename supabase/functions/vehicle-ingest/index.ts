// ============================================================================
// Unified Vehicle Ingest - ALPR Primary + ORC Fallback
// ============================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.7";
import { corsHeaders } from "../_shared/cors.ts";
import { alprWithDataUrl, alprWithBytes } from "../_shared/alpr.ts";

const ALLOWED_ORIGINS = new Set([
  "https://preview-react-vite-vite-typescript-fvdypijc-d.onspace.build",
  "http://localhost:5173",
  "http://localhost:3000",
  // Add your production domains here:
  // "https://admin.yourdomain.nz",
  // "https://officer.yourdomain.nz",
]);

function getCorsHeaders(req: Request) {
  const origin = req.headers.get("origin") ?? "";
  return {
    ...(ALLOWED_ORIGINS.has(origin) ? { "Access-Control-Allow-Origin": origin } : {}),
    "Vary": "Origin",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "authorization, apikey, x-client-info, content-type",
    "Access-Control-Max-Age": "3600",
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

    // Parse request (JSON or multipart)
    let imageBytes: Uint8Array | null = null;
    let imageDataUrl: string | null = null;
    let gpsLatitude: number | null = null;
    let gpsLongitude: number | null = null;
    let recordedAt: string | null = null;
    let officerId: string | null = null;
    let organizationId: string | null = null;
    let zoneId: string | null = null;
    let idempotencyKey: string | null = null;

    const contentType = req.headers.get("content-type") ?? "";

    if (contentType.includes("application/json")) {
      const body = await req.json();
      imageDataUrl = body.image ?? body.photo_base64;
      gpsLatitude = body.gpsLatitude ?? body.gps_latitude;
      gpsLongitude = body.gpsLongitude ?? body.gps_longitude;
      recordedAt = body.recordedAt ?? body.recorded_at;
      officerId = body.officerId ?? body.officer_id;
      organizationId = body.organizationId ?? body.organization_id;
      zoneId = body.zoneId ?? body.zone_id;
      idempotencyKey = body.idempotencyKey ?? body.idempotency_key;
    } else if (contentType.includes("multipart/form-data")) {
      const formData = await req.formData();
      const photoFile = formData.get("photo") as File;
      if (photoFile) {
        const arrayBuffer = await photoFile.arrayBuffer();
        imageBytes = new Uint8Array(arrayBuffer);
      }
      gpsLatitude = parseFloat(formData.get("gpsLatitude") as string);
      gpsLongitude = parseFloat(formData.get("gpsLongitude") as string);
      recordedAt = formData.get("recordedAt") as string;
      officerId = formData.get("officerId") as string;
      organizationId = formData.get("organizationId") as string;
      zoneId = formData.get("zoneId") as string;
      idempotencyKey = formData.get("idempotencyKey") as string;
    }

    // Validate inputs
    if (!imageBytes && !imageDataUrl) {
      return new Response(JSON.stringify({ error: "Missing image data" }), {
        status: 400,
        headers: { ...getCorsHeaders(req), "content-type": "application/json" },
      });
    }

    if (!officerId) {
      return new Response(JSON.stringify({ error: "Missing officerId" }), {
        status: 400,
        headers: { ...getCorsHeaders(req), "content-type": "application/json" },
      });
    }

    console.log("📥 Received scan", {
      officerId,
      org: organizationId,
      zone: zoneId,
      hasBytes: !!imageBytes,
      hasDataUrl: !!imageDataUrl,
    });

    // Step 1: Try ALPR first
    const confMin = Number(Deno.env.get("ALPR_CONF_THRESHOLD") ?? 0.78);
    let alprResult = null;
    let plateNumber = null;
    let plateConfidence = null;

    try {
      if (imageBytes) {
        alprResult = await alprWithBytes(imageBytes);
      } else if (imageDataUrl) {
        alprResult = await alprWithDataUrl(imageDataUrl);
      }

      if (alprResult?.plate && (alprResult.confidence ?? 0) >= confMin) {
        plateNumber = alprResult.plate;
        plateConfidence = alprResult.confidence;
        console.log("📡 ALPR ✅", { plate: plateNumber, conf: plateConfidence });
      } else {
        console.log("⚠️ ALPR ❌", {
          plate: alprResult?.plate,
          conf: alprResult?.confidence,
          threshold: confMin,
        });
      }
    } catch (error: any) {
      console.error("❌ ALPR error:", error.message);
    }

    // Step 2: If ALPR failed, try ORC fallback
    let embedding = null;
    let embeddingQuality = null;
    let embeddingModelVersion = null;

    if (!plateNumber) {
      try {
        const inferenceUrl = Deno.env.get("INFERENCE_SERVICE_URL");
        if (!inferenceUrl) {
          console.warn("⚠️ INFERENCE_SERVICE_URL not configured, skipping ORC fallback");
        } else {
          console.log("🤖 ORC fallback triggered");

          const payload = imageDataUrl ?? `data:image/jpeg;base64,${btoa(String.fromCharCode(...(imageBytes ?? [])))}`;

          const inferRes = await fetch(`${inferenceUrl}/infer`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ image: payload }),
          });

          if (!inferRes.ok) {
            const text = await inferRes.text();
            console.error(`❌ ORC infer failed ${inferRes.status}:`, text);
          } else {
            const inferData = await inferRes.json();
            embedding = inferData.embedding;
            embeddingQuality = inferData.quality;
            embeddingModelVersion = inferData.model_version;
            console.log("🤖 ORC ✅", {
              dims: embedding?.length,
              quality: embeddingQuality,
              version: embeddingModelVersion,
            });
          }
        }
      } catch (error: any) {
        console.error("❌ ORC error:", error.message);
      }
    }

    // Step 3: Create observation with available data
    const observationData: any = {
      plate_number: plateNumber,
      plate_confidence: plateConfidence,
      gps_latitude: gpsLatitude,
      gps_longitude: gpsLongitude,
      recorded_at: recordedAt ?? new Date().toISOString(),
      recorded_by: officerId,
      organization_id: organizationId,
      zone_id: zoneId,
      vehicle_embedding: embedding,
      embedding_quality: embeddingQuality,
      embedding_model_version: embeddingModelVersion,
      embedding_created_at: embedding ? new Date().toISOString() : null,
    };

    // Store photo if we have it
    if (imageDataUrl || imageBytes) {
      // TODO: Implement photo storage with SHA-256 hashing
      // For now, just log that we have the photo
      console.log("📸 Photo available for storage");
    }

    console.log("✅ Ingest complete", {
      hasPlate: !!plateNumber,
      hasEmbedding: !!embedding,
    });

    return new Response(
      JSON.stringify({
        success: true,
        path: plateNumber ? "alpr" : "orc",
        plate: plateNumber,
        confidence: plateConfidence,
        embedding_quality: embeddingQuality,
        observation: observationData,
      }),
      {
        status: 200,
        headers: { ...getCorsHeaders(req), "content-type": "application/json" },
      }
    );
  } catch (error: any) {
    console.error("❌ Ingest error:", error.message);
    return new Response(
      JSON.stringify({ error: error.message }),
      {
        status: 500,
        headers: { ...getCorsHeaders(req), "content-type": "application/json" },
      }
    );
  }
});
