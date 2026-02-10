import { corsHeaders } from '../_shared/cors.ts';

Deno.serve(async (req) => {
  // Handle CORS preflight request
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { image } = await req.json();

    if (!image) {
      return new Response(
        JSON.stringify({ error: 'Image is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const baseUrl = Deno.env.get('ONSPACE_AI_BASE_URL');
    const apiKey = Deno.env.get('ONSPACE_AI_API_KEY');

    if (!baseUrl || !apiKey) {
      throw new Error('OnSpace AI credentials not configured');
    }

    console.log('🔍 Starting OCR + AI hybrid analysis...');

    // STEP 1: OCR-focused text extraction (primary method)
    console.log('📝 Step 1: OCR text extraction...');
    const ocrResponse = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
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
                text: `You are an OCR (Optical Character Recognition) system specialized in reading license plates.

Your ONLY task: Extract the license plate text from this image.

Instructions:
- Look at the bumper/grille area for a rectangular plate
- New Zealand plates: 3-7 alphanumeric characters (e.g., ABC123, KGNZ38, XYZ789)
- Characters are BLACK on WHITE or YELLOW background
- Read EVERY visible character exactly as shown
- Ignore rotation, angle, or perspective - just read the text

Respond with ONLY the plate characters, nothing else. Examples:
- If you see "KGNZ38" → respond: KGNZ38
- If you see "ABC123" → respond: ABC123
- If no plate visible → respond: NONE

Your response (plate text only):`,
              },
              {
                type: 'image_url',
                image_url: {
                  url: image,
                },
              },
            ],
          },
        ],
        max_tokens: 20,
        temperature: 0.0,
      }),
    });

    if (!ocrResponse.ok) {
      const status = ocrResponse.status;
      if (status === 402) {
        throw new Error('AI service quota exhausted. Contact support to add credits.');
      } else if (status === 401) {
        throw new Error('AI service authentication failed. Check API credentials.');
      } else if (status === 429) {
        throw new Error('Too many requests. Please wait a moment and try again.');
      }
      throw new Error(`OCR request failed: ${status}`);
    }

    const ocrData = await ocrResponse.json();
    const ocrText = ocrData.choices?.[0]?.message?.content?.trim() || '';
    console.log('📝 OCR extracted:', ocrText);

    // STEP 2: AI vehicle analysis (secondary - for stickers/type/details)
    console.log('🤖 Step 2: AI vehicle analysis with sticker detection...');
    const aiResponse = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
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
                text: `🚨 CRITICAL ANALYSIS TASK - Examine this vehicle image VERY THOROUGHLY:

⭐ PRIORITY #1 - SELF-CONTAINED STICKER DETECTION (SEARCH ENTIRE VEHICLE):

🔍 WHAT TO FIND:
   - GREEN rectangular sticker with white text "SELF CONTAINED" = Certified vehicle
   - BLUE rectangular sticker with white text "SELF CONTAINED" + "Certified self contained to NZS 5465" = Certified vehicle

📍 WHERE TO SEARCH (check EVERY location):
   ✓ Front windshield - top, bottom, left corner, right corner
   ✓ Rear window/tailgate - top, bottom, left, right
   ✓ Side windows - driver side, passenger side
   ✓ Body panels - near any window or door
   ✓ ANY visible surface on the vehicle

⚠️ STICKER CHARACTERISTICS:
   - Size: Usually 5-15cm wide (small but visible)
   - Shape: Rectangular or square
   - Color: Bright GREEN or BLUE (stands out against vehicle body)
   - Text: Bold white letters "SELF CONTAINED"
   - Location: Can be on FRONT, REAR, SIDES - anywhere on vehicle
   - May be partially visible, at an angle, or in shadows

⚡ SEARCH STRATEGY:
   1. Scan the ENTIRE vehicle surface from edge to edge
   2. Look at ALL windows (front, rear, sides)
   3. Check body panels near windows
   4. Look for small green or blue colored rectangular shapes
   5. Don't focus only on one area - stickers can be ANYWHERE

📋 ALSO IDENTIFY:
   - Vehicle Make (Toyota, Ford, Mazda, Holden, etc.)
   - Model (Hilux, Ranger, Colorado, etc.)
   - Year (estimate: 2010, 2015, 2020 - or "unknown")
   - Color (Red, White, Silver, Black, etc.)
   - Type (car, van, campervan, motorhome, truck, SUV, ute)
   - Likely self-contained? (has RV/campervan features: toilet, water, waste tanks)

✅ Take your time and scan every visible part of the vehicle before answering!

Return ONLY JSON (no markdown):
{
  "has_green_sticker": true/false,
  "has_blue_sticker": true/false,
  "vehicle_make": "Toyota",
  "vehicle_model": "Hilux",
  "vehicle_year": "2015",
  "vehicle_color": "Red",
  "vehicle_type": "truck",
  "likely_self_contained": false
}`,
              },
              {
                type: 'image_url',
                image_url: {
                  url: image,
                },
              },
            ],
          },
        ],
        max_tokens: 300,
        temperature: 0.0,
      }),
    });

    if (!aiResponse.ok) {
      const status = aiResponse.status;
      console.warn(`AI analysis failed (${status}), continuing with OCR only`);
    }

    const aiData = await aiResponse.json();
    const aiText = aiData.choices?.[0]?.message?.content?.trim() || '';

    console.log('🤖 AI analysis:', aiText);

    // STEP 3: Process OCR result (primary)
    let plateNumber: string | null = null;
    
    // Clean and validate OCR text
    if (ocrText && ocrText !== 'NONE' && ocrText !== 'null') {
      const cleanedOCR = ocrText
        .replace(/[^A-Z0-9]/gi, '')
        .toUpperCase();
      
      // Validate NZ plate format (3-7 characters)
      if (cleanedOCR.length >= 3 && cleanedOCR.length <= 7) {
        plateNumber = cleanedOCR;
        console.log('✅ OCR SUCCESS:', plateNumber);
      } else {
        console.warn('⚠️ OCR result invalid length:', cleanedOCR);
      }
    }

    // STEP 4: Fallback - aggressive text extraction from OCR response
    if (!plateNumber) {
      console.log('🔄 Fallback: Extracting from OCR response...');
      const platePatterns = [
        /([A-Z]{2,4}[\s-]?[0-9]{2,4})/gi,  // ABC123, AB1234
        /([A-Z]{3,6}[0-9]{2})/gi,           // KGNZ38, KONZ88
        /([0-9]{1,3}[A-Z]{2,4})/gi,         // 1ABC, 12XYZ
        /([A-Z]{4,7})/gi,                   // CUSTOM plates
      ];
      
      for (const pattern of platePatterns) {
        const match = ocrText.match(pattern);
        if (match && match[0]) {
          const cleaned = match[0].replace(/[\s-]/g, '').toUpperCase();
          if (cleaned.length >= 3 && cleaned.length <= 7) {
            plateNumber = cleaned;
            console.log('✅ Fallback extracted:', plateNumber);
            break;
          }
        }
      }
    }

    // STEP 5: Parse AI analysis for stickers/vehicle details
    let analysisResult: any = {
      has_green_sticker: false,
      has_blue_sticker: false,
      vehicle_make: null,
      vehicle_model: null,
      vehicle_year: null,
      vehicle_color: null,
      vehicle_type: 'unknown',
      likely_self_contained: false,
    };

    try {
      const jsonMatch = aiText.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        analysisResult = { ...analysisResult, ...parsed };
      }
    } catch (e) {
      // Fallback keyword detection
      if (/green.*sticker|self.*contain/i.test(aiText)) {
        analysisResult.has_green_sticker = true;
        analysisResult.likely_self_contained = true;
      }
      if (/blue.*sticker|wof/i.test(aiText)) {
        analysisResult.has_blue_sticker = true;
      }
      if (/campervan|motorhome|rv/i.test(aiText)) {
        analysisResult.vehicle_type = 'campervan';
        analysisResult.likely_self_contained = true;
      }
      
      // Extract vehicle details from text if JSON parsing failed
      const makeMatch = aiText.match(/make[":\s]+([A-Za-z]+)/i);
      const modelMatch = aiText.match(/model[":\s]+([A-Za-z0-9\s]+)/i);
      const colorMatch = aiText.match(/color[":\s]+([A-Za-z]+)/i);
      const yearMatch = aiText.match(/year[":\s]+([0-9]{4}|unknown)/i);
      
      if (makeMatch) analysisResult.vehicle_make = makeMatch[1].trim();
      if (modelMatch) analysisResult.vehicle_model = modelMatch[1].trim();
      if (colorMatch) analysisResult.vehicle_color = colorMatch[1].trim();
      if (yearMatch) analysisResult.vehicle_year = yearMatch[1].trim();
    }

    // Calculate confidence score based on OCR success
    let confidenceScore = 0.0;
    if (plateNumber) {
      confidenceScore = 0.85; // OCR is reliable
      
      // Increase for typical NZ plate length (5-6 chars)
      if (plateNumber.length >= 5 && plateNumber.length <= 6) {
        confidenceScore = 0.95;
      }
      
      // Decrease for very short/long (might be partial)
      if (plateNumber.length <= 3 || plateNumber.length >= 7) {
        confidenceScore = 0.65;
      }
    }

    const finalResult = {
      plate_number: plateNumber,
      ...analysisResult,
      confidence_score: confidenceScore,
      confidence: confidenceScore > 0.6 ? 'high' : 'low',
      method: plateNumber ? 'ocr' : 'none',
    };

    console.log('✅ FINAL RESULT:', finalResult);

    return new Response(
      JSON.stringify(finalResult),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: any) {
    console.error('❌ Analysis error:', error);
    return new Response(
      JSON.stringify({ 
        error: error.message || 'Failed to analyze vehicle',
        plate_number: null,
        has_green_sticker: false,
        has_blue_sticker: false,
        vehicle_type: 'unknown',
        likely_self_contained: false,
        confidence_score: 0.0,
        method: 'error',
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
