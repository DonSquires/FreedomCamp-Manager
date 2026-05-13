import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.3'
import { withCors, jsonResponse, errorResponse } from '../_shared/withCors.ts'
import { requireAuth } from '../_shared/requireAuth.ts'
import { buildAccessibleOrgIds } from '../_shared/orgAccess.ts'

type AskBobRequest = {
  prompt?: string
  lat?: number
  lng?: number
  organization_id?: string | null
}

type BobVideoActionResult = {
  success?: boolean
  video_id?: string
  video_url?: string
  media_log_id?: string
  proposal_id?: string
  duration_seconds?: number
  quality?: string
  format?: string
  created_at?: string
  error?: string
  error_code?: string
}

const VIDEO_CONFIRMATION_RE = /\b(confirm|approved|yes)\b/i
const UUID_RE = /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/i

function extractBearerToken(req: Request): string | null {
  const authHeader = req.headers.get('Authorization') || req.headers.get('authorization')
  if (!authHeader) return null
  const match = authHeader.match(/^Bearer\s+(.+)$/i)
  return match?.[1]?.trim() ?? null
}

function parseUuidArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((v) => String(v || '').trim()).filter(Boolean)
  if (typeof value === 'string' && value.trim()) {
    try {
      const parsed = JSON.parse(value)
      if (Array.isArray(parsed)) return parsed.map((v) => String(v || '').trim()).filter(Boolean)
    } catch {
      return value.split(',').map((v) => v.trim()).filter(Boolean)
    }
  }
  return []
}

function isVideoGenerationIntent(prompt: string): boolean {
  const normalized = String(prompt || '').toLowerCase()
  const hasVideoWord = /\bvideo\b/.test(normalized)
  const hasGenerateVerb = /\b(generate|create|make|build|produce|render)\b/.test(normalized)
  const hasBriefingPhrase = /\bbriefing\s+video\b/.test(normalized)
  return (hasVideoWord && hasGenerateVerb) || hasBriefingPhrase
}

function hasVideoConfirmation(prompt: string): boolean {
  return VIDEO_CONFIRMATION_RE.test(String(prompt || ''))
}

function extractProposalId(prompt: string): string | null {
  const explicit = String(prompt || '').match(/proposal(?:_id)?\s*[:=]?\s*([0-9a-f-]{36})/i)
  if (explicit?.[1] && UUID_RE.test(explicit[1])) return explicit[1]

  const anyUuid = String(prompt || '').match(UUID_RE)
  return anyUuid?.[0] ?? null
}

async function createVideoProposal(
  supabaseAdmin: ReturnType<typeof createClient>,
  params: {
    orgId: string
    userId: string
    title: string
    prompt: string
    status: 'proposed' | 'approved'
    approvalNotes?: string | null
  },
): Promise<string | null> {
  const nowIso = new Date().toISOString()
  const insertPayload: Record<string, unknown> = {
    organization_id: params.orgId,
    proposal_type: 'generate_briefing_video',
    title: params.title,
    proposal_payload: {
      source: 'ask-bob',
      prompt: params.prompt,
    },
    impact_level: 'medium',
    requested_by: params.userId,
    status: params.status,
  }

  if (params.status === 'approved') {
    insertPayload.approver_id = params.userId
    insertPayload.approved_at = nowIso
    insertPayload.approval_notes = params.approvalNotes || 'User confirmed in Ask Bob prompt'
  }

  const { data, error } = await (supabaseAdmin.from('bob_action_proposals') as any)
    .insert(insertPayload)
    .select('id')
    .single()

  if (error || !data?.id) return null

  if (params.status === 'approved') {
    await (supabaseAdmin.from('bob_action_proposal_events') as any).insert({
      proposal_id: data.id,
      organization_id: params.orgId,
      event_type: 'approved',
      actor_id: params.userId,
      notes: params.approvalNotes || 'Confirmed by user in Ask Bob',
      metadata: {
        source: 'ask-bob',
      },
    })
  }

  return String(data.id)
}

async function approveExistingProposal(
  supabaseAdmin: ReturnType<typeof createClient>,
  params: {
    proposalId: string
    orgId: string
    userId: string
    approvalNotes: string
  },
): Promise<string | null> {
  const nowIso = new Date().toISOString()
  const { data, error } = await (supabaseAdmin.from('bob_action_proposals') as any)
    .update({
      status: 'approved',
      approver_id: params.userId,
      approved_at: nowIso,
      approval_notes: params.approvalNotes,
      updated_at: nowIso,
    })
    .eq('id', params.proposalId)
    .eq('organization_id', params.orgId)
    .in('status', ['proposed', 'pending_escalation'])
    .select('id')
    .maybeSingle()

  if (error || !data?.id) return null

  await (supabaseAdmin.from('bob_action_proposal_events') as any).insert({
    proposal_id: data.id,
    organization_id: params.orgId,
    event_type: 'approved',
    actor_id: params.userId,
    notes: params.approvalNotes,
    metadata: {
      source: 'ask-bob',
    },
  })

  return String(data.id)
}

