// ============================================================================
// process-face-scan — Face detection + embedding via inference service
//
// Actions:
//   "detect" (default) — Detect faces in a photo, generate embeddings.
//     Input:  { photo_url: string }
//     Output: { face_count, faces[], embedding, embedding_quality, metadata }
//
//   "compare" — Compare two face embeddings (cosine similarity).
//     Input:  { action: "compare", embedding1: number[], embedding2: number[] }
//     Output: { similarity, same_person, confidence, interpretation }
//
// Auth: Bearer JWT (any authenticated user)
// ============================================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.7';
import { corsHeaders } from '../_shared/cors.ts';

const SUPABASE_URL              = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const INFERENCE_SERVICE_URL     = Deno.env.get('INFERENCE_SERVICE_URL');
const INFERENCE_TIMEOUT_MS      = Number(Deno.env.get('INFERENCE_TIMEOUT_MS') ?? '10000');

Deno.serve(async (req) => {
  // ── CORS preflight ────────────────────────────────────────────────────────
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    // ── Auth ────────────────────────────────────────────────────────────────
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: 'Missing Authorization header' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const jwt = authHeader.replace(/^Bearer\s+/i, '');
    const { data: authData, error: authError } = await supabase.auth.getUser(jwt);
    if (authError || !authData?.user) {
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const body = await req.json();
    const action = body.action ?? 'detect';

    // ── Compare action ──────────────────────────────────────────────────────
    if (action === 'compare') {
      const { embedding1, embedding2 } = body;

      if (!Array.isArray(embedding1) || !Array.isArray(embedding2)) {
        return new Response(
          JSON.stringify({ error: 'embedding1 and embedding2 must be arrays' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      if (!INFERENCE_SERVICE_URL) {
        // Local cosine similarity fallback
        let dot = 0, n1 = 0, n2 = 0;
        for (let i = 0; i < embedding1.length; i++) {
          dot += embedding1[i] * embedding2[i];
          n1  += embedding1[i] * embedding1[i];
          n2  += embedding2[i] * embedding2[i];
        }
        const similarity = n1 > 0 && n2 > 0
          ? dot / (Math.sqrt(n1) * Math.sqrt(n2))
          : 0;

        return new Response(
          JSON.stringify({
            similarity: Math.round(similarity * 10000) / 10000,
            same_person: similarity >= 0.80,
            confidence: similarity >= 0.90 ? 'high'
                      : similarity >= 0.80 ? 'medium'
                      : similarity >= 0.65 ? 'low'
                      : 'different',
            interpretation: similarity >= 0.80
              ? `Likely same person (${(similarity * 100).toFixed(1)}% match)`
              : `Different person (${(similarity * 100).toFixed(1)}% match)`,
          }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // Route to inference service
      const cmpResp = await fetch(`${INFERENCE_SERVICE_URL}/infer/compare`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ embedding1, embedding2 }),
        signal: AbortSignal.timeout(INFERENCE_TIMEOUT_MS),
      });

      if (!cmpResp.ok) {
        throw new Error(`Compare failed: ${cmpResp.status}`);
      }

      const cmpData = await cmpResp.json();
      return new Response(
        JSON.stringify({
          similarity:     cmpData.similarity,
          same_person:    cmpData.same_vehicle ?? cmpData.similarity >= 0.80,
          confidence:     cmpData.confidence,
          interpretation: (cmpData.interpretation ?? '').replace(/vehicle/gi, 'person'),
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // ── Detect action ───────────────────────────────────────────────────────
    const { photo_url } = body;
    if (!photo_url) {
      return new Response(
        JSON.stringify({ error: 'photo_url is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (!INFERENCE_SERVICE_URL) {
      return new Response(
        JSON.stringify({
          error: 'Inference service not configured',
          face_count: 0,
          faces: [],
          embedding: null,
          embedding_quality: null,
          metadata: {
            detection_method: 'none',
            processing_time_ms: 0,
            onnx_available: false,
            openai_available: false,
            embedding_available: false,
          },
        }),
        { status: 503, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Download photo bytes
    const photoResp = await fetch(photo_url, {
      signal: AbortSignal.timeout(5000),
    });
    if (!photoResp.ok) {
      throw new Error(`Photo download failed: ${photoResp.status}`);
    }
    const photoBytes = new Uint8Array(await photoResp.arrayBuffer());

    // Build multipart form
    const form = new FormData();
    const blob = new Blob([photoBytes], { type: 'image/jpeg' });
    form.append('photo', blob, 'face.jpg');

    // Call inference service /infer/face
    const inferResp = await fetch(`${INFERENCE_SERVICE_URL}/infer/face`, {
      method: 'POST',
      body: form,
      signal: AbortSignal.timeout(INFERENCE_TIMEOUT_MS),
    });

    if (!inferResp.ok) {
      const errText = await inferResp.text().catch(() => '');
      throw new Error(`Face inference failed: ${inferResp.status} ${errText}`);
    }

    const result = await inferResp.json();

    // Optionally save to face_records table
    if (result.face_count > 0 && body.save !== false) {
      const { data: profile } = await supabase
        .from('user_profiles')
        .select('organization_id')
        .eq('user_id', authData.user.id)
        .single();

      if (profile?.organization_id) {
        await supabase.from('face_records').insert({
          organization_id: profile.organization_id,
          photo_url,
          face_count:       result.face_count,
          faces:            result.faces,
          embedding:        result.embedding,
          embedding_quality: result.embedding_quality,
          detection_method:  result.metadata?.detection_method ?? null,
          officer_id:       authData.user.id,
          observation_id:   body.observation_id ?? null,
          latitude:         body.latitude ?? null,
          longitude:        body.longitude ?? null,
          zone_id:          body.zone_id ?? null,
          notes:            body.notes ?? null,
          label:            body.label ?? null,
        });
      }
    }

    return new Response(
      JSON.stringify({
        face_count:        result.face_count ?? 0,
        faces:             result.faces ?? [],
        embedding:         result.embedding ?? null,
        embedding_quality: result.embedding_quality ?? null,
        metadata:          result.metadata ?? {},
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('❌ process-face-scan error:', error);
    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : 'Face scan failed',
        face_count: 0,
        faces: [],
        embedding: null,
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
