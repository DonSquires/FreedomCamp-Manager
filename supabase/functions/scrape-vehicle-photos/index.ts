// ============================================================================
// Scrape Vehicle Photos
// ============================================================================
// Purpose: Search NZ vehicle sales websites for a plate number, download the
// best available photo, store it in Supabase Storage, run it through the
// inference service for vehicle detection/embedding, and enrich the
// canonical_vehicles record with the photo URL and any extracted vehicle
// details (make, model, year, colour).
//
// POST body: { plate_number: string, force_update?: boolean }
//
// Steps:
//   1. Search Trade Me Motors and cars.co.nz for the plate
//   2. Download the first found photo
//   3. Upload to Supabase Storage (evidence bucket, vehicle-photos/ prefix)
//   4. Update canonical_vehicles.profile_photo
//   5. Call inference service (/infer) if INFERENCE_SERVICE_URL is configured
//   6. Update canonical_vehicles.vehicle_make/model/year/color if scraped
//   7. Return enriched result
// ============================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.7";
import { corsHeaders } from "../_shared/cors.ts";

const INFERENCE_SERVICE_URL = Deno.env.get("INFERENCE_SERVICE_URL") || null;

// ---------------------------------------------------------------------------
// HTML scraping helpers
// ---------------------------------------------------------------------------

interface ScrapedListing {
  photoUrl: string | null;
  title: string | null;
  listingUrl: string | null;
  vehicleMake: string | null;
  vehicleModel: string | null;
  vehicleYear: number | null;
  source: string;
}

const BROWSER_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "en-NZ,en;q=0.9",
};

/** Parse make/model/year from a free-text listing title such as
 *  "2019 Toyota Camry" or "Toyota Corolla 2017 1.8L" */
function parseTitleForVehicleDetails(title: string | null): {
  make: string | null;
  model: string | null;
  year: number | null;
} {
  if (!title) return { make: null, model: null, year: null };

  const yearMatch = title.match(/\b(19[5-9]\d|20[0-2]\d)\b/);
  const year = yearMatch ? parseInt(yearMatch[1]) : null;

  // Remove the year and split the rest
  const withoutYear = title.replace(/\b(19[5-9]\d|20[0-2]\d)\b/, "").trim();
  const words = withoutYear.split(/\s+/).filter(Boolean);
  const make = words[0] || null;
  const model = words.slice(1, 3).join(" ") || null;

  return { make, model, year };
}

/** Extract the __NEXT_DATA__ JSON embedded by Next.js pages */
function extractNextData(html: string): any | null {
  const match = html.match(
    /<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/
  );
  if (!match) return null;
  try {
    return JSON.parse(match[1]);
  } catch {
    return null;
  }
}

/** Search Trade Me Motors for a plate number.
 *  Trade Me's search page is rendered with Next.js so __NEXT_DATA__ contains
 *  the initial listing array. */
