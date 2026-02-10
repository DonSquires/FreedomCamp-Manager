/**
 * Edge Function: analyze-vehicle-photo
 * Uses OnSpace AI to analyze vehicle photos and extract:
 * - Make, model, color
 * - Self-contained status (camper van, motorhome indicators)
 * - Vehicle type
 * 
 * This runs once per vehicle and populates canonical_vehicles
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';
import { corsHeaders } from '../_shared/cors.ts';

const ONSPACE_AI_BASE_URL = Deno.env.get('ONSPACE_AI_BASE_URL');
const ONSPACE_AI_API_KEY = Deno.env.get('ONSPACE_AI_API_KEY');

interface VehicleAnalysis {
  make: string | null;
  model: string | null;
  color: string | null;
  year: string | null;
  is_self_contained: boolean;
  has_green_sticker: boolean;
  has_blue_sticker: boolean;
  vehicle_type: string;
  confidence: number;
  reasoning: string[];
}

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const { plateNumber, photoUrl, vehicleId } = await req.json();

    if (!plateNumber || !photoUrl) {
      return new Response(
        JSON.stringify({ error: 'Missing plateNumber or photoUrl' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`🚗 Analyzing vehicle photo for ${plateNumber}`);

    // Check if we already have details for this vehicle
    const { data: existingVehicle } = await supabaseClient
      .from('canonical_vehicles')
      .select('vehicle_make, vehicle_model, vehicle_color, ai_analyzed_at, ai_analysis_attempts')
      .eq('plate_number', plateNumber)
      .single();

    if (existingVehicle?.vehicle_make && existingVehicle?.vehicle_model) {
      console.log(`✅ Vehicle details already exist for ${plateNumber}, skipping AI analysis`);
      return new Response(
        JSON.stringify({
          skipped: true,
          reason: 'Vehicle details already populated',
          existing: existingVehicle,
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // SERVER-SIDE AI DEDUPLICATION: Skip if analyzed in last 24 hours
    if (existingVehicle?.ai_analyzed_at) {
      const hoursSinceAnalysis = 
        (Date.now() - new Date(existingVehicle.ai_analyzed_at).getTime()) / (1000 * 60 * 60);
      
      if (hoursSinceAnalysis < 24) {
        console.log(`⏭️ Skipping AI analysis for ${plateNumber} - recently analyzed ${hoursSinceAnalysis.toFixed(1)}h ago`);
        return new Response(
          JSON.stringify({
            skipped: true,
            reason: 'Recently analyzed',
            analyzed_at: existingVehicle.ai_analyzed_at,
            hours_ago: hoursSinceAnalysis.toFixed(1),
          }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
    }

    // Analyze the photo using OnSpace AI
    const analysisPrompt = `Analyze this vehicle photo and extract the following details in JSON format:

1. Vehicle Make (e.g., Toyota, Ford, Mercedes) - be as specific as possible
2. Vehicle Model (e.g., Hiace, Transit, Sprinter)
3. Vehicle Color (primary exterior color)
4. Vehicle Year (estimate based on design/style, or null if unclear)
5. Vehicle Type (car, van, motorhome, campervan, truck, SUV, etc.)
6. Self-contained stickers - Look for:
   - GREEN sticker (older NZ self-containment standard)
   - BLUE sticker with "NZS 5465" text (current NZ self-containment standard)
   - Check windscreen, windows, or body for these specific stickers
7. Is it self-contained? (Look for:
   - Campervan/motorhome body style
   - Pop-top roof
   - Window configurations typical of campervans
   - Side doors/windows indicating living space
   - Overall size and style suggesting self-contained capability
   - Presence of green or blue self-contained stickers)

Respond ONLY in this exact JSON format:
{
  "make": "<manufacturer name or null if unclear>",
  "model": "<model name or null if unclear>",
  "color": "<color name>",
  "year": "<year or null if unclear>",
  "vehicle_type": "<type>",
  "has_green_sticker": true/false,
  "has_blue_sticker": true/false,
  "is_self_contained": true/false,
  "confidence": <number 0-100>,
  "reasoning": ["<reason 1>", "<reason 2>", ...]
}`;

    console.log('🔍 Sending analysis request to OnSpace AI...');

    const aiResponse = await fetch(`${ONSPACE_AI_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${ONSPACE_AI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'google/gemini-3-flash-preview',
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: analysisPrompt },
              { type: 'image_url', image_url: { url: photoUrl } }
            ]
          }
        ],
        temperature: 0.1,
        max_tokens: 800,
      }),
    });

    if (!aiResponse.ok) {
      const errorText = await aiResponse.text();
      console.error('❌ AI analysis failed:', errorText);
      throw new Error(`AI analysis failed: ${errorText}`);
    }

    const aiData = await aiResponse.json();
    const content = aiData.choices[0]?.message?.content;
    
    if (!content) {
      console.error('❌ No content in AI response');
      throw new Error('No analysis result from AI');
    }

    // Parse the JSON response
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.error(`❌ Could not extract JSON from AI response: ${content}`);
      throw new Error('Failed to parse AI response');
    }

    const analysis: VehicleAnalysis = JSON.parse(jsonMatch[0]);
    
    console.log(`✅ Vehicle analyzed: ${analysis.make} ${analysis.model} ${analysis.year || ''} (${analysis.color})`);
    console.log(`   Self-contained: ${analysis.is_self_contained}, Green sticker: ${analysis.has_green_sticker}, Blue sticker: ${analysis.has_blue_sticker}, Confidence: ${analysis.confidence}%`);

    // Update canonical_vehicles with the analysis
    const updateData: any = {
      vehicle_make: analysis.make,
      vehicle_model: analysis.model,
      vehicle_color: analysis.color,
      vehicle_year: analysis.year,
      ai_analyzed_at: new Date().toISOString(),
      ai_analysis_attempts: (existingVehicle?.ai_analysis_attempts || 0) + 1,
    };

    // Only set profile photo if one doesn't already exist (sticky photo)
    if (existingVehicle && !existingVehicle.profile_photo_url) {
      updateData.profile_photo_url = photoUrl;
      updateData.profile_photo_score = analysis.confidence;
      updateData.profile_photo_updated_at = new Date().toISOString();
    }

    if (vehicleId) {
      const { error: updateError } = await supabaseClient
        .from('canonical_vehicles')
        .update(updateData)
        .eq('vehicle_id', vehicleId);

      if (updateError) {
        console.error('❌ Failed to update canonical_vehicles:', updateError);
        throw updateError;
      }
    }

    console.log(`✅ Updated canonical vehicle data for ${plateNumber}`);

    return new Response(
      JSON.stringify({
        success: true,
        plateNumber,
        analysis: {
          make: analysis.make,
          model: analysis.model,
          color: analysis.color,
          year: analysis.year,
          is_self_contained: analysis.is_self_contained,
          has_green_sticker: analysis.has_green_sticker,
          has_blue_sticker: analysis.has_blue_sticker,
          vehicle_type: analysis.vehicle_type,
          confidence: analysis.confidence,
        },
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('❌ Error in analyze-vehicle-photo:', error);
    return new Response(
      JSON.stringify({ error: error.message || 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
