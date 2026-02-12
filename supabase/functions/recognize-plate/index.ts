/**
 * recognize-plate Edge Function - Unified Plate Recognition
 * Uses Plate Recognizer API exclusively - single source of truth
 * 
 * Handles:
 * - Camera captures (base64)
 * - File uploads (base64)
 * - Returns standardized vehicle + plate data
 */

import { corsHeaders } from '../_shared/cors.ts';

const PLATE_RECOGNIZER_API_KEY = '23d201648202e77fd91611ebac9e5e6da5c63683';
const PLATE_RECOGNIZER_URL = 'https://api.platerecognizer.com/v1/plate-reader/';

interface RecognitionRequest {
  image: string; // base64 encoded image
  regions?: string[]; // e.g., ['nz', 'au']
  cameraId?: string;
  timestamp?: string;
  enableMMC?: boolean; // Make/Model/Color detection
}

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  console.log('🔍 recognize-plate: Starting unified plate recognition');

  try {
    const requestData: RecognitionRequest = await req.json();

    if (!requestData.image) {
      return new Response(
        JSON.stringify({ error: 'Missing image data' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('📸 Image received, calling Plate Recognizer API...');

    // Prepare form data for Plate Recognizer API
    const formData = new FormData();
    
    // Add base64 image
    formData.append('upload', requestData.image);
    
    // Add regions if specified (defaults to NZ if not provided)
    const regions = requestData.regions || ['nz'];
    regions.forEach(region => {
      formData.append('regions', region);
    });
    
    // Add optional parameters
    if (requestData.cameraId) {
      formData.append('camera_id', requestData.cameraId);
    }
    
    if (requestData.timestamp) {
      formData.append('timestamp', requestData.timestamp);
    }
    
    // Enable MMC (Make/Model/Color) by default
    const enableMMC = requestData.enableMMC !== false; // Default to true
    if (enableMMC) {
      formData.append('mmc', 'true');
    }
    
    // Engine configuration for best NZ results
    formData.append('config', JSON.stringify({
      threshold_d: 0.5, // Lower detection threshold for better coverage
      threshold_o: 0.5, // Lower OCR threshold for better coverage
    }));

    console.log('⏳ Calling Plate Recognizer API with regions:', regions);

    // Call Plate Recognizer API
    const startTime = Date.now();
    const response = await fetch(PLATE_RECOGNIZER_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Token ${PLATE_RECOGNIZER_API_KEY}`,
      },
      body: formData,
    });

    const processingTime = Date.now() - startTime;
    console.log(`⏱️ Plate Recognizer API response in ${processingTime}ms`);

    if (!response.ok) {
      const errorText = await response.text();
      console.error('❌ Plate Recognizer API error:', response.status, errorText);
      
      return new Response(
        JSON.stringify({
          success: false,
          error: 'Plate Recognizer API error',
          status: response.status,
          details: errorText,
        }),
        { status: response.status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const apiResult = await response.json();
    console.log('✅ Plate Recognizer API response:', JSON.stringify(apiResult, null, 2));

    // Check if any plates were detected
    if (!apiResult.results || apiResult.results.length === 0) {
      console.warn('⚠️ No plates detected in image');
      return new Response(
        JSON.stringify({
          success: false,
          error: 'No license plates detected',
          processing_time: apiResult.processing_time,
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Get the best result (highest score)
    const bestResult = apiResult.results.reduce((best: any, current: any) => 
      (current.score > best.score) ? current : best
    );

    console.log('🏆 Best result:', {
      plate: bestResult.plate,
      score: bestResult.score,
      dscore: bestResult.dscore,
      region: bestResult.region?.code,
    });

    // Extract vehicle details
    const vehicleType = bestResult.vehicle?.type || null;
    const vehicleScore = bestResult.vehicle?.score || 0;

    // Extract MMC data if available
    const makeModel = bestResult.model_make?.[0];
    const color = bestResult.color?.[0];
    const orientation = bestResult.orientation?.[0];
    const year = bestResult.year;

    // Detect self-contained stickers (green/blue)
    // Note: Plate Recognizer doesn't detect stickers directly, we'd need custom logic
    // For now, we'll leave these as undefined and let the officer confirm

    // Build standardized response
    const standardizedResponse = {
      success: true,
      plate_number: bestResult.plate.toUpperCase().replace(/[^A-Z0-9]/g, ''),
      confidence: bestResult.score, // OCR confidence
      detection_confidence: bestResult.dscore, // Detection confidence
      
      // Region info
      region_code: bestResult.region?.code,
      region_confidence: bestResult.region?.score,
      
      // Vehicle details
      vehicle_type: vehicleType,
      vehicle_confidence: vehicleScore,
      
      // Make/Model/Color (if MMC enabled)
      vehicle_make: makeModel?.make,
      vehicle_model: makeModel?.model,
      vehicle_color: color?.color,
      vehicle_year: year?.year_range?.[0], // Use start of range
      vehicle_orientation: orientation?.orientation,
      
      // MMC confidence scores
      mmc_confidence: makeModel?.score,
      color_confidence: color?.score,
      orientation_confidence: orientation?.score,
      year_confidence: year?.score,
      
      // Sticker detection (to be confirmed by officer)
      has_green_sticker: undefined,
      has_blue_sticker: undefined,
      
      // Alternative candidates
      candidates: bestResult.candidates?.map((c: any) => ({
        plate: c.plate,
        score: c.score,
      })) || [],
      
      // Processing metadata
      processing_time: apiResult.processing_time,
      api_version: apiResult.version,
      timestamp: apiResult.timestamp,
    };

    console.log('✅ Standardized response ready:', {
      plate: standardizedResponse.plate_number,
      confidence: standardizedResponse.confidence,
      make: standardizedResponse.vehicle_make,
      model: standardizedResponse.vehicle_model,
      color: standardizedResponse.vehicle_color,
    });

    return new Response(
      JSON.stringify(standardizedResponse),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: any) {
    console.error('❌ recognize-plate error:', error);
    return new Response(
      JSON.stringify({
        success: false,
        error: 'Plate recognition failed',
        message: error.message,
        stack: error.stack,
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
