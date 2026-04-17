// ============================================================================
// ALPR Helper — supports both Plate Recognizer cloud API and self-hosted
// local inference service.
//
// Provider selection (ALPR_PROVIDER env var):
//   "local"           — always call the local inference service /infer/alpr
//   "plate_recognizer"— always call Plate Recognizer cloud API
//   "auto" (default)  — use local if INFERENCE_SERVICE_URL is set and
//                       PLATERECOGNIZER_TOKEN is not; otherwise cloud API
//
// The local provider returns the same ALPRResult shape so all call sites
// are unaffected.
// ============================================================================

import { fetchWithRetry } from './fetchWithRetry.ts';
import { normalizeServiceUrl, truncateForDisplay } from './urlUtils.ts';

export interface ALPRResult {
  plate: string | null;
  confidence: number | null;
  make: string | null;
  model: string | null;
  color: string | null;
  orientation: string | null;
  makeConfidence: number | null;
  modelConfidence: number | null;
  colorConfidence: number | null;
  raw: any;
}

// ── Local inference service ALPR ─────────────────────────────────────────────
async function alprLocal(
  imageBytes: Uint8Array,
  options?: { timeout?: number }
): Promise<ALPRResult> {
  const rawUrl = Deno.env.get("INFERENCE_SERVICE_URL");
  const inferenceUrl = normalizeServiceUrl(rawUrl);
  const authToken    = Deno.env.get("INFERENCE_SERVICE_TOKEN") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const timeout      = options?.timeout ?? Number(Deno.env.get("ALPR_TIMEOUT_MS") ?? 10000);

  if (!inferenceUrl) {
    const errorMsg = rawUrl 
      ? `INFERENCE_SERVICE_URL is malformed: "${truncateForDisplay(rawUrl)}"`
      : "INFERENCE_SERVICE_URL not set";
    console.error(`❌ ${errorMsg}`);
    return emptyResult({ error: errorMsg });
  }

  try {
    const formData = new FormData();
    const blob = new Blob([imageBytes], { type: "image/jpeg" });
    formData.append("photo", blob, "photo.jpg");

    const response = await fetchWithRetry(`${inferenceUrl}/infer/alpr`, {
      method: "POST",
      headers: authToken ? { Authorization: `Bearer ${authToken}` } : {},
      body: formData,
    }, {
      retries: 2,
      timeoutMs: timeout,
      backoffMs: 500,
    });

    if (!response.ok) {
      const text = await response.text();
      console.error(`❌ Local ALPR error ${response.status}:`, text);
      return emptyResult({ error: text, status: response.status });
    }

    const data = await response.json();

    // Parse the Plate Recognizer-compatible response from /infer/alpr
    const best = data?.results?.[0] ?? null;
    const plate = (best?.plate ?? data?.plate ?? "")
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, "") || null;

    return {
      plate,
      confidence:      best?.score      ?? data?.confidence ?? null,
      make:            null,
      model:           null,
      color:           null,
      orientation:     null,
      makeConfidence:  null,
      modelConfidence: null,
      colorConfidence: null,
      raw:             data,
    };
  } catch (error: any) {
    if (error.name === "AbortError") {
      console.error("❌ Local ALPR timeout after", timeout, "ms");
    } else {
      console.error("❌ Local ALPR error:", error.message);
    }
    return emptyResult({ error: error.message });
  }
}

function emptyResult(raw: any = null): ALPRResult {
  return {
    plate: null, confidence: null, make: null, model: null,
    color: null, orientation: null,
    makeConfidence: null, modelConfidence: null, colorConfidence: null,
    raw,
  };
}

/**
 * Call ALPR — routes to local inference service or Plate Recognizer cloud API
 * based on ALPR_PROVIDER env var (default: "auto").
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
  const provider = Deno.env.get("ALPR_PROVIDER") ?? "auto";
  const token = Deno.env.get("PLATERECOGNIZER_TOKEN") ??
                Deno.env.get("PLATE_RECOGNIZER_TOKEN");
  const rawInferenceUrl = Deno.env.get("INFERENCE_SERVICE_URL");
  const inferenceUrl = normalizeServiceUrl(rawInferenceUrl);

  const useLocal =
    provider === "local" ||
    (provider === "auto" && !!inferenceUrl && !token);

  if (useLocal) {
    return alprLocal(imageBytes, options);
  }

  // ── Plate Recognizer cloud API (existing implementation) ─────────────────
  const url = Deno.env.get("ALPR_CLOUD_URL") ?? "https://api.platerecognizer.com/v1/plate-reader/";
  const regions = options?.regions ?? Deno.env.get("ALPR_REGIONS") ?? "nz";
  const mmc = options?.mmc ?? (Deno.env.get("ALPR_MMC") === "true");
  const config = options?.config ?? Deno.env.get("ALPR_CONFIG") ?? '{"mode":"fast"}';
  const timeout = options?.timeout ?? Number(Deno.env.get("ALPR_TIMEOUT_MS") ?? 15000);

  if (!token) {
    console.error("❌ PLATERECOGNIZER_TOKEN not configured (and ALPR_PROVIDER != local)");
    return emptyResult();
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
      headers: { "Authorization": `Token ${token}` },
      body: formData,
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      const text = await response.text();
      console.error(`❌ ALPR API error ${response.status}:`, text);
      return emptyResult({ error: text, status: response.status });
    }

    const data = await response.json();

    if (data.results && data.results.length > 0) {
      const best = data.results[0];
      const plate = best.plate?.toUpperCase() ?? null;
      const confidence = best.score ?? null;

      const make = best?.vehicle?.make?.[0]?.name ?? best?.vehicle?.make ?? null;
      const makeConfidence = best?.vehicle?.make?.[0]?.score ?? null;
      const model = best?.vehicle?.model?.[0]?.name ?? best?.vehicle?.model ?? null;
      const modelConfidence = best?.vehicle?.model?.[0]?.score ?? null;
      const color = best?.vehicle?.color?.[0]?.name ?? best?.vehicle?.color ?? null;
      const colorConfidence = best?.vehicle?.color?.[0]?.score ?? null;
      const orientation = best?.vehicle?.orientation?.[0]?.name ?? best?.vehicle?.orientation ?? null;

      return {
        plate,
        confidence,
        make: make ? String(make) : null,
        model: model ? String(model) : null,
        color: color ? String(color) : null,
        orientation: orientation ? String(orientation) : null,
        makeConfidence: typeof makeConfidence === "number" ? makeConfidence : null,
        modelConfidence: typeof modelConfidence === "number" ? modelConfidence : null,
        colorConfidence: typeof colorConfidence === "number" ? colorConfidence : null,
        raw: data,
      };
    }

    console.warn("⚠️ ALPR: No plates detected");
    return emptyResult(data);
  } catch (error: any) {
    if (error.name === "AbortError") {
      console.error("❌ ALPR timeout after", timeout, "ms");
    } else {
      console.error("❌ ALPR error:", error.message);
    }
    return emptyResult({ error: error.message });
  }
}

/**
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
