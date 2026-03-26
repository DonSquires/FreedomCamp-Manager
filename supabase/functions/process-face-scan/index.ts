// ============================================================================
// process-face-scan — Face detection + embedding via inference service
//
// Actions:
//   "detect" (default) — Detect faces in a photo, generate embeddings.
//     Input:  { photo_url: string }
//     Output: { face_count, faces[], embedding, embedding_quality, metadata }
//
//   "detect_and_match" — Detect faces AND search for POI matches in one call.
//     Input:  { action: "detect_and_match", photo_url: string }
//     Output: { face_count, faces[], embedding, ..., poi_matches[] }
//
//   "match" — Search for matching POI by embedding.
//     Input:  { action: "match", embedding: number[] }
//     Output: { matches: [...] }
//
//   "compare" — Compare two face embeddings (cosine similarity).
//     Input:  { action: "compare", embedding1: number[], embedding2: number[] }
//     Output: { similarity, same_person, confidence, interpretation }
//
//   "link_poi" — Link a face_record to a person_record (POI).
//     Input:  { action: "link_poi", face_record_id: string, person_record_id: string }
//     Output: { success: true }
//
// Auth: Bearer JWT (any authenticated user)
// ============================================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.3';
import { corsHeaders } from '../_shared/cors.ts';

const SUPABASE_URL              = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const INFERENCE_SERVICE_URL     = Deno.env.get('INFERENCE_SERVICE_URL');
const INFERENCE_API_KEY         = Deno.env.get('INFERENCE_API_KEY') || '';
const INFERENCE_TIMEOUT_MS      = Number(Deno.env.get('INFERENCE_TIMEOUT_MS') ?? '10000');

