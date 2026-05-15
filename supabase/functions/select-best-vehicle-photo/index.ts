/**
 * Edge Function: select-best-vehicle-photo - UPDATED FOR NEW SCHEMA
 * Uses AI to analyze vehicle photos and select the best one as profile photo
 * Updates canonical_vehicles.profile_photo
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.3';
import { withCors, jsonResponse, errorResponse, getCorsHeaders } from '../_shared/withCors.ts';
import { bobChat } from '../_shared/bobInfer.ts';
import { buildBobContext } from '../_shared/bobContext.ts';

const MIN_WEIGHTED_SCORE = Number(Deno.env.get('MIN_PROFILE_PHOTO_SCORE') ?? '70');
const MIN_CLARITY_SCORE = Number(Deno.env.get('MIN_PROFILE_PHOTO_CLARITY') ?? '60');
const REQUIRE_FULL_VEHICLE = (Deno.env.get('REQUIRE_FULL_VEHICLE_IN_FRAME') ?? '1') !== '0';

interface PhotoAnalysis {
  score: number;
  weightedScore: number;
  fullVehicleInFrame: boolean;
  clarityScore: number;
  distinctnessScore: number;
  obstructionScore: number;
  angle: 'front' | 'side' | 'rear' | 'unclear';
  confidence: number;
  reasons: string[];
}

interface ObservationPhotoRow {
  photo?: string | null;
  photo_url: string | null;
  recorded_at: string | null;
  gps_accuracy?: number | null;
  embedding_quality?: number | null;
}

function normalizePhotoUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  const cleaned = String(url).trim();
  if (!cleaned || cleaned === 'null' || cleaned === 'undefined') return null;
  return cleaned;
}

function clampScore(value: unknown, fallback = 0): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.min(100, n));
}

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: getCorsHeaders(req) });
  }

  try {
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const body = await req.json();
    const plateNumber = body?.plateNumber ?? body?.plate_number ?? null;
    const providedPhotoUrls = Array.isArray(body?.photoUrls)
      ? body.photoUrls
      : Array.isArray(body?.photo_urls)
      ? body.photo_urls
      : [];
    const forceUpdate = body?.forceUpdate === true || body?.force_update === true;

    if (!plateNumber && providedPhotoUrls.length === 0) {
      return new Response(
        JSON.stringify({ error: 'Missing plateNumber (or plate_number) and no photo URLs provided' }),
        { status: 400, headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' } }
      );
    }

    console.log(`📸 Starting best-photo selection for vehicle ${plateNumber ?? '[manual-list]'}...`);

    // STEP 1: Gather ALL photos from multiple sources
    let photoUrls: string[] = (providedPhotoUrls || [])
      .map((u: unknown) => normalizePhotoUrl(typeof u === 'string' ? u : null))
      .filter((u: string | null): u is string => !!u);

    // Source 1: observations.photo / photo_url
    if (plateNumber) {
      const { data: obsPhotos } = await supabaseClient
        .from('observations')
        .select('photo, photo_url, recorded_at, gps_accuracy, embedding_quality')
        .eq('plate_number', plateNumber)
        .not('photo_url', 'is', null)
        .order('recorded_at', { ascending: false })
        .limit(250);

      if (obsPhotos && obsPhotos.length > 0) {
        const validObsPhotos = (obsPhotos as ObservationPhotoRow[])
          .map((o) => normalizePhotoUrl(o.photo ?? o.photo_url))
          .filter((p: string | null): p is string => !!p);
        photoUrls.push(...validObsPhotos);
        console.log(`Found ${validObsPhotos.length} photos from observations`);
      }
    }

    // Source 2: flagged_vehicles.attachments
    if (plateNumber) {
      const { data: flaggedVehicles } = await supabaseClient
        .from('flagged_vehicles')
        .select('attachments')
        .eq('plate_number', plateNumber)
        .not('attachments', 'is', null);

      if (flaggedVehicles && flaggedVehicles.length > 0) {
        flaggedVehicles.forEach((fv) => {
          if (fv.attachments && Array.isArray(fv.attachments)) {
            const flaggedPhotos = fv.attachments
              .map((a: any) => normalizePhotoUrl(a?.url))
              .filter((p: string | null): p is string => !!p);
            photoUrls.push(...flaggedPhotos);
            console.log(`Found ${flaggedPhotos.length} photos from flagged vehicles`);
          }
        });
      }
    }

    // Source 3: enforcement_actions.attachments
    const { data: enforcementActions } = await supabaseClient
      .from('enforcement_actions')
      .select('attachments')
      .eq('plate_number', plateNumber)
      .not('attachments', 'is', null);

    if (enforcementActions && enforcementActions.length > 0) {
      enforcementActions.forEach(ea => {
        if (ea.attachments && Array.isArray(ea.attachments)) {
          const enforcementPhotos = ea.attachments
            .map((a: any) => a.url)
            .filter(Boolean);
          photoUrls.push(...enforcementPhotos);
          if (enforcementPhotos.length > 0) {
            console.log(`Found ${enforcementPhotos.length} photos from enforcement_actions`);
          }
        }
      });
    }

    // Source 4: photo_metadata table (observation-linked storage references)
    if (plateNumber) {
      const { data: obsIds } = await supabaseClient
        .from('observations')
        .select('observation_id')
        .eq('plate_number', plateNumber)
        .order('recorded_at', { ascending: false })
        .limit(250);

      const observationIds = (obsIds || [])
        .map((row: any) => row.observation_id)
        .filter((id: string | null): id is string => !!id);

      if (observationIds.length > 0) {
        const { data: photoMetadata } = await supabaseClient
          .from('photo_metadata')
          .select('storage_path')
          .in('observation_id', observationIds)
          .not('storage_path', 'is', null)
          .order('created_at', { ascending: false })
          .limit(250);

        if (photoMetadata && photoMetadata.length > 0) {
          const metadataPhotos = photoMetadata
            .map((m) => normalizePhotoUrl(m.storage_path))
            .filter((p: string | null): p is string => !!p);
          photoUrls.push(...metadataPhotos);
          console.log(`Found ${metadataPhotos.length} photos from photo_metadata`);
        }
      }
    }

    // Deduplicate photo URLs
    photoUrls = [...new Set(photoUrls)];

    console.log(`📸 Total unique photos found: ${photoUrls.length}`);

    if (photoUrls.length === 0) {
      return new Response(
        JSON.stringify({ 
          error: 'No photos found', 
          bestPhoto: null,
          totalPhotosSearched: 0 
        }),
        { status: 404, headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' } }
      );
    }

    // If only one photo, return it immediately
    if (photoUrls.length === 1) {
      return new Response(
        JSON.stringify({
          bestPhoto: photoUrls[0],
          score: 100,
          analysis: { url: photoUrls[0], score: 100, reasons: ['Only photo available'] },
        }),
        { headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' } }
      );
    }

    // Analyze each photo using AI with explicit emphasis on:
    // - Full vehicle in frame
    // - Clear/sharp image
    // - Distinct, unobstructed view
    const analyses: PhotoAnalysis[] = [];

    for (const url of photoUrls) {
      try {
        console.log(`🔍 Analyzing photo: ${url}`);

        const analysisPrompt = `You are selecting the BEST canonical vehicle profile photo.
Primary objective: choose a full, clear, distinct vehicle image.

Score this image using these sub-scores (0-100):
1) fullVehicleInFrame: Is the entire vehicle visible (bumper-to-bumper, roof visible where possible)?
2) clarityScore: Is the vehicle sharp, well-lit, not blurry/noisy?
3) distinctnessScore: Is the target vehicle visually distinct and dominant (not crowded/confusing with nearby vehicles)?
4) obstructionScore: How unobstructed is the vehicle (low obstruction = high score)?
5) plateReadabilityScore: Optional tie-breaker only.

Return strict JSON:
{
  "fullVehicleInFrame": <boolean>,
  "fullVehicleInFrameScore": <0-100>,
  "clarityScore": <0-100>,
  "distinctnessScore": <0-100>,
  "obstructionScore": <0-100>,
  "plateReadabilityScore": <0-100>,
  "angle": "front" | "side" | "rear" | "unclear",
  "confidence": <0-1>,
  "reasons": ["short reason", "short reason"]
}`;

        const bobResult = await bobChat({
          message: analysisPrompt,
          temperature: 0.1,
          context: buildBobContext({
            operation: 'select-best-vehicle-photo',
            source: 'vehicle-photo-selection',
            context: {
              image_url: url,
              action: 'analyze_image',
              plate_number: plateNumber,
              total_candidate_photos: photoUrls.length,
            },
          }),
        });

        const content = bobResult.response || '';

        // Parse the JSON response
        const jsonMatch = content.match(/\{[\s\S]*\}/);
        if (!jsonMatch) {
          console.error(`❌ Could not extract JSON from AI response: ${content}`);
          analyses.push({
            url,
            score: 50,
            weightedScore: 50,
            fullVehicleInFrame: false,
            clarityScore: 50,
            distinctnessScore: 50,
            obstructionScore: 50,
            angle: 'unclear',
            confidence: 0.2,
            reasons: ['Parse failed'],
          });
          continue;
        }

        const result = JSON.parse(jsonMatch[0]);
        const fullVehicle = Boolean(result.fullVehicleInFrame);
        const fullVehicleInFrameScore = clampScore(result.fullVehicleInFrameScore, fullVehicle ? 85 : 45);
        const clarityScore = clampScore(result.clarityScore, 50);
        const distinctnessScore = clampScore(result.distinctnessScore, 50);
        const obstructionScore = clampScore(result.obstructionScore, 50);
        const plateReadabilityScore = clampScore(result.plateReadabilityScore, 50);
        const confidence = Math.max(0, Math.min(1, Number(result.confidence) || 0.5));
        const angle = ['front', 'side', 'rear', 'unclear'].includes(result.angle)
          ? result.angle
          : 'unclear';

        const angleBonus = angle === 'front' || angle === 'side' ? 3 : angle === 'rear' ? -4 : 0;
        const fullFramePenalty = fullVehicle ? 0 : -20;

        const weightedScore = Math.max(
          0,
          Math.min(
            100,
            fullVehicleInFrameScore * 0.45 +
            clarityScore * 0.30 +
            distinctnessScore * 0.20 +
            obstructionScore * 0.05 +
            plateReadabilityScore * 0.02 +
            angleBonus +
            fullFramePenalty
          )
        );
        
        analyses.push({
          url,
          score: weightedScore,
          weightedScore,
          fullVehicleInFrame: fullVehicle,
          clarityScore,
          distinctnessScore,
          obstructionScore,
          angle,
          confidence,
          reasons: result.reasons || [],
        });

        console.log(`✅ Photo scored ${Math.round(weightedScore)} (fullVehicle=${fullVehicle}, clarity=${clarityScore}, distinct=${distinctnessScore}): ${url}`);

      } catch (error) {
        console.error(`❌ Error analyzing ${url}:`, error);
        analyses.push({
          url,
          score: 50,
          weightedScore: 50,
          fullVehicleInFrame: false,
          clarityScore: 50,
          distinctnessScore: 50,
          obstructionScore: 50,
          angle: 'unclear',
          confidence: 0.2,
          reasons: ['Error during analysis'],
        });
      }
    }

    // Prefer full-vehicle photos first, then highest weighted score.
    analyses.sort((a, b) => {
      if (a.fullVehicleInFrame !== b.fullVehicleInFrame) {
        return a.fullVehicleInFrame ? -1 : 1;
      }
      return b.weightedScore - a.weightedScore;
    });
    const bestPhoto = analyses[0];

    console.log(`🏆 Best photo selected (weightedScore: ${bestPhoto.weightedScore}): ${bestPhoto.url}`);

    // Update canonical_vehicles with the selected profile photo (NEW SCHEMA)
    let appliedToCanonical = false;
    let skippedByQualityGate = false;

    const meetsQualityGate =
      bestPhoto.weightedScore >= MIN_WEIGHTED_SCORE &&
      bestPhoto.clarityScore >= MIN_CLARITY_SCORE &&
      (!REQUIRE_FULL_VEHICLE || bestPhoto.fullVehicleInFrame);

    if (plateNumber) {
      const { data: canonicalVehicle, error: vehicleError } = await supabaseClient
        .from('canonical_vehicles')
        .select('plate_number, profile_photo')
        .eq('plate_number', plateNumber)
        .single();

      if (!vehicleError && canonicalVehicle) {
        const shouldUpdate = forceUpdate || !canonicalVehicle.profile_photo;

        if (shouldUpdate) {
          if (meetsQualityGate) {
            await supabaseClient
              .from('canonical_vehicles')
              .update({
                profile_photo: bestPhoto.url,
                profile_photo_selected_at: new Date().toISOString(),
                profile_photo_metadata: {
                  quality_score: Math.round(bestPhoto.weightedScore),
                  full_vehicle_in_frame: bestPhoto.fullVehicleInFrame,
                  clarity_score: Math.round(bestPhoto.clarityScore),
                  distinctness_score: Math.round(bestPhoto.distinctnessScore),
                  obstruction_score: Math.round(bestPhoto.obstructionScore),
                  angle: bestPhoto.angle,
                  confidence: bestPhoto.confidence,
                  reasons: bestPhoto.reasons,
                  total_photos_analyzed: photoUrls.length,
                  force_update: forceUpdate,
                  selected_at: new Date().toISOString(),
                  quality_gate: {
                    passed: true,
                    min_weighted_score: MIN_WEIGHTED_SCORE,
                    min_clarity_score: MIN_CLARITY_SCORE,
                    require_full_vehicle: REQUIRE_FULL_VEHICLE,
                  },
                },
              })
              .eq('plate_number', plateNumber);

            appliedToCanonical = true;
            console.log(`✅ Updated profile photo for vehicle ${plateNumber}`);
          } else {
            skippedByQualityGate = true;
            console.log(`⚠️ Skipped canonical update for ${plateNumber}: best photo did not meet quality gate`);
          }
        } else {
          console.log(`ℹ️ Profile photo already exists for ${plateNumber}, keeping existing (sticky)`);
        }
      }
    }

    return new Response(
      JSON.stringify({
        bestPhoto: bestPhoto.url,
        score: Math.round(bestPhoto.weightedScore),
        selectedFromCurrentPhotos: true,
        meetsQualityGate,
        appliedToCanonical,
        skippedByQualityGate,
        qualityGate: {
          minWeightedScore: MIN_WEIGHTED_SCORE,
          minClarityScore: MIN_CLARITY_SCORE,
          requireFullVehicle: REQUIRE_FULL_VEHICLE,
        },
        allAnalyses: analyses,
      }),
      { headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('❌ Error in select-best-vehicle-photo:', error);
    return new Response(
      JSON.stringify({ error: error.message || 'Internal server error' }),
      { status: 500, headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' } }
    );
  }
});