async function findLatestPendingVideoProposalId(
  supabaseAdmin: ReturnType<typeof createClient>,
  params: {
    orgId: string
    userId: string
  },
): Promise<string | null> {
  const { data } = await (supabaseAdmin.from('bob_action_proposals') as any)
    .select('id')
    .eq('organization_id', params.orgId)
    .eq('requested_by', params.userId)
    .eq('proposal_type', 'generate_briefing_video')
    .in('status', ['proposed', 'pending_escalation'])
    .order('proposed_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  return data?.id ? String(data.id) : null
}

function buildSystemPrompt(context: Record<string, unknown> | null): string {
  if (!context) {
    return [
      'You are Bob, an enforcement AI for New Zealand freedom camping operations.',
      'Apply standard NZ Freedom Camping Act and operational policy guidance.',
      'Answer clearly with actionable field advice.',
    ].join(' ')
  }

  const workspaceName = String(context.workspace_name || context.client_name || 'Client jurisdiction')
  const bylaws = context.bylaws
  const bylawsText = bylaws ? JSON.stringify(bylaws) : 'No specific bylaw payload provided.'

  return [
    'You are Bob, an enforcement AI.',
    `You are currently operating in ${workspaceName}.`,
    `Apply these jurisdiction bylaws and constraints: ${bylawsText}`,
    'Respond with practical patrol-ready guidance and clearly call out uncertainty when needed.',
  ].join(' ')
}

function extractAnswer(payload: Record<string, unknown>): string {
  const output = payload.output as Record<string, unknown> | undefined
  const message = output?.message as Record<string, unknown> | undefined
  const choices = output?.choices as Array<Record<string, unknown>> | undefined
  const firstChoice = choices?.[0]?.message as Record<string, unknown> | undefined

  const candidates = [
    payload.response,
    payload.message,
    output?.response,
    output?.message,
    message?.content,
    firstChoice?.content,
  ]

  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim()) {
      return candidate.trim()
    }
  }

  return ''
}

