// ============================================================================
// ALPR HELPER - Plate Recognizer Cloud API (Production-Ready, Cloud-Only)
// ============================================================================
// Official API: https://docs.platerecognizer.com
// Endpoint: https://api.platerecognizer.com/v1/plate-reader/
// Auth: Token <API_TOKEN>
//
// Supports:
// - Multipart uploads (@file via bytes)
// - Base64 uploads (string)
// - NZ region configuration
// - MMC (Make/Model/Color/Year/Orientation)
// - Direction detection
// - Robust error handling and logging
// ============================================================================

type AlprResult = { 
  plate: string | null; 
  confidence: number | null; 
  raw: any 
};

/**
 * Get environment variable with optional fallback
 */
function env(name: string, fallback?: string): string | undefined {
  const v = Deno.env.get(name);
  return (v === undefined || v === null || v === '') ? fallback : v;
}

// ============================================================================
// ENVIRONMENT CONFIGURATION (Supabase Secrets)
// ============================================================================
const ALPR_CLOUD_URL = env('ALPR_CLOUD_URL', 'https://api.platerecognizer.com/v1/plate-reader/');
const TOKEN = env('PLATE_RECOGNIZER_TOKEN')!;
const REGIONS = (env('ALPR_REGIONS', 'nz') || 'nz').split(',').map(s => s.trim()).filter(Boolean);
const MMC = env('ALPR_MMC', 'false') === 'true';
const CONFIG_STR = env('ALPR_CONFIG', ''); // JSON string like {"mode":"fast"}
const TIMEOUT_MS = parseInt(env('ALPR_TIMEOUT_MS', '15000')!, 10);

if (!TOKEN) {
  throw new Error('❌ PLATE_RECOGNIZER_TOKEN is not set in Supabase Secrets');
}

console.log('🔧 ALPR Config:', {
  endpoint: ALPR_CLOUD_URL,
  regions: REGIONS,
  mmc: MMC,
  timeout: `${TIMEOUT_MS}ms`,
  hasConfig: !!CONFIG_STR,
});

/**
 * Extract best plate candidate from API response
 */
function pickBest(resp: any): { plate: string | null; confidence: number | null } {
  const r = resp?.results;
  if (!Array.isArray(r) || r.length === 0) {
    return { plate: null, confidence: null };
  }

  const top = r[0];
  
  // Try candidates array first (best OCR results)
  if (Array.isArray(top?.candidates) && top.candidates.length > 0) {
    const best = top.candidates[0];
    return {
      plate: (best?.plate || top?.plate || '').toUpperCase() || null,
      confidence: (typeof best?.score === 'number') ? best.score :
                  (typeof top?.score === 'number' ? top.score : null)
    };
  }

  // Fall back to direct plate field
  return {
    plate: (top?.plate || '').toUpperCase() || null,
    confidence: (typeof top?.score === 'number') ? top?.score : null
  };
}

/**
 * Safe JSON parse with fallback to raw text
 */