/** Build authentication headers for outbound inference service calls. */
function inferenceAuthHeaders(): Record<string, string> {
  if (INFERENCE_API_KEY) {
    return { 'x-inference-api-key': INFERENCE_API_KEY };
  }
  if (SUPABASE_SERVICE_ROLE_KEY) {
    return { 'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}` };
  }
  return {};
}

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
        headers: { 'Content-Type': 'application/json', ...inferenceAuthHeaders() },
        body: JSON.stringify({ embedding1, embedding2 }),
        signal: AbortSignal.timeout(INFERENCE_TIMEOUT_MS),
      });

      if (!cmpResp.ok) {
        throw new Error(`Compare failed: ${cmpResp.status}`);
      }

      const cmpData = await cmpResp.json();
      const similarity = typeof cmpData.similarity === 'number' ? cmpData.similarity : 0;
      return new Response(
        JSON.stringify({
          similarity,
          same_person:    similarity >= 0.80,
          confidence:     similarity >= 0.90 ? 'high'
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

    // ── Match action — search POI by embedding ────────────────────────────────
    if (action === 'match') {
      const { embedding } = body;

      if (!Array.isArray(embedding) || embedding.length === 0) {
        return new Response(
          JSON.stringify({ error: 'embedding must be a non-empty array' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const { data: profile } = await supabase
        .from('user_profiles')
        .select('organization_id')
        .eq('id', authData.user.id)
        .single();

      if (!profile?.organization_id) {
        return new Response(
          JSON.stringify({ error: 'User has no organisation', matches: [] }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const { data: matches, error: matchError } = await supabase.rpc('match_face', {
        p_embedding:   embedding,
        p_org_id:      profile.organization_id,
        p_k:           body.max_results ?? 5,
        p_min_quality: body.min_quality ?? 0.3,
      });

      if (matchError) {
        console.error('match_face RPC error:', matchError);
        return new Response(
          JSON.stringify({ error: 'Face match failed', matches: [] }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // Filter to only meaningful matches (similarity >= 0.65)
      const MIN_MATCH_SIMILARITY = 0.65;
      const filteredMatches = (matches ?? [])
        .filter((m: any) => m.similarity >= MIN_MATCH_SIMILARITY)
        .map((m: any) => ({
          face_record_id:   m.face_record_id,
          person_record_id: m.person_record_id,
          similarity:       Math.round(m.similarity * 10000) / 10000,
          confidence:       m.similarity >= 0.90 ? 'high'
                          : m.similarity >= 0.80 ? 'medium'
                          : 'low',
          same_person:      m.similarity >= 0.80,
          photo_url:        m.photo_url,
          face_count:       m.face_count,
          label:            m.label,
          face_created_at:  m.face_created_at,
          person: {
            id:                m.person_record_id,
            full_name:         m.person_full_name,
            date_of_birth:     m.person_date_of_birth,
            notes:             m.person_notes,
            homeless_status:   m.person_homeless_status,
            is_of_interest:    m.person_is_of_interest,
            trespass_issued:   m.person_trespass_issued,
            trespass_date:     m.person_trespass_date,
            risk_level:        m.person_risk_level,
          },
        }));

      return new Response(
        JSON.stringify({ matches: filteredMatches }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // ── Link POI action — link a face_record to a person_record ───────────────
    if (action === 'link_poi') {
      const { face_record_id, person_record_id } = body;

      if (!face_record_id || !person_record_id) {
        return new Response(
          JSON.stringify({ error: 'face_record_id and person_record_id are required' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const { error: linkError } = await supabase
        .from('face_records')
        .update({ person_record_id, label: body.label ?? 'POI' })
        .eq('id', face_record_id);

      if (linkError) {
        return new Response(
          JSON.stringify({ error: 'Link failed: ' + linkError.message }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      return new Response(
        JSON.stringify({ success: true }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // ── Detect action (also handles detect_and_match) ────────────────────────
    const isDetectAndMatch = action === 'detect_and_match';
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
      headers: inferenceAuthHeaders(),
      body: form,
      signal: AbortSignal.timeout(INFERENCE_TIMEOUT_MS),
    });

    if (!inferResp.ok) {
      const errText = await inferResp.text().catch(() => '');
      throw new Error(`Face inference failed: ${inferResp.status} ${errText}`);
    }

    const result = await inferResp.json();

    // Optionally save to face_records table
    let savedFaceRecordId: string | null = null;
    let orgId: string | null = null;

    if (result.face_count > 0 && body.save !== false) {
      const { data: profile } = await supabase
        .from('user_profiles')
        .select('organization_id')
        .eq('id', authData.user.id)
        .single();

      orgId = profile?.organization_id ?? null;

      if (orgId) {
        const { data: insertedRecord } = await supabase.from('face_records').insert({
          organization_id: orgId,
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
        }).select('id').single();

        savedFaceRecordId = insertedRecord?.id ?? null;
      }
    }

    // ── POI matching (detect_and_match mode) ──────────────────────────────
    let poiMatches: any[] = [];

    if (isDetectAndMatch && result.embedding && orgId) {
      try {
        const { data: matches, error: matchError } = await supabase.rpc('match_face', {
          p_embedding:   result.embedding,
          p_org_id:      orgId,
          p_k:           5,
          p_min_quality: 0.3,
        });

        if (!matchError && matches) {
          const MIN_MATCH_SIMILARITY = 0.65;
          poiMatches = matches
            .filter((m: any) => m.similarity >= MIN_MATCH_SIMILARITY)
            .map((m: any) => ({
              face_record_id:   m.face_record_id,
              person_record_id: m.person_record_id,
              similarity:       Math.round(m.similarity * 10000) / 10000,
              confidence:       m.similarity >= 0.90 ? 'high'
                              : m.similarity >= 0.80 ? 'medium'
                              : 'low',
              same_person:      m.similarity >= 0.80,
              photo_url:        m.photo_url,
              label:            m.label,
              face_created_at:  m.face_created_at,
              person: {
                id:                m.person_record_id,
                full_name:         m.person_full_name,
                date_of_birth:     m.person_date_of_birth,
                notes:             m.person_notes,
                homeless_status:   m.person_homeless_status,
                is_of_interest:    m.person_is_of_interest,
                trespass_issued:   m.person_trespass_issued,
                trespass_date:     m.person_trespass_date,
                risk_level:        m.person_risk_level,
              },
            }));
        }
      } catch (matchErr) {
        console.warn('POI match failed (non-fatal):', matchErr);
      }
    }

    return new Response(
      JSON.stringify({
        face_count:        result.face_count ?? 0,
        faces:             result.faces ?? [],
        embedding:         result.embedding ?? null,
        embedding_quality: result.embedding_quality ?? null,
        metadata:          result.metadata ?? {},
        face_record_id:    savedFaceRecordId,
        poi_matches:       poiMatches,
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