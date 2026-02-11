import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';
import { corsHeaders } from '../_shared/cors.ts';

const PLATE_RECOGNIZER_API_URL = 'https://api.platerecognizer.com/v1/plate-reader/';

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { image } = await req.json();

    if (!image) {
      return new Response(
        JSON.stringify({ error: 'Image data is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const apiKey = Deno.env.get('PLATE_RECOGNIZER_API_KEY');
    if (!apiKey) {
      console.error('PLATE_RECOGNIZER_API_KEY not configured');
      return new Response(
        JSON.stringify({ error: 'Plate Recognizer API not configured' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Prepare image data for Plate Recognizer
    // Support both base64 data URLs and raw base64
    let imageData = image;
    if (image.startsWith('data:image')) {
      // Extract base64 from data URL
      imageData = image.split(',')[1];
    }

    // Convert base64 to blob
    const binaryString = atob(imageData);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    const blob = new Blob([bytes], { type: 'image/jpeg' });

    // Create form data
    const formData = new FormData();
    formData.append('upload', blob, 'image.jpg');
    formData.append('regions', 'nz'); // New Zealand plates
    formData.append('camera_id', 'freedomcamp-patrol');

    console.log('📸 Calling Plate Recognizer API...');
    console.log('🔑 API Key configured:', apiKey ? `${apiKey.substring(0, 10)}...` : 'MISSING');
    console.log('📦 Image size:', blob.size, 'bytes');

    // Call Plate Recognizer API
    const response = await fetch(PLATE_RECOGNIZER_API_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Token ${apiKey}`,
      },
      body: formData,
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('❌ Plate Recognizer API error:', response.status, errorText);
      console.error('🔍 Request URL:', PLATE_RECOGNIZER_API_URL);
      console.error('📋 Response headers:', Object.fromEntries(response.headers.entries()));
      
      return new Response(
        JSON.stringify({ 
          success: false,
          error: `Plate Recognizer API error: ${response.status}`,
          details: errorText,
          message: `Plate Recognizer failed with status ${response.status}`,
          confidence: 0
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const data = await response.json();
    console.log('✅ Plate Recognizer API success!');
    console.log('📊 Results count:', data.results?.length || 0);
    console.log('🔍 Full response:', JSON.stringify(data, null, 2));

    // Extract results
    const results = data.results || [];
    
    if (results.length === 0) {
      return new Response(
        JSON.stringify({
          success: false,
          message: 'No license plates detected in image',
          confidence: 0,
          raw_response: data,
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Get the best result (highest confidence)
    const bestResult = results.reduce((prev: any, current: any) => 
      (current.score > prev.score) ? current : prev
    );

    // Extract plate number and vehicle details
    const region = bestResult.region || {};
    const vehicle = bestResult.vehicle || {};

    // STEP 2: Use OnSpace AI to detect self-contained stickers
    console.log('🔍 Detecting self-contained stickers with AI...');
    let stickerData = {
      has_green_sticker: false,
      has_blue_sticker: false,
    };

    try {
      const aiBaseUrl = Deno.env.get('ONSPACE_AI_BASE_URL');
      const aiApiKey = Deno.env.get('ONSPACE_AI_API_KEY');

      if (aiBaseUrl && aiApiKey) {
        const aiResponse = await fetch(`${aiBaseUrl}/chat/completions`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${aiApiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: 'google/gemini-3-flash-preview',
            messages: [
              {
                role: 'user',
                content: [
                  {
                    type: 'text',
                    text: `CRITICAL TASK: Search this ENTIRE vehicle very carefully for self-contained certification stickers.

🔍 STICKER TYPES TO FIND:
1. GREEN rectangular sticker with white text "SELF CONTAINED" = Certified
2. BLUE rectangular sticker with white text "SELF CONTAINED" and "Certified self contained to NZS 5465" = Certified

📍 WHERE TO LOOK (check ALL locations):
- Front windshield (top, bottom, left, right corners)
- Rear window/tailgate (top, bottom, left, right)
- Side windows (driver, passenger)
- Body panels near windows
- Door areas
- ANY visible surface on the vehicle

⚠️ IMPORTANT:
- Stickers are usually small (5-15cm wide)
- Can be on FRONT, REAR, or SIDES of vehicle
- Green/blue color is distinctive against white/gray vehicle body
- May be partially visible or at an angle
- Search the ENTIRE visible vehicle surface, not just one area

✅ Be THOROUGH - scan every part of the vehicle before answering!

Respond ONLY with JSON (no markdown):
{
  "has_green_sticker": true/false,
  "has_blue_sticker": true/false
}`,
                  },
                  {
                    type: 'image_url',
                    image_url: { url: image },
                  },
                ],
              },
            ],
            max_tokens: 100,
            temperature: 0.0,
          }),
        });

        if (aiResponse.ok) {
          const aiData = await aiResponse.json();
          const aiText = aiData.choices?.[0]?.message?.content?.trim() || '';
          console.log('🤖 AI sticker detection:', aiText);

          try {
            const jsonMatch = aiText.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
              const parsed = JSON.parse(jsonMatch[0]);
              stickerData.has_green_sticker = parsed.has_green_sticker || false;
              stickerData.has_blue_sticker = parsed.has_blue_sticker || false;
            }
          } catch (e) {
            // Fallback keyword detection
            if (/green.*sticker.*true|has_green_sticker.*true/i.test(aiText)) {
              stickerData.has_green_sticker = true;
            }
            if (/blue.*sticker.*true|has_blue_sticker.*true/i.test(aiText)) {
              stickerData.has_blue_sticker = true;
            }
          }

          if (stickerData.has_green_sticker || stickerData.has_blue_sticker) {
            console.log('✅ Self-contained sticker detected:', stickerData);
          }
        }
      }
    } catch (aiError) {
      console.error('AI sticker detection failed:', aiError);
      // Continue without sticker detection
    }

    // STEP 3: AI fallback for vehicle details if ALPR didn't detect them
    let aiVehicleData = {
      make: vehicle.make || null,
      model: vehicle.model || null,
      year: vehicle.year?.toString() || null,
      color: vehicle.color || null,
    };

    // If ALPR didn't get vehicle details, try AI
    if (!aiVehicleData.make || !aiVehicleData.model || !aiVehicleData.color) {
      console.log('🤖 ALPR missing vehicle details, trying AI fallback...');
      
      try {
        const aiBaseUrl = Deno.env.get('ONSPACE_AI_BASE_URL');
        const aiApiKey = Deno.env.get('ONSPACE_AI_API_KEY');

        if (aiBaseUrl && aiApiKey) {
          const aiResponse = await fetch(`${aiBaseUrl}/chat/completions`, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${aiApiKey}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              model: 'google/gemini-3-flash-preview',
              messages: [
                {
                  role: 'user',
                  content: [
                    {
                      type: 'text',
                      text: `Analyze this vehicle image and extract:
1. Make (brand/manufacturer)
2. Model (specific model name)
3. Year (approximate year or decade if unsure)
4. Color (primary exterior color)

Be specific and accurate. If you cannot determine a field with confidence, return null.

Respond ONLY with JSON (no markdown):
{
  "make": "Toyota" or null,
  "model": "Camry" or null,
  "year": "2018" or null,
  "color": "Silver" or null
}`,
                    },
                    {
                      type: 'image_url',
                      image_url: { url: image },
                    },
                  ],
                },
              ],
              max_tokens: 150,
              temperature: 0.1,
            }),
          });

          if (aiResponse.ok) {
            const aiData = await aiResponse.json();
            const aiText = aiData.choices?.[0]?.message?.content?.trim() || '';
            console.log('🤖 AI vehicle details:', aiText);

            try {
              const jsonMatch = aiText.match(/\{[\s\S]*\}/);
              if (jsonMatch) {
                const parsed = JSON.parse(jsonMatch[0]);
                // Only use AI data if ALPR didn't provide it
                aiVehicleData.make = aiVehicleData.make || parsed.make;
                aiVehicleData.model = aiVehicleData.model || parsed.model;
                aiVehicleData.year = aiVehicleData.year || parsed.year;
                aiVehicleData.color = aiVehicleData.color || parsed.color;
                console.log('✅ AI fallback enriched vehicle details:', aiVehicleData);
              }
            } catch (parseError) {
              console.warn('Failed to parse AI vehicle response:', parseError);
            }
          }
        }
      } catch (aiError) {
        console.error('AI vehicle detection failed:', aiError);
        // Continue without AI enrichment
      }
    }

    const extractedData = {
      success: true,
      plate_number: bestResult.plate?.toUpperCase() || '',
      confidence: bestResult.score || 0,
      region_code: region.code || '',
      region_score: region.score || 0,
      // Self-contained sticker detection
      has_green_sticker: stickerData.has_green_sticker,
      has_blue_sticker: stickerData.has_blue_sticker,
      // Vehicle details from ALPR or AI fallback
      vehicle_make: aiVehicleData.make,
      vehicle_model: aiVehicleData.model,
      vehicle_year: aiVehicleData.year,
      vehicle_color: aiVehicleData.color,
      // Metadata
      processing_time: data.processing_time || 0,
      timestamp: data.timestamp || new Date().toISOString(),
      camera_id: data.camera_id || '',
      all_results: results.map((r: any) => ({
        plate: r.plate,
        score: r.score,
        region: r.region?.code,
      })),
      raw_response: data,
    };

    console.log('📊 Extracted data:', JSON.stringify(extractedData, null, 2));

    return new Response(
      JSON.stringify(extractedData),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: any) {
    console.error('❌ Plate recognition error:', error);
    return new Response(
      JSON.stringify({ 
        error: 'Failed to process image',
        message: error.message || 'Unknown error',
        stack: error.stack,
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
