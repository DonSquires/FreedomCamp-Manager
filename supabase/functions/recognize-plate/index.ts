/**
 * recognize-plate Edge Function - ALPR Service
 * ============================================================================
 * Purpose: Standalone ALPR detection service using Plate Recognizer API
 * 
 * Input: Base64 image (with or without data URL prefix)
 * Output: Standardized vehicle + plate data with confidence scores
 * 
 * Environment Variables Required:
 * - PLATE_RECOGNIZER_API_KEY (Supabase Secret)
 * 
 * Uses centralized ALPR helper from _shared/alpr.ts
 * ============================================================================
 */

import { corsHeaders } from '../_shared/cors.ts';
import { detectPlateFromBase64 } from '../_shared/alpr.ts';

interface RecognitionRequest {
  image: string; // Base64 encoded image
  regions?: string[]; // Optional regions (defaults to ['nz'])
  enableMMC?: boolean; // Enable Make/Model/Color (defaults to true)
}

interface RecognitionResponse {
  success: boolean;
  
  // Plate data
  plate_number?: string;
  confidence?: number;
  detection_confidence?: number;
  
  // Region data
  region_code?: string;
  region_confidence?: number;
  
  // Vehicle details (MMC)
  vehicle_make?: string;
  vehicle_model?: string;
  vehicle_color?: string;
  vehicle_year?: string;
  vehicle_body_style?: string;
  
  // Error handling
  error?: string;
  
  // Metadata
  processing_time?: number;
  timestamp?: string;
}

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { 
      status: 200, 
      headers: corsHeaders 
    });
  }

  const requestStartTime = Date.now();
  const timestamp = new Date().toISOString();

  console.log('🔍 recognize-plate: Request received', {
    method: req.method,
    contentType: req.headers.get('content-type'),
    timestamp,
  });

  try {
    // Parse request body
    let requestData: RecognitionRequest;
    
    try {
      requestData = await req.json();
    } catch (parseError) {
      console.error('❌ Failed to parse request body:', parseError);
      return new Response(
        JSON.stringify({
          success: false,
          error: 'Invalid JSON in request body',
        }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Validate required fields
    if (!requestData.image || typeof requestData.image !== 'string') {
      console.error('❌ Missing or invalid image data');
      return new Response(
        JSON.stringify({
          success: false,
          error: 'Missing or invalid image data',
        }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('📸 Image data received:', {
      imageLength: requestData.image.length,
      hasDataUrlPrefix: requestData.image.startsWith('data:'),
      regions: requestData.regions || ['nz'],
      enableMMC: requestData.enableMMC !== false,
    });

    // Call centralized ALPR helper
    const alprResult = await detectPlateFromBase64(requestData.image);

    const processingTime = Date.now() - requestStartTime;

    // Build standardized response
    const response: RecognitionResponse = {
      success: alprResult.success,
      processing_time: processingTime,
      timestamp,
    };

    if (alprResult.success && alprResult.plate) {
      // Success - plate detected
      response.plate_number = alprResult.plate;
      response.confidence = alprResult.confidence || undefined;
      response.detection_confidence = alprResult.detectionConfidence || undefined;
      response.region_code = alprResult.regionCode || undefined;
      response.region_confidence = alprResult.regionConfidence || undefined;
      
      // Add vehicle details if available
      if (alprResult.make) response.vehicle_make = alprResult.make;
      if (alprResult.model) response.vehicle_model = alprResult.model;
      if (alprResult.color) response.vehicle_color = alprResult.color;
      if (alprResult.year) response.vehicle_year = alprResult.year;
      if (alprResult.bodyStyle) response.vehicle_body_style = alprResult.bodyStyle;

      console.log('✅ recognize-plate: Success', {
        plate: response.plate_number,
        confidence: response.confidence,
        vehicle: `${response.vehicle_make || ''} ${response.vehicle_model || ''} ${response.vehicle_color || ''}`.trim() || 'Unknown',
        processingTime,
      });

      return new Response(
        JSON.stringify(response),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );

    } else {
      // Failure - no plate detected or error
      response.error = alprResult.error || 'No license plates detected';

      console.warn('⚠️ recognize-plate: No results', {
        error: response.error,
        processingTime,
      });

      return new Response(
        JSON.stringify(response),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

  } catch (error: any) {
    const processingTime = Date.now() - requestStartTime;
    
    console.error('❌ recognize-plate: Exception', {
      error: error.message,
      stack: error.stack?.slice(0, 500),
      processingTime,
    });

    return new Response(
      JSON.stringify({
        success: false,
        error: 'Plate recognition failed',
        message: error.message,
        processing_time: processingTime,
        timestamp,
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
