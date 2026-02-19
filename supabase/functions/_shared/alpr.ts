// ============================================================================
// CENTRALIZED ALPR HELPER - Plate Recognizer API Integration
// ============================================================================
// Single source of truth for all ALPR operations
// Environment variables required:
// - PLATE_RECOGNIZER_API_KEY (required)
// - ALPR_API_URL (optional, defaults to Plate Recognizer Cloud)
// ============================================================================

export interface ALPRResult {
  success: boolean;
  plate: string | null;
  confidence: number | null;
  
  // Vehicle details from MMC
  make: string | null;
  model: string | null;
  color: string | null;
  year: string | null;
  bodyStyle: string | null;
  
  // Additional metadata
  regionCode: string | null;
  regionConfidence: number | null;
  detectionConfidence: number | null;
  
  // Raw response for debugging
  raw: any;
  error?: string;
}

interface PlateRecognizerConfig {
  apiKey: string;
  apiUrl: string;
  regions: string[];
  enableMMC: boolean;
  timeoutMs: number;
}

/**
 * Get ALPR configuration from environment variables
 */
function getConfig(): PlateRecognizerConfig {
  const apiKey = Deno.env.get('PLATE_RECOGNIZER_API_KEY');
  
  if (!apiKey || apiKey.trim() === '') {
    throw new Error('PLATE_RECOGNIZER_API_KEY not configured in Supabase Secrets');
  }

  return {
    apiKey: apiKey.trim(),
    apiUrl: Deno.env.get('ALPR_API_URL') || 'https://api.platerecognizer.com/v1/plate-reader/',
    regions: ['nz'], // Default to New Zealand
    enableMMC: true, // Always enable Make/Model/Color detection
    timeoutMs: 15000, // 15 second timeout
  };
}

/**
 * Convert base64 data URL to Uint8Array
 */
