/**
 * ALPR Process - ParkPow (Plate Recognizer) Integration
 * 
 * Processes images using ParkPow's Snapshot Cloud API
 * Configured for New Zealand plates
 * Returns plate number, vehicle details, and confidence scores
 */

import { corsHeaders } from '../_shared/cors.ts';

const PARKPOW_API_TOKEN = Deno.env.get('PARKPOW_API_TOKEN') || '23d201648202e77fd91611ebac9e5e6da5c63683';
const PARKPOW_API_URL = 'https://api.platerecognizer.com/v1/plate-reader/';

interface ALPRRequest {
  image: string; // base64 data URL
  regions?: string[]; // Country/state codes
  camera_id?: string;
  mmc?: boolean; // Vehicle Make, Model, Color
}

interface ALPRResponse {
  success: boolean;
  plate?: string;
  confidence?: number;
  region?: string;
  vehicle?: {
    type?: string;
    make?: string;
    model?: string;
    color?: string;
  };
  error?: string;
  raw_response?: any;
}

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { image, regions = ['nz'], camera_id, mmc = true }: ALPRRequest = await req.json();

    if (!image) {
      return new Response(
        JSON.stringify({ success: false, error: 'Image data required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('🔍 ParkPow ALPR Request:', {
      regions,
      camera_id,
      mmc,
      imagePrefix: image.substring(0, 50),
    });

    // Convert base64 data URL to blob
    const base64Data = image.split(',')[1] || image;
    const binaryData = Uint8Array.from(atob(base64Data), c => c.charCodeAt(0));
    const blob = new Blob([binaryData], { type: 'image/jpeg' });

    // Prepare multipart form data
    const formData = new FormData();
    formData.append('upload', blob, 'scan.jpg');
    
    // Add regions
    regions.forEach(region => {
      formData.append('regions', region);
    });

    // Add camera ID if provided
    if (camera_id) {
      formData.append('camera_id', camera_id);
    }

    // Enable Make/Model/Color recognition
    if (mmc) {
      formData.append('mmc', 'true');
    }

    // Configure for New Zealand and strict detection
    formData.append('config', JSON.stringify({
      region: 'strict', // Only accept valid NZ plate formats
      detection_rule: 'strict', // Must include a vehicle
    }));

    console.log('📡 Calling ParkPow API...');

    // Call ParkPow API
    const response = await fetch(PARKPOW_API_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Token ${PARKPOW_API_TOKEN}`,
      },
      body: formData,
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('❌ ParkPow API error:', response.status, errorText);
      
      return new Response(
        JSON.stringify({
          success: false,
          error: `ParkPow API error: ${response.status} - ${errorText}`,
        }),
        { status: response.status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const data = await response.json();
    console.log('📊 ParkPow response:', JSON.stringify(data, null, 2));

    // Parse response
    if (!data.results || data.results.length === 0) {
      console.log('⚠️ No plates detected');
      return new Response(
        JSON.stringify({
          success: false,
          error: 'No license plate detected in image',
          raw_response: data,
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Get first (best) result
    const result = data.results[0];

    // Extract vehicle details
    const vehicle: ALPRResponse['vehicle'] = {
      type: result.vehicle?.type || 'Unknown',
    };

    // Extract make/model/color if available (requires mmc=true)
    if (result.model_make && result.model_make.length > 0) {
      vehicle.make = result.model_make[0].make;
      vehicle.model = result.model_make[0].model;
    }

    if (result.color && result.color.length > 0) {
      vehicle.color = result.color[0].color;
    }

    const alprResponse: ALPRResponse = {
      success: true,
      plate: result.plate.toUpperCase(),
      confidence: result.score,
      region: result.region?.code || 'nz',
      vehicle,
      raw_response: data,
    };

    console.log('✅ ALPR Success:', {
      plate: alprResponse.plate,
      confidence: alprResponse.confidence,
      vehicle: alprResponse.vehicle,
    });

    return new Response(
      JSON.stringify(alprResponse),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: any) {
    console.error('❌ ALPR processing failed:', error);
    
    return new Response(
      JSON.stringify({
        success: false,
        error: error.message || 'Internal server error',
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
