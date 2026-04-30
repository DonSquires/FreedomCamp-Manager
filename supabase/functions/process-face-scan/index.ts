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
import { withCors, jsonResponse, errorResponse, getCorsHeaders } from '../_shared/withCors.ts';

const SUPABASE_URL              = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const FACE_INFERENCE_SERVICE_URL =
  Deno.env.get('FACE_INFERENCE_SERVICE_URL') ||
  Deno.env.get('INFERENCE_SERVICE_URL');
const INFERENCE_API_KEY         =
  Deno.env.get('INFERENCE_API_KEY') ||
  Deno.env.get('RUNPOD_ENDPOINT_API_KEY') ||
  Deno.env.get('RUNPOD_API_KEY') ||
  Deno.env.get('BOB_INFERENCE_API_KEY') ||
  '';
const INFERENCE_TIMEOUT_MS      = Number(Deno.env.get('INFERENCE_TIMEOUT_MS') ?? '10000');

function isRunpodServerlessUrl(url: string): boolean {
  return /api\.runpod\.ai\/v2\/[^/]+(?:\/(?:run|runsync|health))?\/?$/i.test(url)
}

function fallbackFaceResult(reason: string, hint?: string, configuredUrl?: string | null) {
  return {
    face_count: 0,
    faces: [],
    embedding: null,
    embedding_quality: null,
    metadata: {
      detection_method: 'fallback',
      processing_time_ms: 0,
      onnx_available: false,
      ai_available: false,
      embedding_available: false,
      warning: reason,
      ...(hint ? { hint } : {}),
      ...(configuredUrl ? { configured_url: configuredUrl } : {}),
    },
  }
}

