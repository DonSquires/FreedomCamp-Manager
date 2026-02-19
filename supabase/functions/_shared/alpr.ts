// ============================================================================
// CENTRALIZED ALPR HELPER - Single source of truth for plate recognition
// ============================================================================
// Used by: plate-scanner-photo-first, recognize-plate
// Environment: PLATE_RECOGNIZER_API_KEY, ALPR_API_URL
// ============================================================================

export interface ALPRResult {
  plate: string | null;
  confidence: number | null;
  make: string | null;
  model: string | null;
  color: string | null;
  year: string | null;
  bodyStyle: string | null;
  raw: any;
}

/**
 * Detect license plate from photo bytes using Plate Recognizer API
 * 
 * @param photoBytes - Image data as Uint8Array (JPEG/PNG)
 * @returns ALPRResult with plate number and vehicle details
 */
export async function detectPlate(photoBytes: Uint8Array): Promise<ALPRResult> {
  const url = Deno.env.get('ALPR_API_URL') || 'https://api.platerecognizer.com/v1/plate-reader/';
  const key = Deno.env.get('PLATE_RECOGNIZER_API_KEY');
  
  if (!key) {
    console.error('❌ ALPR key missing - plate detection disabled');
    return { 
      plate: null, 
      confidence: null, 
      make: null, 
      model: null, 
      color: null, 
      year: null,
      bodyStyle: null,
      raw: null 
    };
  }

  console.log('📡 Calling ALPR:', { url, bytes: photoBytes.length });

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Token ${key}`,
        'Content-Type': 'application/octet-stream',
      },
      body: photoBytes,
      signal: AbortSignal.timeout(15000), // 15s timeout for cold starts
    });

    const text = await res.text();
    
    if (!res.ok) {
      console.error('❌ ALPR API error:', res.status, text.slice(0, 256));
      return { 
        plate: null, 
        confidence: null, 
        make: null, 
        model: null, 
        color: null, 
        year: null,
        bodyStyle: null,
        raw: text 
      };
    }

    const json = JSON.parse(text);
    console.log('📊 ALPR raw response:', JSON.stringify(json).slice(0, 500));

    // Extract best result
    const results = json?.results || [];
    if (results.length === 0) {
      console.warn('⚠️ ALPR returned no plates');
      return { 
        plate: null, 
        confidence: null, 
        make: null, 
        model: null, 
        color: null, 
        year: null,
        bodyStyle: null,
        raw: json 
      };
    }

    const best = results[0];
    const plate = best?.plate?.toUpperCase?.().replace(/[^A-Z0-9]/g, '') || null;
    const confidence = best?.score || null;
    
    // Extract vehicle details if available (MMC - Make/Model/Color)
    const makeModel = best?.model_make?.[0];
    const make = makeModel?.make || null;
    const model = makeModel?.model || null;
    const color = best?.color?.[0]?.color || null;
    const year = best?.year?.year_range?.[0] || null;
    const bodyStyle = best?.vehicle?.type || null;

    console.log(`✅ ALPR detected: ${plate} (confidence: ${confidence})`);
    if (make || model || color) {
      console.log(`📋 Vehicle details: ${make} ${model} ${color} ${year || ''} ${bodyStyle || ''}`);
    }

    return { plate, confidence, make, model, color, year, bodyStyle, raw: json };
  } catch (error: any) {
    console.error('❌ ALPR exception:', error.message);
    return { 
      plate: null, 
      confidence: null, 
      make: null, 
      model: null, 
      color: null, 
      year: null,
      bodyStyle: null,
      raw: null 
    };
  }
}

/**
 * Convert base64 data URL to Uint8Array
 * 
 * @param dataUrl - Base64 encoded image (data:image/jpeg;base64,...)
 * @returns Uint8Array of image bytes
 */
export function base64ToBytes(dataUrl: string): Uint8Array {
  const base64Data = dataUrl.replace(/^data:image\/\w+;base64,/, '');
  return Uint8Array.from(atob(base64Data), c => c.charCodeAt(0));
}

/**
 * Compute SHA-256 hash of bytes
 * 
 * @param bytes - Data to hash
 * @returns Hex string of SHA-256 hash
 */
export async function computeSHA256(bytes: Uint8Array): Promise<string> {
  const hashBuffer = await crypto.subtle.digest('SHA-256', bytes);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}