export function base64ToBytes(dataUrl: string): Uint8Array {
  try {
    // Remove data URL prefix if present
    const base64Data = dataUrl.replace(/^data:image\/\w+;base64,/, '');
    
    // Decode base64 to binary
    const binaryString = atob(base64Data);
    
    // Convert to Uint8Array
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
 * Compute SHA-256 hash of bytes
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

/**
 * Detect license plate from image bytes using Plate Recognizer API
 * 
 * @param photoBytes - Image data as Uint8Array (JPEG/PNG)
 * @param options - Optional configuration overrides
 * @returns ALPRResult with plate number and vehicle details
 */
export async function detectPlate(
  photoBytes: Uint8Array,
  options?: Partial<PlateRecognizerConfig>
): Promise<ALPRResult> {
  const startTime = Date.now();
  
  try {
    // Get configuration
    const config = { ...getConfig(), ...options };
    
    console.log('📡 ALPR Request:', {
      url: config.apiUrl,
      imageSize: photoBytes.length,
      regions: config.regions,
      mmc: config.enableMMC,
      timeout: config.timeoutMs,
    });

    // Prepare form data
    const formData = new FormData();
    
    // Add image as blob
    const blob = new Blob([photoBytes], { type: 'image/jpeg' });
    formData.append('upload', blob, 'image.jpg');
    
    // Add regions
    config.regions.forEach(region => {
      formData.append('regions', region);
    });
    
    // Enable MMC (Make/Model/Color)
    if (config.enableMMC) {
      formData.append('mmc', 'true');
    }
    
    // Engine configuration for better NZ results
    formData.append('config', JSON.stringify({
      threshold_d: 0.5, // Detection threshold
      threshold_o: 0.5, // OCR threshold
    }));

    // Call Plate Recognizer API
    const response = await fetch(config.apiUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Token ${config.apiKey}`,
      },
      body: formData,
      signal: AbortSignal.timeout(config.timeoutMs),
    });

    const processingTime = Date.now() - startTime;
    
    // Read response text
    const responseText = await response.text();
    
    // Check for HTTP errors
    if (!response.ok) {
      console.error('❌ ALPR API Error:', {
        status: response.status,
        statusText: response.statusText,
        response: responseText.slice(0, 500),
        processingTime,
      });
      
      return {
        success: false,
        plate: null,
        confidence: null,
        make: null,
        model: null,
        color: null,
        year: null,
        bodyStyle: null,
        regionCode: null,
        regionConfidence: null,
        detectionConfidence: null,
        raw: null,
        error: `API Error ${response.status}: ${responseText}`,
      };
    }

    // Parse JSON response
    let apiResult: any;
    try {
      apiResult = JSON.parse(responseText);
    } catch (parseError) {
      console.error('❌ Failed to parse ALPR response:', parseError);
      return {
        success: false,
        plate: null,
        confidence: null,
        make: null,
        model: null,
        color: null,
        year: null,
        bodyStyle: null,
        regionCode: null,
        regionConfidence: null,
        detectionConfidence: null,
        raw: responseText,
        error: 'Failed to parse API response',
      };
    }

    console.log('📊 ALPR Response:', {
      processingTime,
      resultsCount: apiResult.results?.length || 0,
      apiProcessingTime: apiResult.processing_time,
    });

    // Check if any plates were detected
    if (!apiResult.results || apiResult.results.length === 0) {
      console.warn('⚠️ No plates detected in image');
      return {
        success: false,
        plate: null,
        confidence: null,
        make: null,
        model: null,
        color: null,
        year: null,
        bodyStyle: null,
        regionCode: null,
        regionConfidence: null,
        detectionConfidence: null,
        raw: apiResult,
        error: 'No license plates detected',
      };
    }

    // Get the best result (highest confidence)
    const bestResult = apiResult.results.reduce((best: any, current: any) => 
      (current.score > best.score) ? current : best
    );

    // Extract plate number (normalized)
    const plate = bestResult.plate?.toUpperCase?.().replace(/[^A-Z0-9]/g, '') || null;
    const confidence = bestResult.score || null;
    const detectionConfidence = bestResult.dscore || null;

    // Extract region info
    const regionCode = bestResult.region?.code || null;
    const regionConfidence = bestResult.region?.score || null;

    // Extract vehicle details from MMC
    const makeModel = bestResult.model_make?.[0];
    const make = makeModel?.make || null;
    const model = makeModel?.model || null;
    
    const colorData = bestResult.color?.[0];
    const color = colorData?.color || null;
    
    const yearData = bestResult.year;
    const year = yearData?.year_range?.[0] || null;
    
    const vehicleData = bestResult.vehicle;
    const bodyStyle = vehicleData?.type || null;

    console.log('✅ ALPR Success:', {
      plate,
      confidence: confidence ? `${(confidence * 100).toFixed(1)}%` : 'N/A',
      detectionConfidence: detectionConfidence ? `${(detectionConfidence * 100).toFixed(1)}%` : 'N/A',
      region: regionCode,
      vehicle: `${make || '?'} ${model || '?'} ${color || '?'} ${year || '?'}`.trim(),
      processingTime,
    });

    return {
      success: true,
      plate,
      confidence,
      make,
      model,
      color,
      year,
      bodyStyle,
      regionCode,
      regionConfidence,
      detectionConfidence,
      raw: apiResult,
    };

  } catch (error: any) {
    const processingTime = Date.now() - startTime;
    
    console.error('❌ ALPR Exception:', {
      error: error.message,
      type: error.name,
      processingTime,
    });

    return {
      success: false,
      plate: null,
      confidence: null,
      make: null,
      model: null,
      color: null,
      year: null,
      bodyStyle: null,
      regionCode: null,
      regionConfidence: null,
      detectionConfidence: null,
      raw: null,
      error: error.message || 'Unknown error',
    };
  }
}

/**
 * Detect plate from base64 image string
 * 
 * @param base64Image - Base64 encoded image (with or without data URL prefix)
 * @returns ALPRResult
 */
export async function detectPlateFromBase64(base64Image: string): Promise<ALPRResult> {
  try {
    const photoBytes = base64ToBytes(base64Image);
    return await detectPlate(photoBytes);
  } catch (error: any) {
    console.error('❌ Base64 ALPR failed:', error);
    return {
      success: false,
      plate: null,
      confidence: null,
      make: null,
      model: null,
      color: null,
      year: null,
      bodyStyle: null,
      regionCode: null,
      regionConfidence: null,
      detectionConfidence: null,
      raw: null,
      error: error.message || 'Failed to process base64 image',
    };
  }
}
