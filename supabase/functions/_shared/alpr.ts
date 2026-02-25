// ============================================================================
// ALPR Helper - Snapshot Cloud API Only
// Supports multipart/form-data for optimal performance
// ============================================================================

export interface ALPRResult {
  plate: string | null;
  confidence: number | null;
  raw: any;
}

/**
 * Call Plate Recognizer Snapshot Cloud API
 * @param imageBytes - Raw image bytes (JPEG/PNG)
 * @param options - Optional config overrides
 */
export async function alprWithBytes(
  imageBytes: Uint8Array,
  options?: {
    regions?: string;
    mmc?: boolean;
    config?: string;
    timeout?: number;
  }
): Promise<ALPRResult> {
  // Accept all known secret name variants (most specific first)
  const token =
    Deno.env.get("PLATERECOGNIZER_TOKEN") ??
    Deno.env.get("ALPR_API_TOKEN") ??
    Deno.env.get("PLATE_RECOGNIZER_TOKEN"); // legacy name — kept for backward compat
  const url =
    Deno.env.get("ALPR_API_URL") ??
    Deno.env.get("ALPR_CLOUD_URL") ??
    "https://api.platerecognizer.com/v1/plate-reader/";
  const regions = options?.regions ?? Deno.env.get("ALPR_REGIONS") ?? "nz";
  const mmc = options?.mmc ?? (Deno.env.get("ALPR_MMC") === "true");
  const config = options?.config ?? Deno.env.get("ALPR_CONFIG") ?? '{"mode":"fast"}';
  const timeout = options?.timeout ?? Number(Deno.env.get("ALPR_TIMEOUT_MS") ?? 15000);

  if (!token) {
    console.error("❌ No Plate Recognizer token configured (set PLATERECOGNIZER_TOKEN or ALPR_API_TOKEN in Supabase secrets)");
    return { plate: null, confidence: null, raw: null };
  }

  try {
    const formData = new FormData();
    const blob = new Blob([imageBytes], { type: "image/jpeg" });
    formData.append("upload", blob, "photo.jpg");
    formData.append("regions", regions);
    if (mmc) formData.append("mmc", "true");
    if (config) formData.append("config", config);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Authorization": `Token ${token}`,
      },
      body: formData,
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      const text = await response.text();
      console.error(`❌ ALPR API error ${response.status}:`, text);
      return { plate: null, confidence: null, raw: { error: text, status: response.status } };
    }

    const data = await response.json();

    // Extract best result
    if (data.results && data.results.length > 0) {
      const best = data.results[0];
      const plate = best.plate?.toUpperCase() ?? null;
      const confidence = best.score ?? null;

      return { plate, confidence, raw: data };
    }

    console.warn("⚠️ ALPR: No plates detected");
    return { plate: null, confidence: null, raw: data };
  } catch (error: any) {
    if (error.name === "AbortError") {
      console.error("❌ ALPR timeout after", timeout, "ms");
    } else {
      console.error("❌ ALPR error:", error.message);
    }
    return { plate: null, confidence: null, raw: { error: error.message } };
  }
}

/**
 * Call ALPR with base64 data URL
 * @param dataUrl - Base64-encoded image (data:image/jpeg;base64,...)
 */
export async function alprWithDataUrl(
  dataUrl: string,
  options?: {
    regions?: string;
    mmc?: boolean;
    config?: string;
    timeout?: number;
  }
): Promise<ALPRResult> {
  try {
    const bytes = decodeDataUrl(dataUrl);
    return await alprWithBytes(bytes, options);
  } catch (error: any) {
    console.error("❌ Failed to decode data URL:", error.message);
    return { plate: null, confidence: null, raw: { error: error.message } };
  }
}

/**
 * Decode base64 data URL to Uint8Array
 */
function decodeDataUrl(dataUrl: string): Uint8Array {
  const base64 = dataUrl.split(",")[1];
  if (!base64) throw new Error("Invalid data URL format");

  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}