function tryParse(text: string): any {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

/**
 * Build multipart form data with configured parameters
 */
function buildForm(): FormData {
  const form = new FormData();
  
  // 1. Set region(s) - NZ by default
  REGIONS.forEach(r => form.append('regions', r));
  
  // 2. Enable MMC if configured (Make/Model/Color/Year/Orientation)
  if (MMC) {
    form.append('mmc', 'true');
  }
  
  // 3. Add optional engine config (e.g., {"mode":"fast"})
  if (CONFIG_STR) {
    form.append('config', CONFIG_STR);
  }
  
  return form;
}

/**
 * POST form data to Plate Recognizer API with timeout
 */
async function postForm(form: FormData): Promise<AlprResult> {
  try {
    const res = await fetch(ALPR_CLOUD_URL!, {
      method: 'POST',
      headers: {
        'Authorization': `Token ${TOKEN}`,
      },
      body: form,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    const text = await res.text();
    
    if (!res.ok) {
      console.error('❌ ALPR Cloud Error:', {
        status: res.status,
        statusText: res.statusText,
        response: text.slice(0, 512),
      });
      
      // Standardized error messages
      let errorMessage = text;
      if (res.status === 401) {
        errorMessage = '401: Invalid API token or expired subscription';
      } else if (res.status === 403) {
        errorMessage = '403: Insufficient credits or invalid API key';
      } else if (res.status === 413) {
        errorMessage = '413: Image too large (max 10MB)';
      } else if (res.status === 415) {
        errorMessage = '415: Unsupported image format (use JPEG/PNG)';
      } else if (res.status === 422) {
        errorMessage = '422: Invalid request parameters';
      } else if (res.status === 429) {
        errorMessage = '429: Rate limit exceeded (Free: 1/sec, Paid: 8/sec)';
      }
      
      return { 
        plate: null, 
        confidence: null, 
        raw: { error: errorMessage, status: res.status, body: tryParse(text) }
      };
    }

    const json = tryParse(text);
    const { plate, confidence } = pickBest(json);
    
    if (plate) {
      console.log('✅ ALPR Plate:', plate, 'confidence:', confidence);
    } else {
      console.warn('⚠️ ALPR: No plate candidates in response');
    }
    
    return { plate, confidence: confidence ?? null, raw: json };

  } catch (error: any) {
    console.error('❌ ALPR Request Failed:', error.message);
    
    let errorMessage = error.message || 'Unknown error';
    if (error.name === 'TimeoutError' || error.name === 'AbortError') {
      errorMessage = `Timeout after ${TIMEOUT_MS}ms - API did not respond in time`;
    }
    
    return { 
      plate: null, 
      confidence: null, 
      raw: { error: errorMessage, type: error.name }
    };
  }
}

// ============================================================================
// PUBLIC API
// ============================================================================

/**
 * Detect plate from image bytes (multipart upload - RECOMMENDED)
 * 
 * @param bytes - Image data as Uint8Array (JPEG/PNG)
 * @returns AlprResult with plate number and confidence
 */
export async function alprWithBytes(bytes: Uint8Array): Promise<AlprResult> {
  const form = buildForm();
  const file = new File([bytes], 'upload.jpg', { type: 'image/jpeg' });
  form.append('upload', file); // Multipart @file upload
  
  console.log('📤 ALPR Upload (bytes):', { size: `${(bytes.length / 1024).toFixed(1)} KB` });
  return postForm(form);
}

/**
 * Detect plate from base64 data URL (base64 upload)
 * 
 * @param dataUrl - Base64 encoded image (with or without data URL prefix)
 * @returns AlprResult with plate number and confidence
 */
export async function alprWithDataUrl(dataUrl: string): Promise<AlprResult> {
  const form = buildForm();
  
  // Strip data URL prefix if present
  const base64 = dataUrl.includes(',') ? dataUrl.split(',')[1] : dataUrl;
  
  // Plate Recognizer accepts base64 directly in 'upload' field
  form.append('upload', base64);
  
  console.log('📤 ALPR Upload (base64):', { size: `${(base64.length / 1024).toFixed(1)} KB` });
  return postForm(form);
}

// ============================================================================
// LEGACY COMPATIBILITY (for existing code)
// ============================================================================

/**
 * DEPRECATED: Use alprWithBytes() instead
 * Kept for backward compatibility with existing code
 */
export async function detectPlate(photoBytes: Uint8Array): Promise<any> {
  const result = await alprWithBytes(photoBytes);
  
  // Convert to legacy format
  return {
    success: result.plate !== null,
    plate: result.plate,
    confidence: result.confidence,
    make: null,
    model: null,
    color: null,
    year: null,
    bodyStyle: null,
    orientation: null,
    direction: null,
    regionCode: null,
    regionConfidence: null,
    detectionConfidence: null,
    raw: result.raw,
    error: result.plate === null ? 'No plate detected' : undefined,
  };
}

/**
 * DEPRECATED: Use alprWithDataUrl() instead
 * Kept for backward compatibility with existing code
 */
export async function detectPlateFromBase64(base64Image: string): Promise<any> {
  const result = await alprWithDataUrl(base64Image);
  
  // Convert to legacy format
  return {
    success: result.plate !== null,
    plate: result.plate,
    confidence: result.confidence,
    make: null,
    model: null,
    color: null,
    year: null,
    bodyStyle: null,
    orientation: null,
    direction: null,
    regionCode: null,
    regionConfidence: null,
    detectionConfidence: null,
    raw: result.raw,
    error: result.plate === null ? 'No plate detected' : undefined,
  };
}

/**
 * Utility: Convert base64 data URL to Uint8Array
 */
export function base64ToBytes(dataUrl: string): Uint8Array {
  try {
    const base64Data = dataUrl.replace(/^data:image\/\w+;base64,/, '');
    const binaryString = atob(base64Data);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    return bytes;
  } catch (error) {
    console.error('❌ Base64 decode failed:', error);
    throw new Error('Failed to decode base64 image');
  }
}

/**
 * Utility: Compute SHA-256 hash of bytes
 */
export async function computeSHA256(bytes: Uint8Array): Promise<string> {
  try {
    const hashBuffer = await crypto.subtle.digest('SHA-256', bytes);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  } catch (error) {
    console.error('❌ SHA-256 computation failed:', error);
    throw new Error('Failed to compute image hash');
  }
}

// ============================================================================
// CONFIGURATION NOTES
// ============================================================================
//
// Environment Variables (Supabase Secrets):
// - PLATE_RECOGNIZER_TOKEN (required) - API token from ParkPow/Plate Recognizer
// - ALPR_CLOUD_URL (optional) - Default: https://api.platerecognizer.com/v1/plate-reader/
// - ALPR_REGIONS (optional) - Default: nz (comma-separated: nz,au,us-ca)
// - ALPR_MMC (optional) - Default: false (set to 'true' to enable Make/Model/Color)
// - ALPR_CONFIG (optional) - JSON string like {"mode":"fast"} for engine tuning
// - ALPR_TIMEOUT_MS (optional) - Default: 15000 (15 seconds)
//
// Rate Limits:
// - Free Trial: 1 call/sec
// - Paid Plan: 8 calls/sec
//
// Error Codes:
// - 401: Invalid/expired token
// - 403: Insufficient credits
// - 413: Image too large (>10MB)
// - 415: Unsupported format (use JPEG/PNG)
// - 422: Invalid parameters
// - 429: Rate limit exceeded
// - 408: Timeout (slow API or large image)
//
// ============================================================================