Deno.serve(withCors(async (req: Request) => {
  const authResult = await requireAuth(req)
  if (!authResult.user) {
    return errorResponse(authResult.error ?? 'Unauthorized', req, 401)
  }

  if (req.method !== 'POST') {
    return errorResponse('Method not allowed', req, 405)
  }

  const body = await req.json().catch(() => ({})) as AskBobRequest
  const prompt = String(body.prompt || '').trim()

  if (!prompt) {
    return errorResponse('prompt is required', req, 400)
  }

  const supabaseUrl = String(Deno.env.get('SUPABASE_URL') || '').trim()
  const supabaseAnonKey = String(Deno.env.get('SUPABASE_ANON_KEY') || '').trim()
  const serviceRoleKey = String(Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '').trim()
  if (!supabaseUrl || !serviceRoleKey) {
    return errorResponse('Supabase service role configuration is missing', req, 503)
  }

  const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    },
  })

  const { data: profile } = await supabaseAdmin
    .from('user_profiles')
    .select('role, organization_id, employer_organization_id, extra_organization_ids, authorized_work_locations')
    .eq('id', authResult.user.id)
    .maybeSingle()

  const primaryOrgId = String(profile?.organization_id || '').trim() || null
  const allowedOrgIds = Array.from(await buildAccessibleOrgIds(supabaseAdmin as any, {
    role: String((profile as any)?.role || '').trim(),
    organization_id: primaryOrgId,
    employer_organization_id: String((profile as any)?.employer_organization_id || '').trim() || null,
    extra_organization_ids: parseUuidArray((profile as any)?.extra_organization_ids),
    authorized_work_locations: parseUuidArray((profile as any)?.authorized_work_locations),
  }))

  const providerOrgId = String(body.organization_id || primaryOrgId || '').trim() || null
  const resolvedOrgId = providerOrgId && allowedOrgIds.includes(providerOrgId)
    ? providerOrgId
    : (allowedOrgIds[0] || null)

  if (!resolvedOrgId) {
    return errorResponse('No organization access available for this user', req, 403)
  }

  const lat = typeof body.lat === 'number' ? body.lat : null
  const lng = typeof body.lng === 'number' ? body.lng : null

  let context: Record<string, unknown> | null = null
  if (resolvedOrgId && lat !== null && lng !== null) {
    const { data: contextData, error: contextError } = await supabaseAdmin.rpc('get_active_context', {
      officer_lat: lat,
      officer_lng: lng,
      provider_id: resolvedOrgId,
    })

    if (!contextError && contextData) {
      context = contextData as Record<string, unknown>
    }
  }

  const systemPrompt = buildSystemPrompt(context)

  const userJwt = extractBearerToken(req)
  if (!userJwt) {
    return errorResponse('Missing authorization token', req, 401)
  }

  // Action-first handling for executable intents.
  if (isVideoGenerationIntent(prompt)) {
    if (!hasVideoConfirmation(prompt)) {
      const proposedId = await createVideoProposal(supabaseAdmin, {
        orgId: resolvedOrgId,
        userId: authResult.user.id,
        title: 'Bob video generation request',
        prompt,
        status: 'proposed',
      })

      return jsonResponse({
        answer: proposedId
          ? `I detected a video generation request and created approval proposal ${proposedId}. To proceed, reply with: confirm create briefing video for proposal ${proposedId}.`
          : 'I detected a video generation request. To proceed, reply with: confirm create briefing video for this request.',
        jurisdiction: String(context?.workspace_name || 'General'),
        is_client_owned: Boolean(context),
        model: 'qwen2.5:7b',
        provider: 'ask-bob-confirmation-gate',
        action: {
          type: 'generate_briefing_video',
          requires_confirmation: true,
          proposal_id: proposedId || null,
          confirmation_hint: proposedId
            ? `confirm create briefing video for proposal ${proposedId}`
            : 'confirm create briefing video for this request',
        },
      }, req)
    }

    const approvalNotes = 'User confirmation accepted in Ask Bob prompt'
    const explicitProposalId = extractProposalId(prompt)
    const latestPendingId = explicitProposalId || await findLatestPendingVideoProposalId(supabaseAdmin, {
      orgId: resolvedOrgId,
      userId: authResult.user.id,
    })

    let approvedProposalId: string | null = null
    if (latestPendingId) {
      approvedProposalId = await approveExistingProposal(supabaseAdmin, {
        proposalId: latestPendingId,
        orgId: resolvedOrgId,
        userId: authResult.user.id,
        approvalNotes,
      })
    }

    if (!approvedProposalId) {
      approvedProposalId = await createVideoProposal(supabaseAdmin, {
        orgId: resolvedOrgId,
        userId: authResult.user.id,
        title: 'Bob video generation request (confirmed)',
        prompt,
        status: 'approved',
        approvalNotes,
      })
    }

    const videoActionResponse = await fetch(`${supabaseUrl}/functions/v1/bob-generate-video-action`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${userJwt}`,
        apikey: supabaseAnonKey || serviceRoleKey,
        'Content-Type': 'application/json',
        'x-client-info': 'ask-bob-edge-function',
        'x-org-id': resolvedOrgId,
      },
      body: JSON.stringify({
        request_context: prompt,
        org_id: resolvedOrgId,
        allowed_org_ids: allowedOrgIds,
        approved_proposal_id: approvedProposalId,
        model_used: 'qwen2.5:7b',
      }),
    })

    const videoPayload = await videoActionResponse.json().catch(() => ({})) as BobVideoActionResult
    if (!videoActionResponse.ok || videoPayload.success === false) {
      const failureReason = String(videoPayload.error || `Video action failed (${videoActionResponse.status})`)
      return errorResponse(failureReason, req, videoActionResponse.status >= 400 ? videoActionResponse.status : 502)
    }

    const videoId = String(videoPayload.video_id || '').trim()
    const videoUrl = String(videoPayload.video_url || '').trim()
    const quality = String(videoPayload.quality || 'medium')
    const format = String(videoPayload.format || 'mp4')
    const duration = Number(videoPayload.duration_seconds || 0)

    const detailParts = [
      videoId ? `ID: ${videoId}` : '',
      quality ? `quality: ${quality}` : '',
      format ? `format: ${format}` : '',
      Number.isFinite(duration) && duration > 0 ? `duration: ${duration}s` : '',
      videoUrl ? `URL: ${videoUrl}` : '',
    ].filter(Boolean)

    return jsonResponse({
      answer: `Video created successfully. ${detailParts.join(' | ')}`,
      jurisdiction: String(context?.workspace_name || 'General'),
      is_client_owned: Boolean(context),
      model: 'qwen2.5:7b',
      provider: 'bob-generate-video-action',
      action: {
        type: 'generate_briefing_video',
        success: true,
        proposal_id: approvedProposalId || null,
        video_id: videoId || null,
        video_url: videoUrl || null,
        quality,
        format,
      },
    }, req)
  }

  const inferenceResponse = await fetch(`${supabaseUrl}/functions/v1/onspace-ai-chat`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${userJwt}`,
      apikey: serviceRoleKey,
      'Content-Type': 'application/json',
      'x-client-info': 'ask-bob-edge-function',
    },
    body: JSON.stringify({
      provider: 'inference',
      model: 'qwen2.5:7b',
      temperature: 0.2,
      context: {
        execution_policy_contract: 'v1',
        source: 'ask-bob',
      },
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: prompt },
      ],
    }),
  })

  const inferencePayload = await inferenceResponse.json().catch(() => ({})) as Record<string, unknown>
  if (!inferenceResponse.ok) {
    const message = String(inferencePayload.error || `Upstream inference failed (${inferenceResponse.status})`)
    return errorResponse(message, req, inferenceResponse.status)
  }

  const answer = extractAnswer(inferencePayload)
  if (!answer) {
    return errorResponse('Inference provider returned empty response', req, 502)
  }

  return jsonResponse({
    answer,
    jurisdiction: String(context?.workspace_name || 'General'),
    is_client_owned: Boolean(context),
    model: String(inferencePayload.model || 'qwen2.5:7b'),
    provider: String(inferencePayload.provider || 'runpod-serverless-ollama'),
  }, req)
}))