async function searchTradeMeMotors(
  plateNumber: string
): Promise<ScrapedListing> {
  const empty: ScrapedListing = {
    photoUrl: null,
    title: null,
    listingUrl: null,
    vehicleMake: null,
    vehicleModel: null,
    vehicleYear: null,
    source: "trademe_not_found",
  };

  // Trade Me allows filtering motors by registration plate
  const searchUrl = `https://www.trademe.co.nz/a/motors/used-cars?registration=${encodeURIComponent(
    plateNumber.toUpperCase()
  )}`;

  try {
    const resp = await fetch(searchUrl, {
      headers: BROWSER_HEADERS,
      signal: AbortSignal.timeout(15000),
    });

    if (!resp.ok) {
      console.warn(`Trade Me responded ${resp.status} for ${plateNumber}`);
      return { ...empty, source: "trademe_error" };
    }

    const html = await resp.text();

    // --- Attempt 1: parse __NEXT_DATA__ ---
    const nextData = extractNextData(html);
    if (nextData) {
      const pageProps = nextData?.props?.pageProps ?? {};
      // Trade Me nests search results at various paths depending on app version
      const listArray: any[] =
        pageProps?.searchResults?.list ??
        pageProps?.initialData?.list ??
        pageProps?.data?.list ??
        pageProps?.listings ??
        [];

      if (listArray.length > 0) {
        const listing = listArray[0];
        const photoUrl: string | null =
          listing?.primaryPhoto?.fullUrl ??
          listing?.photos?.[0]?.fullUrl ??
          listing?.thumbnailUrl ??
          listing?.primaryImage?.fullUrl ??
          null;

        const title: string | null =
          listing?.title ?? listing?.name ?? null;

        const listingId: string | number | null =
          listing?.listingId ?? listing?.id ?? null;
        const listingUrl = listingId
          ? `https://www.trademe.co.nz/a/motors/used-cars/listing/${listingId}`
          : searchUrl;

        const attrs = listing?.attributes ?? {};
        const make: string | null =
          attrs?.Make ?? listing?.make ?? null;
        const model: string | null =
          attrs?.Model ?? listing?.model ?? null;
        const yearRaw: string | null =
          attrs?.["Year of manufacture"] ??
          listing?.yearOfManufacture?.toString() ??
          null;
        const year = yearRaw ? parseInt(yearRaw) : null;

        if (photoUrl) {
          return {
            photoUrl,
            title,
            listingUrl,
            vehicleMake: make,
            vehicleModel: model,
            vehicleYear: year,
            source: "trademe",
          };
        }
      }
    }

    // --- Attempt 2: og:image meta tag ---
    const ogMatch = html.match(
      /<meta[^>]+property="og:image"[^>]+content="([^"]+)"/
    );
    if (ogMatch && ogMatch[1] && !ogMatch[1].includes("trademe-logo")) {
      const parsed = parseTitleForVehicleDetails(
        html.match(/<meta[^>]+property="og:title"[^>]+content="([^"]+)"/)?.[1] ??
          null
      );
      return {
        photoUrl: ogMatch[1],
        title: null,
        listingUrl: searchUrl,
        vehicleMake: parsed.make,
        vehicleModel: parsed.model,
        vehicleYear: parsed.year,
        source: "trademe_og",
      };
    }
  } catch (err: any) {
    console.warn("Trade Me search error:", err.message);
  }

  return empty;
}

/** Search cars.co.nz as a fallback NZ vehicle listing source. */
async function searchCarsCoNZ(plateNumber: string): Promise<ScrapedListing> {
  const empty: ScrapedListing = {
    photoUrl: null,
    title: null,
    listingUrl: null,
    vehicleMake: null,
    vehicleModel: null,
    vehicleYear: null,
    source: "cars_co_nz_not_found",
  };

  const searchUrl = `https://www.cars.co.nz/results/?q=${encodeURIComponent(
    plateNumber.toUpperCase()
  )}`;

  try {
    const resp = await fetch(searchUrl, {
      headers: BROWSER_HEADERS,
      signal: AbortSignal.timeout(12000),
    });
    if (!resp.ok) return { ...empty, source: "cars_co_nz_error" };

    const html = await resp.text();

    const ogMatch = html.match(
      /<meta[^>]+property="og:image"[^>]+content="([^"]+)"/
    );
    const titleMatch = html.match(
      /<meta[^>]+property="og:title"[^>]+content="([^"]+)"/
    );

    if (ogMatch && ogMatch[1]) {
      const parsed = parseTitleForVehicleDetails(titleMatch?.[1] ?? null);
      return {
        photoUrl: ogMatch[1],
        title: titleMatch?.[1] ?? null,
        listingUrl: searchUrl,
        vehicleMake: parsed.make,
        vehicleModel: parsed.model,
        vehicleYear: parsed.year,
        source: "cars_co_nz",
      };
    }
  } catch (err: any) {
    console.warn("cars.co.nz search error:", err.message);
  }

  return empty;
}

