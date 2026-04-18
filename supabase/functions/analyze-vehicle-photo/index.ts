/**
 * analyze-vehicle-photo Edge Function
 * 
 * AI-powered vehicle photo analysis with NZSCV self-contained verification
 * 
 * KEY FEATURE: Differentiates between AI-detected and NZSCV-registered self-contained status
 * - NZSCV register is the SINGLE SOURCE OF TRUTH for self-contained certification
 * - AI detection of stickers is used for validation/conflict detection only
 * - If mismatch detected: log it but always use NZSCV data
 * 
 * WORKFLOW:
 * 1. AI analyzes photo (make, model, year, color, self-contained STICKER detection)
 * 2. Check NZSCV register for actual self-contained certification
 * 3. Compare AI vs NZSCV:
 *    - Match: Good! AI validated NZSCV data
 *    - Mismatch: Note conflict but use NZSCV as authoritative
 * 4. Update canonical_vehicles with NZSCV data (source of truth)
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.3';
import { withCors, jsonResponse, errorResponse, getCorsHeaders } from '../_shared/withCors.ts';

const OPENAI_BASE_URL = (Deno.env.get('OPENAI_BASE_URL') || '').replace(/\/+$/, '');
const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY');
const OPENAI_MODEL = Deno.env.get('OPENAI_MODEL') || 'gpt-4o';
const ALLOW_EDGE_OPENAI_DIRECT = (Deno.env.get('ALLOW_EDGE_OPENAI_DIRECT') || 'false').toLowerCase() === 'true';

function isDirectOpenAIBaseUrl(url: string): boolean {
  try {
    return new URL(url).hostname.toLowerCase() === 'api.openai.com';
  } catch {
    return false;
  }
}

interface AIAnalysisResult {
  make: string | null;
  model: string | null;
  year: string | null;
  color: string | null;
  ai_detected_self_contained_sticker: boolean;
  ai_sticker_confidence: number;
  sticker_type: 'blue' | 'green' | 'none' | 'unclear';
}

interface NZSCVResult {
  is_self_contained: boolean;
  expiry_date: string | null;
  source: string;
  last_checked: string;
}

interface ValidationResult {
  match: boolean;
  conflict_note: string | null;
  nzscv_authoritative: boolean;
  ai_detected: boolean;
  nzscv_certified: boolean;
}

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: getCorsHeaders(req) });
  }

  try {
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const { plateNumber, photoUrl, vehicleId } = await req.json();

    if (!plateNumber || !photoUrl) {
      return new Response(
        JSON.stringify({ error: 'Missing plateNumber or photoUrl' }),
        { status: 400, headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' } }
      );
    }

    console.log(`🤖 [AI ANALYSIS] Starting analysis for ${plateNumber}`);

    // STEP 1: AI Photo Analysis (including sticker detection)
    console.log('🔍 [AI ANALYSIS] Analyzing photo...');
    
    const analysisPrompt = `Analyze this vehicle photo and extract the following details in JSON format:

1. **Vehicle Make**: Brand/manufacturer (e.g., Toyota, Ford, Honda)
2. **Vehicle Model**: Model name (e.g., Corolla, Ranger, Civic)
3. **Vehicle Year**: Approximate year (e.g., 2018, 2020)
4. **Vehicle Color**: Primary color (e.g., White, Silver, Blue)
5. **Self-Contained Sticker Detection**:
   - Look for BLUE or GREEN self-contained certification stickers
   - Blue sticker = New Zealand Motor Caravan Association (NZMCA) certification
   - Green sticker = New Zealand Self Containment Certification
   - Rate your confidence (0.0-1.0) in sticker detection
   - Note sticker type: "blue", "green", "none", or "unclear"

IMPORTANT: You are detecting physical stickers only. The actual certification status will be verified against the official NZSCV register separately.

Respond ONLY with valid JSON (no markdown, no explanations):
{
  "make": "Toyota",
  "model": "Hiace",
  "year": "2019",
  "color": "White",
  "ai_detected_self_contained_sticker": true,
  "ai_sticker_confidence": 0.85,
  "sticker_type": "blue"
}`;

    let aiAnalysis: AIAnalysisResult = {
      make: null,
      model: null,
      year: null,
      color: null,
      ai_detected_self_contained_sticker: false,
      ai_sticker_confidence: 0,
      sticker_type: 'none',
    };

    try {
      if (!OPENAI_API_KEY || !OPENAI_BASE_URL) {
        throw new Error('AI vision not configured');
      }
      if (isDirectOpenAIBaseUrl(OPENAI_BASE_URL) && !ALLOW_EDGE_OPENAI_DIRECT) {
        throw new Error('Direct api.openai.com access is blocked for edge functions. Set ALLOW_EDGE_OPENAI_DIRECT=true to override.');
      }

      const aiResponse = await fetch(`${OPENAI_BASE_URL}/chat/completions`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${OPENAI_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: OPENAI_MODEL,
          messages: [
            {
              role: 'user',
              content: [
                { type: 'text', text: analysisPrompt },
                { type: 'image_url', image_url: { url: photoUrl } }
              ]
            }
          ],
          response_format: { type: 'json_object' },
          temperature: 0.1,
          max_tokens: 500,
        }),
      });

      if (!aiResponse.ok) {
        const errorText = await aiResponse.text();
        console.error(`❌ [AI ANALYSIS] AI request failed:`, errorText);
        throw new Error(`AI API error: ${aiResponse.status}`);
      }

      const aiData = await aiResponse.json();
      const content = aiData.choices[0]?.message?.content;
      
      if (!content) {
        throw new Error('No content in AI response');
      }

      // Parse AI response
      const parsedAnalysis = JSON.parse(content);
      aiAnalysis = {
        make: parsedAnalysis.make || null,
        model: parsedAnalysis.model || null,
        year: parsedAnalysis.year?.toString() || null,
        color: parsedAnalysis.color || null,
        ai_detected_self_contained_sticker: parsedAnalysis.ai_detected_self_contained_sticker || false,
        ai_sticker_confidence: parsedAnalysis.ai_sticker_confidence || 0,
        sticker_type: parsedAnalysis.sticker_type || 'none',
      };

      console.log(`✅ [AI ANALYSIS] AI detected:`, {
        vehicle: `${aiAnalysis.color} ${aiAnalysis.make} ${aiAnalysis.model} ${aiAnalysis.year}`,
        sticker_detected: aiAnalysis.ai_detected_self_contained_sticker,
        sticker_type: aiAnalysis.sticker_type,
        confidence: Math.round((aiAnalysis.ai_sticker_confidence || 0) * 100) + '%',
      });

    } catch (aiError: any) {
      console.error(`⚠️ [AI ANALYSIS] AI analysis failed (non-critical):`, aiError.message);
      // Continue with null values - NZSCV check is more important
    }

    // STEP 2: Check canonical_scv first (authoritative SCV registry), then NZSCV Register
    // canonical_scv is the single source of truth for SCV certification,
    // maintained by sync-scv-list.  The NZSCV API may be pointing to a test
    // endpoint, so canonical_scv is the more reliable source.
    console.log('🔍 [AI ANALYSIS] Checking canonical_scv for SCV status...');
    
    let nzscvResult: NZSCVResult = {
      is_self_contained: false,
      expiry_date: null,
      source: 'nzscv_register',
      last_checked: new Date().toISOString(),
    };
    let canonicalHasSCVData = false;

    try {
      const { data: scvRow } = await (supabaseAdmin.from('canonical_scv') as any)
        .select('is_self_contained, certificate_expiry')
        .eq('plate_number', plateNumber.toUpperCase().trim())
        .maybeSingle();

      if (scvRow && scvRow.is_self_contained === true) {
        const expiry = scvRow.certificate_expiry ?? null;
        const isExpired = expiry != null && new Date(expiry) < new Date();
        if (!isExpired) {
          nzscvResult = {
            is_self_contained: true,
            expiry_date: expiry,
            source: 'canonical_scv',
            last_checked: new Date().toISOString(),
          };
          canonicalHasSCVData = true;
          console.log('✅ [AI ANALYSIS] SCV status from canonical_scv (trusted):', {
            certified: true,
            expiry,
          });
        }
      }
    } catch (canonicalErr: any) {
      console.warn('⚠️ [AI ANALYSIS] canonical_scv check failed:', canonicalErr.message);
    }

    // Only call NZSCV API if canonical doesn't confirm self-contained
    if (!canonicalHasSCVData) {
      console.log('🌐 [AI ANALYSIS] Falling back to NZSCV register...');
      try {
        const { data: nzscvData, error: nzscvError } = await supabaseAdmin.functions.invoke(
          'check-nzscv-status',
          {
            body: {
              plateNumber: plateNumber.toUpperCase().trim(),
            },
          }
        );

        if (!nzscvError && nzscvData?.result) {
          nzscvResult = {
            is_self_contained: nzscvData.result.is_self_contained || false,
            expiry_date: nzscvData.result.expiry_date || null,
            source: nzscvData.source === 'canonical_scv' ? 'canonical_scv' : 'nzscv_register',
            last_checked: new Date().toISOString(),
          };

          console.log(`✅ [AI ANALYSIS] NZSCV register checked:`, {
            certified: nzscvResult.is_self_contained,
            expiry: nzscvResult.expiry_date,
          });
        } else {
          console.warn(`⚠️ [AI ANALYSIS] NZSCV check failed (non-critical):`, nzscvError?.message);
        }
      } catch (nzscvError: any) {
        console.warn(`⚠️ [AI ANALYSIS] NZSCV check error (non-critical):`, nzscvError.message);
      }
    }

    // STEP 3: Validation - Compare AI vs NZSCV
    const validation: ValidationResult = {
      match: aiAnalysis.ai_detected_self_contained_sticker === nzscvResult.is_self_contained,
      conflict_note: null,
      nzscv_authoritative: true, // Always true - NZSCV is source of truth
      ai_detected: aiAnalysis.ai_detected_self_contained_sticker,
      nzscv_certified: nzscvResult.is_self_contained,
    };

    if (!validation.match) {
      // CONFLICT DETECTED
      if (aiAnalysis.ai_detected_self_contained_sticker && !nzscvResult.is_self_contained) {
        validation.conflict_note = `⚠️ CONFLICT: AI detected self-contained sticker (${aiAnalysis.sticker_type}, confidence ${Math.round((aiAnalysis.ai_sticker_confidence || 0) * 100)}%) but vehicle NOT in NZSCV register. Using NZSCV as source of truth - vehicle is NOT certified self-contained.`;
        console.warn(`🚨 [AI ANALYSIS] ${validation.conflict_note}`);
      } else if (!aiAnalysis.ai_detected_self_contained_sticker && nzscvResult.is_self_contained) {
        validation.conflict_note = `ℹ️ NOTE: NZSCV register shows self-contained certification but AI did not detect sticker in photo. Using NZSCV as source of truth - vehicle IS certified self-contained (sticker may be obscured or not visible in photo).`;
        console.log(`ℹ️ [AI ANALYSIS] ${validation.conflict_note}`);
      }
    } else {
      // MATCH - Good!
      if (validation.nzscv_certified) {
        console.log(`✅ [AI ANALYSIS] MATCH: AI detected sticker AND NZSCV register confirms certification ✓`);
      } else {
        console.log(`✅ [AI ANALYSIS] MATCH: AI found no sticker AND NZSCV register shows no certification ✓`);
      }
    }

    // STEP 4: Update canonical_vehicles with enriched data (vehicle attributes)
    // and canonical_scv with SCV certification data when new data is available.
    console.log('💾 [AI ANALYSIS] Updating canonical vehicle...');
    
    const updateData: any = {
      // Vehicle details from AI
      vehicle_make: aiAnalysis.make,
      vehicle_model: aiAnalysis.model,
      // canonical_vehicles.vehicle_year is INTEGER — store the parsed integer directly.
      vehicle_year: aiAnalysis.year ? (parseInt(aiAnalysis.year, 10) || null) : null,
      vehicle_color: aiAnalysis.color,
      
      // Timestamp
      updated_at: new Date().toISOString(),
    };

    // Only update SCV fields if canonical_scv didn't already have trusted data.
    // This prevents overwriting good canonical SCV data with potentially
    // inaccurate NZSCV API test page results.
    if (!canonicalHasSCVData) {
      updateData.self_contained = nzscvResult.is_self_contained;
      updateData.self_contained_expiry = nzscvResult.expiry_date;
      updateData.nzscv_source = nzscvResult.source;
      updateData.nzscv_last_checked = nzscvResult.last_checked;

      // Also upsert into canonical_scv (authoritative SCV registry)
      try {
        await (supabaseAdmin.from('canonical_scv') as any).upsert({
          plate_number: plateNumber.toUpperCase().trim(),
          is_self_contained: nzscvResult.is_self_contained,
          certificate_expiry: nzscvResult.expiry_date,
          source: nzscvResult.source === 'nzscv_register' ? 'nzscv_api' : nzscvResult.source,
          verified_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }, { onConflict: 'plate_number' });
      } catch (scvUpsertErr: any) {
        console.warn('⚠️ [AI ANALYSIS] canonical_scv upsert failed (non-critical):', scvUpsertErr?.message);
      }
    }

    const { error: updateError } = await supabaseAdmin
      .from('canonical_vehicles')
      .update(updateData)
      .eq('plate_number', plateNumber.toUpperCase().trim());

    if (updateError) {
      console.error(`❌ [AI ANALYSIS] Failed to update canonical vehicle:`, updateError);
      throw updateError;
    }

    console.log(`✅ [AI ANALYSIS] Canonical vehicle updated successfully`);

    // STEP 5: Return comprehensive result
    return new Response(
      JSON.stringify({
        success: true,
        analysis: {
          // Vehicle details from AI
          make: aiAnalysis.make,
          model: aiAnalysis.model,
          year: aiAnalysis.year,
          color: aiAnalysis.color,
          
          // AI sticker detection (for reference/validation only)
          ai_sticker_detection: {
            detected: aiAnalysis.ai_detected_self_contained_sticker,
            confidence: aiAnalysis.ai_sticker_confidence,
            sticker_type: aiAnalysis.sticker_type,
          },
          
          // NZSCV register (SOURCE OF TRUTH)
          nzscv_certification: {
            is_self_contained: nzscvResult.is_self_contained,
            expiry_date: nzscvResult.expiry_date,
            source: nzscvResult.source,
            last_checked: nzscvResult.last_checked,
          },
          
          // Validation results
          validation: {
            match: validation.match,
            conflict_note: validation.conflict_note,
            authoritative_source: 'NZSCV register',
            final_self_contained_status: nzscvResult.is_self_contained,
          },
        },
      }),
      { headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' } }
    );

  } catch (error: any) {
    console.error('❌ [AI ANALYSIS] Error:', error);
    return new Response(
      JSON.stringify({
        success: false,
        error: error.message || 'Internal server error',
      }),
      { status: 500, headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' } }
    );
  }
});
