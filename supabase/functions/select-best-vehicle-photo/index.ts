/**
 * Edge Function: select-best-vehicle-photo - UPDATED FOR NEW SCHEMA
 * Uses OnSpace AI to analyze vehicle photos and select the best one as profile photo
 * Updates canonical_vehicles.profile_photo
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';
import { corsHeaders } from '../_shared/cors.ts';

const ONSPACE_AI_BASE_URL = Deno.env.get('ONSPACE_AI_BASE_URL');
const ONSPACE_AI_API_KEY = Deno.env.get('ONSPACE_AI_API_KEY');

interface PhotoAnalysis {
  url: string;
  score: number;
  reasons: string[];
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

    const { plateNumber, photoUrls } = await req.json();

    if (!plateNumber || !photoUrls || photoUrls.length === 0) {
      return new Response(
        JSON.stringify({ error: 'Missing plateNumber or photoUrls' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`📸 Analyzing ${photoUrls.length} photos for vehicle ${plateNumber}`);

    // If only one photo, return it immediately
    if (photoUrls.length === 1) {
      return new Response(
        JSON.stringify({
          bestPhoto: photoUrls[0],
          score: 100,
          analysis: { url: photoUrls[0], score: 100, reasons: ['Only photo available'] },
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Analyze each photo using OnSpace AI
    const analyses: PhotoAnalysis[] = [];

    for (const url of photoUrls) {
      try {
        console.log(`🔍 Analyzing photo: ${url}`);
        
        const analysisPrompt = `Analyze this vehicle photo and rate it from 0-100 for use as a vehicle profile photo. Consider:
1. Is the license plate clearly visible and readable? (40 points)
2. Is the full vehicle in frame? (20 points)
3. Is the lighting good and image quality high? (15 points)
4. Is this a front or side angle? (15 points - front/side preferred over rear)
5. Are there minimal obstructions blocking the vehicle? (10 points)

Respond in JSON format:
{
  "score": <number 0-100>,
  "plateVisible": <boolean>,
  "fullVehicle": <boolean>,
  "goodLighting": <boolean>,
  "angle": "front" | "side" | "rear" | "unclear",
  "reasons": ["<reason 1>", "<reason 2>", ...]
}`;

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
                  { type: 'image_url', image_url: { url } }
                ]
              }
            ],
            temperature: 0.1,
            max_tokens: 500,
          }),
        });

        if (!aiResponse.ok) {
          console.error(`❌ AI analysis failed for ${url}:`, await aiResponse.text());
          analyses.push({ url, score: 50, reasons: ['Analysis failed'] });
          continue;
        }

        const aiData = await aiResponse.json();
        const content = aiData.choices[0]?.message?.content;
        
        if (!content) {
          console.error(`❌ No content in AI response for ${url}`);
          analyses.push({ url, score: 50, reasons: ['No response'] });
          continue;
        }

        // Parse the JSON response
        const jsonMatch = content.match(/\{[\s\S]*\}/);
        if (!jsonMatch) {
          console.error(`❌ Could not extract JSON from AI response: ${content}`);
          analyses.push({ url, score: 50, reasons: ['Parse failed'] });
          continue;
        }

        const result = JSON.parse(jsonMatch[0]);
        
        analyses.push({
          url,
          score: result.score || 50,
          reasons: result.reasons || [],
        });

        console.log(`✅ Photo scored ${result.score}: ${url}`);

      } catch (error) {
        console.error(`❌ Error analyzing ${url}:`, error);
        analyses.push({ url, score: 50, reasons: ['Error during analysis'] });
      }
    }

    // Sort by score descending and select the best
    analyses.sort((a, b) => b.score - a.score);
    const bestPhoto = analyses[0];

    console.log(`🏆 Best photo selected (score: ${bestPhoto.score}): ${bestPhoto.url}`);

    // Update canonical_vehicles with the selected profile photo (NEW SCHEMA)
    const { data: canonicalVehicle, error: vehicleError } = await supabaseClient
      .from('canonical_vehicles')
      .select('plate_number, profile_photo')
      .eq('plate_number', plateNumber)
      .single();

    if (!vehicleError && canonicalVehicle) {
      // Only update if no existing profile photo (sticky behavior)
      if (!canonicalVehicle.profile_photo) {
        await supabaseClient
          .from('canonical_vehicles')
          .update({ 
            profile_photo: bestPhoto.url,
            profile_photo_selected_at: new Date().toISOString(),
            profile_photo_metadata: {
              score: bestPhoto.score,
              reasons: bestPhoto.reasons,
              total_photos_analyzed: photoUrls.length,
            },
          })
          .eq('plate_number', plateNumber);

        console.log(`✅ Set initial profile photo for vehicle ${plateNumber}`);
      } else {
        console.log(`ℹ️ Profile photo already exists for ${plateNumber}, keeping existing (sticky)`);
      }
    }

    return new Response(
      JSON.stringify({
        bestPhoto: bestPhoto.url,
        score: bestPhoto.score,
        allAnalyses: analyses,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('❌ Error in select-best-vehicle-photo:', error);
    return new Response(
      JSON.stringify({ error: error.message || 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