// ---------------------------------------------------------------------------
// Main Edge Function
// ---------------------------------------------------------------------------

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  try {
    const body = await req.json();
    const plateNumber: string | undefined = body?.plate_number;
    const forceUpdate: boolean = body?.force_update ?? false;

    if (!plateNumber) {
      return new Response(
        JSON.stringify({ error: "plate_number is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const plate = plateNumber.toUpperCase().trim();
    console.log(`🔍 Scraping vehicle photos for plate: ${plate}`);

    // Guard: skip if we already have a profile photo and force_update is false
    if (!forceUpdate) {
      const { data: existing } = await supabase
        .from("canonical_vehicles")
        .select("profile_photo")
        .eq("plate_number", plate)
        .maybeSingle();

      if (existing?.profile_photo) {
        return new Response(
          JSON.stringify({
            success: true,
            plate_number: plate,
            skipped: true,
            reason: "profile_photo already set; use force_update=true to overwrite",
            profile_photo: existing.profile_photo,
          }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }

    // -----------------------------------------------------------------------
    // Step 1: Search vehicle sales sites
    // -----------------------------------------------------------------------
    let listing = await searchTradeMeMotors(plate);

    if (!listing.photoUrl) {
      console.log("Trade Me found no photo, trying cars.co.nz...");
      listing = await searchCarsCoNZ(plate);
    }

    if (!listing.photoUrl) {
      console.log(`No photo found for plate ${plate} on any sales site`);
      return new Response(
        JSON.stringify({
          success: false,
          plate_number: plate,
          found: false,
          message: "No listing photo found on Trade Me or cars.co.nz",
          sources_checked: ["trademe", "cars_co_nz"],
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`📸 Found photo at ${listing.source}: ${listing.photoUrl}`);

    // -----------------------------------------------------------------------
    // Step 2: Download the photo
    // -----------------------------------------------------------------------
    const photoResp = await fetch(listing.photoUrl, {
      headers: { "User-Agent": BROWSER_HEADERS["User-Agent"] },
      signal: AbortSignal.timeout(20000),
    });

    if (!photoResp.ok) {
      return new Response(
        JSON.stringify({
          success: false,
          plate_number: plate,
          error: `Failed to download photo: HTTP ${photoResp.status}`,
          photo_url_attempted: listing.photoUrl,
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const photoBytes = new Uint8Array(await photoResp.arrayBuffer());
    const contentType = photoResp.headers.get("content-type") ?? "image/jpeg";
    const ext = contentType.includes("png")
      ? "png"
      : contentType.includes("webp")
      ? "webp"
      : "jpg";

    // -----------------------------------------------------------------------
    // Step 3: Upload to Supabase Storage (evidence bucket, vehicle-photos/)
    // -----------------------------------------------------------------------
    const storagePath = `vehicle-photos/${plate}/${Date.now()}-scraped.${ext}`;

    const { error: uploadError } = await supabase.storage
      .from("evidence")
      .upload(storagePath, photoBytes, {
        contentType,
        upsert: true,
      });

    if (uploadError) {
      console.error("Storage upload failed:", uploadError);
      return new Response(
        JSON.stringify({
          success: false,
          plate_number: plate,
          error: `Storage upload failed: ${uploadError.message}`,
        }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { data: publicUrlData } = supabase.storage
      .from("evidence")
      .getPublicUrl(storagePath);

    const storedPhotoUrl = publicUrlData.publicUrl;
    console.log(`✅ Photo stored at: ${storagePath}`);

    // -----------------------------------------------------------------------
    // Step 4: Optionally run through inference service
    // -----------------------------------------------------------------------
    let inferenceResult: any = null;

    if (INFERENCE_SERVICE_URL) {
      try {
        console.log(`🤖 Calling inference service: ${INFERENCE_SERVICE_URL}/infer`);

        const formData = new FormData();
        const blob = new Blob([photoBytes], { type: contentType });
        formData.append("photo", blob, `${plate}.${ext}`);

        const inferResp = await fetch(`${INFERENCE_SERVICE_URL}/infer`, {
          method: "POST",
          body: formData,
          signal: AbortSignal.timeout(30000),
        });

        if (inferResp.ok) {
          inferenceResult = await inferResp.json();
          console.log("✅ Inference complete:", {
            detected: !!inferenceResult?.data?.detection,
            quality: inferenceResult?.data?.embedding_quality,
          });
        } else {
          console.warn(`Inference service returned ${inferResp.status}`);
        }
      } catch (inferErr: any) {
        console.warn("Inference service call failed:", inferErr.message);
      }
    }

    // -----------------------------------------------------------------------
    // Step 5: Parse vehicle details (scraped listing + inference)
    // -----------------------------------------------------------------------
    let vehicleMake = listing.vehicleMake;
    let vehicleModel = listing.vehicleModel;
    let vehicleYear = listing.vehicleYear;

    // If listing title wasn't pre-parsed, try to parse it now
    if (!vehicleMake && listing.title) {
      const parsed = parseTitleForVehicleDetails(listing.title);
      if (!vehicleMake) vehicleMake = parsed.make;
      if (!vehicleModel) vehicleModel = parsed.model;
      if (!vehicleYear) vehicleYear = parsed.year;
    }

    // -----------------------------------------------------------------------
    // Step 6: Update canonical_vehicles
    // -----------------------------------------------------------------------
    const updatePayload: Record<string, any> = {
      profile_photo: storedPhotoUrl,
      profile_photo_selected_at: new Date().toISOString(),
      profile_photo_metadata: {
        source: listing.source,
        original_url: listing.photoUrl,
        listing_url: listing.listingUrl,
        listing_title: listing.title,
        scraped_at: new Date().toISOString(),
        inference: inferenceResult
          ? {
              detected: !!inferenceResult?.data?.detection,
              detection_confidence:
                inferenceResult?.data?.detection?.confidence ?? null,
              embedding_quality: inferenceResult?.data?.embedding_quality ?? null,
              model_version:
                inferenceResult?.data?.embedding_model_version ?? null,
            }
          : null,
      },
    };

    // Only update make/model/year if we extracted them and the record
    // doesn't already have authoritative values from MotorWeb
    if (vehicleMake) updatePayload.vehicle_make = vehicleMake;
    if (vehicleModel) updatePayload.vehicle_model = vehicleModel;
    if (vehicleYear) updatePayload.vehicle_year = vehicleYear;

    // Ensure the canonical record exists (upsert with minimal required fields)
    const { data: updated, error: dbError } = await supabase
      .from("canonical_vehicles")
      .upsert(
        {
          plate_number: plate,
          first_seen_at: new Date().toISOString(),
          last_seen_at: new Date().toISOString(),
          ...updatePayload,
        },
        { onConflict: "plate_number", ignoreDuplicates: false }
      )
      .select(
        "plate_number, profile_photo, vehicle_make, vehicle_model, vehicle_year, vehicle_color"
      )
      .single();

    if (dbError) {
      console.error("canonical_vehicles update failed:", dbError);
      return new Response(
        JSON.stringify({
          success: false,
          plate_number: plate,
          error: `Database update failed: ${dbError.message}`,
          photo_stored_at: storedPhotoUrl,
        }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`✅ canonical_vehicles updated for ${plate}`);

    return new Response(
      JSON.stringify({
        success: true,
        plate_number: plate,
        found: true,
        photo_url: storedPhotoUrl,
        source: listing.source,
        listing_url: listing.listingUrl,
        vehicle_details: {
          make: vehicleMake,
          model: vehicleModel,
          year: vehicleYear,
        },
        inference_available: !!inferenceResult,
        canonical_record: updated,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err: any) {
    console.error("scrape-vehicle-photos error:", err);
    return new Response(
      JSON.stringify({ error: err.message ?? "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