/** Build authentication headers for outbound inference service calls. */
function inferenceAuthHeaders(): Record<string, string> {
  if (INFERENCE_API_KEY) {
    return {
      'x-inference-api-key': INFERENCE_API_KEY,
      'Authorization': `Bearer ${INFERENCE_API_KEY}`,
    };
  }
  if (SUPABASE_SERVICE_ROLE_KEY) {
    return { 'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}` };
  }
  return {};
}

type UserScopeProfile = {
  organization_id: string | null;
  employer_organization_id: string | null;
  authorized_work_locations: string[] | null;
  extra_organization_ids: string[] | null;
  role: string | null;
};

function getScopedOrganizationIds(profile: UserScopeProfile): string[] {
  return [...new Set([
    ...(profile.organization_id ? [profile.organization_id] : []),
    ...(profile.authorized_work_locations ?? []),
    ...(profile.extra_organization_ids ?? []),
  ])];
}

function canAccessOrganization(profile: UserScopeProfile, organizationId: string): boolean {
  if (!organizationId) return false;
  if (profile.role === 'master' || profile.role === 'grand_master') return true;
  return getScopedOrganizationIds(profile).includes(organizationId);
}

async function getUserScopeProfile(supabase: ReturnType<typeof createClient>, userId: string): Promise<UserScopeProfile> {
  const { data: profile, error } = await supabase
    .from('user_profiles')
    .select('organization_id, employer_organization_id, authorized_work_locations, extra_organization_ids, role')
    .eq('id', userId)
    .single();

  if (error || !profile) {
    throw new Error('Unable to resolve user organization scope');
  }

  return profile as UserScopeProfile;
}

async function resolveOperationalOrganizationId(
  supabase: ReturnType<typeof createClient>,
  profile: UserScopeProfile,
  requestedOrganizationId?: string | null,
  zoneId?: string | null,
): Promise<string> {
  let zoneOrganizationId: string | null = null;

  if (zoneId) {
    const { data: zone, error } = await supabase
      .from('zones')
      .select('organization_id')
      .eq('id', zoneId)
      .single();

    if (error || !zone?.organization_id) {
      throw new Error('Zone not found or missing organization scope');
    }

    zoneOrganizationId = zone.organization_id;
  }

  if (requestedOrganizationId && zoneOrganizationId && requestedOrganizationId !== zoneOrganizationId) {
    throw new Error('Requested organization does not match selected zone');
  }

  const resolvedOrganizationId = zoneOrganizationId ?? requestedOrganizationId ?? profile.organization_id;

  if (!resolvedOrganizationId) {
    throw new Error('No organization scope available for this request');
  }

  if (!canAccessOrganization(profile, resolvedOrganizationId)) {
    throw new Error('Requested organization is outside your authorized scope');
  }

  return resolvedOrganizationId;
}

Deno.serve(async (req) => {
  // ── CORS preflight ────────────────────────────────────────────────────────
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: getCorsHeaders(req) });
  }

  try {
    // ── Auth ────────────────────────────────────────────────────────────────
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: 'Missing Authorization header' }),
        { status: 401, headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' } }
      );
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const jwt = authHeader.replace(/^Bearer\s+/i, '');
    const { data: authData, error: authError } = await supabase.auth.getUser(jwt);
    if (authError || !authData?.user) {
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        { status: 401, headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' } }
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
          { status: 400, headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' } }
        );
      }

      if (!FACE_INFERENCE_SERVICE_URL) {
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
          { headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' } }
        );
      }

      // Route to inference service
      const cmpResp = await fetch(`${FACE_INFERENCE_SERVICE_URL}/infer/compare`, {
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
        { headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' } }
      );
    }

    // ── Match action — search POI by embedding ────────────────────────────────
    if (action === 'match') {
      const { embedding } = body;

      if (!Array.isArray(embedding) || embedding.length === 0) {
        return new Response(
          JSON.stringify({ error: 'embedding must be a non-empty array' }),
          { status: 400, headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' } }
        );
      }

      let organizationId: string;
      try {
        const profile = await getUserScopeProfile(supabase, authData.user.id);
        organizationId = await resolveOperationalOrganizationId(
          supabase,
          profile,
          body.organization_id ?? null,
          body.zone_id ?? null,
        );
      } catch (error: any) {
        return new Response(
          JSON.stringify({ error: error.message || 'Invalid organization scope', matches: [] }),
          { status: 403, headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' } }
        );
      }

      const { data: matches, error: matchError } = await supabase.rpc('match_face', {
        p_embedding:   embedding,
        p_org_id:      organizationId,
        p_k:           body.max_results ?? 5,
        p_min_quality: body.min_quality ?? 0.3,
      });

      if (matchError) {
        console.error('match_face RPC error:', matchError);
        return new Response(
          JSON.stringify({ error: 'Face match failed', matches: [] }),
          { status: 500, headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' } }
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
        { headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' } }
      );
    }

    // ── Link POI action — link a face_record to a person_record ───────────────
    if (action === 'link_poi') {
      const { face_record_id, person_record_id } = body;

      if (!face_record_id || !person_record_id) {
        return new Response(
          JSON.stringify({ error: 'face_record_id and person_record_id are required' }),
          { status: 400, headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' } }
        );
      }

      const profile = await getUserScopeProfile(supabase, authData.user.id);

      const { data: faceRecord, error: faceRecordError } = await supabase
        .from('face_records')
        .select('organization_id')
        .eq('id', face_record_id)
        .single();

      if (faceRecordError || !faceRecord?.organization_id) {
        return new Response(
          JSON.stringify({ error: 'Face record not found' }),
          { status: 404, headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' } }
        );
      }

      const { data: personRecord, error: personRecordError } = await supabase
        .from('person_records')
        .select('organization_id')
        .eq('id', person_record_id)
        .single();

      if (personRecordError || !personRecord?.organization_id) {
        return new Response(
          JSON.stringify({ error: 'Person record not found' }),
          { status: 404, headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' } }
        );
      }

      if (faceRecord.organization_id !== personRecord.organization_id) {
        return new Response(
          JSON.stringify({ error: 'Face record and person record belong to different organizations' }),
          { status: 400, headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' } }
        );
      }

      if (!canAccessOrganization(profile, faceRecord.organization_id)) {
        return new Response(
          JSON.stringify({ error: 'Requested organization is outside your authorized scope' }),
          { status: 403, headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' } }
        );
      }

      const { error: linkError } = await supabase
        .from('face_records')
        .update({ person_record_id, label: body.label ?? 'POI' })
        .eq('id', face_record_id);

      if (linkError) {
        return new Response(
          JSON.stringify({ error: 'Link failed: ' + linkError.message }),
          { status: 500, headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' } }
        );
      }

      return new Response(
        JSON.stringify({ success: true }),
        { headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' } }
      );
    }

    // ── Detect action (also handles detect_and_match) ────────────────────────
    const isDetectAndMatch = action === 'detect_and_match';
    const { photo_url } = body;
    if (!photo_url) {
      return new Response(
        JSON.stringify({ error: 'photo_url is required' }),
        { status: 400, headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' } }
      );
    }

    if (!FACE_INFERENCE_SERVICE_URL) {
      return new Response(
        JSON.stringify(fallbackFaceResult(
          'Face inference service is not configured',
          'Set FACE_INFERENCE_SERVICE_URL to a service exposing /infer/face',
        )),
        { headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' } }
      );
    }

    if (isRunpodServerlessUrl(FACE_INFERENCE_SERVICE_URL)) {
      return new Response(
        JSON.stringify(fallbackFaceResult(
          'Configured face inference URL is RunPod serverless and does not expose /infer endpoints',
          'Set FACE_INFERENCE_SERVICE_URL to your inference-service base URL for process-face-scan',
          FACE_INFERENCE_SERVICE_URL,
        )),
        { headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' } }
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
    const inferResp = await fetch(`${FACE_INFERENCE_SERVICE_URL}/infer/face`, {
      method: 'POST',
      headers: inferenceAuthHeaders(),
      body: form,
      signal: AbortSignal.timeout(INFERENCE_TIMEOUT_MS),
    });

    if (!inferResp.ok) {
      const errText = await inferResp.text().catch(() => '');
      const lowered = String(errText || '').toLowerCase();
      if (inferResp.status === 404 && lowered.includes('application not found')) {
        return new Response(
          JSON.stringify(fallbackFaceResult(
            'Face inference endpoint is not available at the configured service URL',
            'Set FACE_INFERENCE_SERVICE_URL to the inference-service base URL that exposes /infer/face',
            FACE_INFERENCE_SERVICE_URL,
          )),
          { headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' } }
        );
      }
      throw new Error(`Face inference failed: ${inferResp.status} ${errText}`);
    }

    const result = await inferResp.json();

    // Optionally save to face_records table
    let savedFaceRecordId: string | null = null;
    let orgId: string | null = null;

    let profile: UserScopeProfile | null = null;
    try {
      profile = await getUserScopeProfile(supabase, authData.user.id);
      orgId = await resolveOperationalOrganizationId(
        supabase,
        profile,
        body.organization_id ?? null,
        body.zone_id ?? null,
      );
    } catch (error: any) {
      if (body.organization_id || body.zone_id || isDetectAndMatch || body.save !== false) {
        return new Response(
          JSON.stringify({ error: error.message || 'Invalid organization scope' }),
          { status: 403, headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' } }
        );
      }
    }

    if (result.face_count > 0 && body.save !== false) {
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
      { headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' } }
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
      { status: 500, headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' } }
    );
  }
});
